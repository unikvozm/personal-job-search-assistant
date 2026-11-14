import type { Config } from "../config";
import { applicationsRepo, jobsRepo, now } from "../db";
import { closeSharedBrowser } from "../apply/browser";
import { toJob } from "../jobs/normalize";
import type { ApplicationQuestion, RawJob } from "../jobs/types";
import { pMap } from "../sources/http";
import { jobFromPaste, jobFromUrl, type PastedJob } from "../sources/manual";

export interface AddResult {
  input: string;
  ok: boolean;
  jobId?: string;
  company?: string;
  title?: string;
  /** Already in your list (found by a search or added before). */
  existing?: boolean;
  error?: string;
}

export const MAX_LINKS = 20;

function store(raw: RawJob, questions: ApplicationQuestion[] | null, input: string): AddResult {
  const at = now();
  const job = { ...toJob(raw, `added-${at}`, at), questions };
  const existing = jobsRepo.byFingerprint(job.fingerprint);
  if (existing) return { input, ok: true, jobId: existing.id, company: existing.company, title: existing.title, existing: true };
  jobsRepo.insert(job);
  return { input, ok: true, jobId: job.id, company: job.company, title: job.title };
}

/**
 * Adds jobs you found yourself: links (read through the ATS API or the page) and/or one pasted
 * job. No keyword or country filters apply - you chose them. Optionally records them as applied.
 */
export async function addJobs(
  config: Config,
  input: { urls?: string[]; pasted?: PastedJob; alreadyApplied?: boolean },
): Promise<AddResult[]> {
  const urls = [...new Set((input.urls ?? []).map((u) => u.trim()).filter((u) => /^https?:\/\//i.test(u)))].slice(0, MAX_LINKS);
  try {
    const results = await pMap(urls, 3, async (url): Promise<AddResult> => {
      try {
        return store(await jobFromUrl(url), null, url);
      } catch (e) {
        return { input: url, ok: false, error: (e as Error).message.split("\n")[0] };
      }
    });
    if (input.pasted) {
      const { raw, questions } = jobFromPaste(input.pasted);
      results.push(store(raw, questions, `${input.pasted.title} — ${input.pasted.company}`));
    }
    if (input.alreadyApplied) {
      applicationsRepo.markApplied(results.flatMap((r) => (r.ok && r.jobId ? [r.jobId] : [])), config.tracker.followUpDays);
    }
    return results;
  } finally {
    await closeSharedBrowser();
  }
}
