import { runsRepo } from "@/lib/db";
import { json, startCli, rejectCrossSite } from "@/lib/server";

export const dynamic = "force-dynamic";

export function GET() {
  return json({ runs: runsRepo.recent(8) });
}

const COMMANDS = new Set(["daily", "find", "score", "apply", "prepare", "prefill", "prep"]);

/** Starts a pipeline step in the background. Body: { kind, ids?, allowOverBudget? } */
export async function POST(req: Request) {
  const blocked = rejectCrossSite(req);
  if (blocked) return blocked;
  const { kind, ids = [], allowOverBudget = false } = (await req.json()) as { kind: string; ids?: string[]; allowOverBudget?: boolean };
  if (!COMMANDS.has(kind)) return json({ error: `Unknown command ${kind}` }, 400);
  if (runsRepo.recent(5).some((r) => r.status === "running" && Date.now() - Date.parse(r.startedAt) < 3 * 3_600_000)) {
    return json({ error: "Another run is still in progress" }, 409);
  }
  const log = startCli([kind, ...ids.map(String), ...(allowOverBudget ? ["--allow-over-budget"] : [])]);
  return json({ started: kind, log });
}
