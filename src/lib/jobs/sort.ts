import type { Job } from "./types";

export interface JobGroup {
  key: "salary" | "no-salary";
  title: string;
  /** Ticked by default: every question can be answered from configs.md + bank stories. */
  ready: Job[];
  /** Unticked by default: at least one question needs your input. */
  needsInput: Job[];
}

/** Keeps jobs posted within the last `days` days; jobs with no known posting date are kept. */
export function postedWithin(jobs: Job[], days: number | null, now = Date.now()): Job[] {
  if (!days) return jobs;
  const since = now - days * 86_400_000;
  return jobs.filter((j) => !j.postedAt || Date.parse(j.postedAt) >= since);
}

const byScore = (a: Job, b: Job) =>
  (b.score ?? 0) - (a.score ?? 0) || (b.postedAt ?? "").localeCompare(a.postedAt ?? "");

/**
 * Job list order: salary stated first, then no salary; within each group
 * auto-fillable jobs first, then those needing input; each sorted by score.
 */
export function groupJobs(
  jobs: Job[],
  opts: { threshold: number; showBelowMinSalary?: boolean; showHidden?: boolean; showLowScores?: boolean },
): JobGroup[] {
  const visible = jobs.filter(
    (j) =>
      (opts.showLowScores || (j.score ?? 0) > opts.threshold) &&
      (opts.showBelowMinSalary || !j.belowMinSalary) &&
      (opts.showHidden || (j.status !== "hidden" && j.status !== "skipped")),
  );
  const split = (list: Job[]) => ({
    ready: list.filter((j) => j.autoFillable === true).sort(byScore),
    needsInput: list.filter((j) => j.autoFillable !== true).sort(byScore),
  });
  return [
    { key: "salary", title: "Salary stated", ...split(visible.filter((j) => j.salary)) },
    { key: "no-salary", title: "No salary stated", ...split(visible.filter((j) => !j.salary)) },
  ];
}
