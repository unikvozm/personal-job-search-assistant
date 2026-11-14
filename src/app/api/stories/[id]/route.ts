import { approveStory, dismissStory, draftStory } from "@/lib/pipeline/stories";
import { json, tryConfig, rejectCrossSite } from "@/lib/server";

export const dynamic = "force-dynamic";

type Body = { action: "draft"; notes: string } | { action: "approve"; draft: string } | { action: "dismiss" };

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const blocked = rejectCrossSite(req);
  if (blocked) return blocked;
  const id = Number((await ctx.params).id);
  const body = (await req.json()) as Body;
  try {
    if (body.action === "draft") {
      const { config, error } = tryConfig();
      if (!config) return json({ error }, 400);
      return json({ draft: await draftStory(config, id, body.notes) });
    }
    if (body.action === "approve") approveStory(id, body.draft);
    else dismissStory(id);
    return json({ ok: true });
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
}
