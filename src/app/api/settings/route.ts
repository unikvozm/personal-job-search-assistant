import { settingsRepo } from "@/lib/db";
import { json, rejectCrossSite } from "@/lib/server";

export const dynamic = "force-dynamic";

/** Body: { llmMode: "api" | "claude-code" } - overrides llm.mode from configs.md. */
export async function POST(req: Request) {
  const blocked = rejectCrossSite(req);
  if (blocked) return blocked;
  const { llmMode } = (await req.json()) as { llmMode: string };
  if (llmMode !== "api" && llmMode !== "claude-code") return json({ error: "Invalid mode" }, 400);
  settingsRepo.set("llm.mode", llmMode);
  return json({ ok: true });
}
