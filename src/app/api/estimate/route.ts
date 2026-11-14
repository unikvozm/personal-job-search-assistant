import { jobsRepo } from "@/lib/db";
import { estimate, llmMode } from "@/lib/llm";
import { spentToday } from "@/lib/llm/cost";
import { prepareTasks } from "@/lib/pipeline/prepare";
import { json, tryConfig, rejectCrossSite } from "@/lib/server";

export const dynamic = "force-dynamic";

/** Cost estimate for preparing (tailor + answers) the given jobs. Body: { ids } */
export async function POST(req: Request) {
  const blocked = rejectCrossSite(req);
  if (blocked) return blocked;
  const { config, error } = tryConfig();
  if (!config) return json({ error }, 400);
  const { ids } = (await req.json()) as { ids: string[] };
  try {
    const usd = estimate(config, prepareTasks(jobsRepo.byIds(ids), config), false);
    return json({ usd, mode: llmMode(config), spentToday: spentToday(), budget: config.llm.dailyBudgetUsd });
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
}
