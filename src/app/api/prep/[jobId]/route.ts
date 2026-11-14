import { generatePrep } from "@/lib/pipeline/prep";
import { json, tryConfig, rejectCrossSite } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ jobId: string }> }) {
  const blocked = rejectCrossSite(req);
  if (blocked) return blocked;
  const { config, error } = tryConfig();
  if (!config) return json({ error }, 400);
  const { allowOverBudget = false } = (await req.json().catch(() => ({}))) as { allowOverBudget?: boolean };
  try {
    return json({ prep: await generatePrep(config, (await ctx.params).jobId, { allowOverBudget }) });
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
}
