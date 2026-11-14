import type { Config } from "../config";
import { jobsRepo, now, runsRepo } from "../db";
import { prefilter, withinWindow } from "../jobs/filter";
import { checkAllLive } from "../jobs/liveness";
import { dedupe, toJob } from "../jobs/normalize";
import type { RawJob } from "../jobs/types";
import { selectSources } from "../sources";
import { writeJobDescriptions } from "./report";

/**
 * Search window: the first run looks back `maxAgeDays`; later runs start where the previous
 * successful run started, but never further back than `maxAgeDays`.
 */
export function searchWindow(config: Config, lastRunStartedAt: string | null, at = new Date()): Date {
  const floor = new Date(at.getTime() - config.search.maxAgeDays * 86_400_000);
  if (!lastRunStartedAt) return floor;
  const last = new Date(lastRunStartedAt);
  return last > floor ? last : floor;
}

export interface FindResult {
  runId: string;
  file: string;
  stats: Record<string, number>;
  warnings: string[];
}

/** Step 1 - no LLM: fetch, filter, dedupe, check links, store, write jobDescriptions.md. */
export async function findJobs(config: Config, log: (m: string) => void = console.log): Promise<FindResult> {
  const since = searchWindow(config, runsRepo.lastSuccessful("find")?.startedAt ?? null);
  const run = runsRepo.start("find", since.toISOString());
  try {
    const sources = selectSources(config);
    log(`Searching ${sources.map((s) => s.name).join(", ")} for postings since ${since.toISOString().slice(0, 10)}`);

    const raw: RawJob[] = [];
    const perSource: Record<string, number> = {};
    for (const source of sources) {
      try {
        const jobs = await source.fetch({ config, since, log });
        perSource[source.name] = jobs.length;
        raw.push(...jobs);
        log(`  ${source.name}: ${jobs.length}`);
      } catch (e) {
        log(`  ${source.name} failed: ${(e as Error).message}`);
      }
    }

    const at = now();
    const inWindow = raw.filter((j) => withinWindow(j, since));
    const relevant = inWindow.map((j) => toJob(j, run.id, at)).filter((j) => prefilter(j, config).keep);
    const unique = dedupe(relevant);

    const known = jobsRepo.knownFingerprints();
    const fresh = unique.filter((j) => !known.has(j.fingerprint));
    unique.filter((j) => known.has(j.fingerprint)).forEach((j) => jobsRepo.touch(j.fingerprint));

    log(`Checking ${fresh.filter((j) => !j.firstParty).length} aggregator links…`);
    const checked = await checkAllLive(fresh);
    const live = checked.filter((j) => j.live !== false);
    live.forEach((j) => jobsRepo.insert(j));

    const stats = {
      fetched: raw.length,
      "in window": inWindow.length,
      "matched filters": relevant.length,
      "after dedupe": unique.length,
      "already known": unique.length - fresh.length,
      expired: checked.length - live.length,
      new: live.length,
    };
    const warnings: string[] = [];
    if (live.length < config.search.minJobs) {
      warnings.push(
        `Only ${live.length} new jobs (target ${config.search.minJobs}). Add more titles, countries or targetCompanies in configs.md, or an Adzuna key.`,
      );
    }
    const folder = `${at.slice(0, 10)}_${at.slice(11, 16).replace(":", "")}`; // one folder per run, e.g. 2026-11-14_0930
    const file = writeJobDescriptions(folder, live,{ windowFrom: since.toISOString(), sources: Object.keys(perSource), stats });
    runsRepo.finish(run.id, { ...stats, perSource, warnings, file });
    return { runId: run.id, file, stats, warnings };
  } catch (e) {
    runsRepo.fail(run.id, (e as Error).message);
    throw e;
  }
}
