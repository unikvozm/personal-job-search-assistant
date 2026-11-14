import { practiceFeedback } from "@/lib/pipeline/prep";
import { json, tryConfig, rejectCrossSite } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const blocked = rejectCrossSite(req);
  if (blocked) return blocked;
  const { config, error } = tryConfig();
  if (!config) return json({ error }, 400);
  try {
    return json({ feedback: await practiceFeedback(config, await req.json()) });
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
}
