import { runsRepo } from "@/lib/db";
import { json, startCli, rejectCrossSite } from "@/lib/server";

export const dynamic = "force-dynamic";

export function GET() {
  return json({ runs: runsRepo.recent(8) });
}

const COMMANDS = new Set(["daily", "find", "score", "apply", "prepare", "prefill", "prep"]);

/**
 * Starts a pipeline step in the background: { kind, ids?, allowOverBudget? }.
 * Stops a running one: { kind: "stop", id }.
 */
export async function POST(req: Request) {
  const blocked = rejectCrossSite(req);
  if (blocked) return blocked;
  const { kind, id, ids = [], allowOverBudget = false } = (await req.json()) as {
    kind: string;
    id?: string;
    ids?: string[];
    allowOverBudget?: boolean;
  };
  if (kind === "stop" && id) {
    runsRepo.stop(id);
    return json({ stopped: id });
  }
  if (!COMMANDS.has(kind)) return json({ error: `Unknown command ${kind}` }, 400);
  // recent() first marks runs whose process has died as interrupted, so only live runs block.
  if (runsRepo.recent(5).some((r) => r.status === "running")) {
    return json({ error: "Another run is still in progress" }, 409);
  }
  const log = startCli([kind, ...ids.map(String), ...(allowOverBudget ? ["--allow-over-budget"] : [])]);
  return json({ started: kind, log });
}
