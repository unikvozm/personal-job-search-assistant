import { runsRepo } from "@/lib/db";
import { addJobs } from "@/lib/pipeline/add";
import { json, rejectCrossSite, startCli, tryConfig } from "@/lib/server";
import type { PastedJob } from "@/lib/sources/manual";

export const dynamic = "force-dynamic";

/**
 * Adds jobs you found yourself, then starts scoring them in the background.
 * Body: { urls?: string[], pasted?: PastedJob, alreadyApplied?: boolean }
 */
export async function POST(req: Request) {
  const blocked = rejectCrossSite(req);
  if (blocked) return blocked;
  const { config, error } = tryConfig();
  if (!config) return json({ error }, 400);
  const body = (await req.json()) as { urls?: string[]; pasted?: PastedJob; alreadyApplied?: boolean };
  if (body.pasted && (!body.pasted.company?.trim() || !body.pasted.title?.trim() || (body.pasted.description?.trim().length ?? 0) < 100)) {
    return json({ error: "Company, job title and a description of at least 100 characters are needed." }, 400);
  }

  const results = await addJobs(config, body);
  const toScore = results.filter((r) => r.ok && !r.existing && r.jobId).map((r) => r.jobId!);
  let scoring = false;
  if (toScore.length && !body.alreadyApplied && !runsRepo.recent(5).some((r) => r.status === "running")) {
    startCli(["score", ...toScore]);
    scoring = true;
  }
  return json({ results, scoring });
}
