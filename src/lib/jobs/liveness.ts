import { fetchText, pMap } from "../sources/http";
import type { Job } from "./types";

const EXPIRED =
  /no longer (available|accepting|open)|position (has been )?(filled|closed)|job (posting )?(has )?(expired|closed)|this job is closed|stelle ist (leider )?nicht mehr|bereits besetzt|vacancy (has )?closed|page not found/i;

/**
 * Checks aggregator links still lead to an open posting.
 * true = live, false = expired/removed, null = couldn't tell (bot wall) - kept, never dropped.
 */
export async function checkLive(job: Job): Promise<boolean | null> {
  if (job.firstParty || job.live === true) return true;
  try {
    const res = await fetchText(job.applyUrl ?? job.url, 12_000);
    if (res.status === 404 || res.status === 410) return false;
    if (res.status >= 400) return null;
    return !EXPIRED.test(res.text.slice(0, 200_000));
  } catch {
    return null;
  }
}

export async function checkAllLive(jobs: Job[]): Promise<Job[]> {
  return pMap(jobs, 8, async (job) => ({ ...job, live: await checkLive(job) }));
}
