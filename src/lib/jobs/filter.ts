import type { Config } from "../config";
import { normalizeCompany, normalizeTitle } from "./normalize";
import type { Job, RawJob } from "./types";

/** Words that make a title match even if the configured title is phrased differently. */
function titleTokens(title: string): string[] {
  return normalizeTitle(title)
    .split(" ")
    .filter((t) => t.length > 1)
    .map((t) => (t.length > 4 && t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t)); // "systems" = "system"
}

/** All significant tokens of at least one configured title appear in the job title. */
export function titleMatches(jobTitle: string, titles: string[]): boolean {
  const job = new Set(titleTokens(jobTitle));
  return titles.some((t) => titleTokens(t).every((tok) => job.has(tok)));
}

const containsWord = (text: string, word: string) =>
  new RegExp(`(^|[^a-z0-9])${word.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(text);

export interface FilterResult {
  keep: boolean;
  reason?: string;
}

/** Keyword / location pre-filter that runs before any LLM call. */
export function prefilter(job: RawJob | Job, config: Config): FilterResult {
  const { search } = config;
  if (!titleMatches(job.title, search.titles)) return { keep: false, reason: "title" };

  const company = normalizeCompany(job.company);
  if (search.excludeCompanies.some((c) => normalizeCompany(c) === company)) return { keep: false, reason: "company" };

  const text = `${job.title}\n${job.description}`.toLowerCase();
  if (search.excludeKeywords.some((k) => text.includes(k.toLowerCase()))) return { keep: false, reason: "excluded keyword" };
  if (search.keywords.length && !search.keywords.some((k) => containsWord(text, k))) {
    return { keep: false, reason: "keywords" };
  }

  if (job.workMode && !search.workModes.includes(job.workMode)) return { keep: false, reason: "work mode" };

  // Empty countries = worldwide or unknown → kept; the scorer judges eligibility from the text.
  // REMOTE in configs only switches on the remote boards; it doesn't admit country-restricted remote jobs.
  const countryOk = job.countries.length === 0 || job.countries.some((c) => search.countries.includes(c));
  if (!countryOk) return { keep: false, reason: "country" };

  return { keep: true };
}

export function withinWindow(job: RawJob, since: Date): boolean {
  if (!job.postedAt) return true;
  const posted = new Date(job.postedAt);
  return Number.isNaN(posted.getTime()) || posted >= since;
}
