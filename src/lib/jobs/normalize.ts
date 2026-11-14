import { createHash } from "node:crypto";
import type { Job, RawJob } from "./types";

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m);
}

/** HTML job description → readable plain text with bullet points kept. */
export function htmlToText(html: string): string {
  // Some APIs (Greenhouse) return HTML that is itself entity-encoded.
  const decoded = /&lt;\w/.test(html) ? decodeEntities(html) : html;
  return decodeEntities(
    decoded
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
      .replace(/<li[^>]*>/gi, "\n- ")
      .replace(/<\/(p|div|h[1-6]|ul|ol|tr)>|<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/^- *\n\s*/gm, "- ") // <li><p>text</p></li> → "- text"
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

const COMPANY_SUFFIXES = /\b(inc|llc|ltd|gmbh|ag|se|bv|b\.v|plc|corp|corporation|co|company|limited|sarl|sas|oy|ab|as)\b\.?/g;

export function normalizeCompany(name: string): string {
  return name.toLowerCase().replace(COMPANY_SUFFIXES, "").replace(/[^a-z0-9]+/g, " ").trim();
}

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\((m|f|w|d|x|all genders?)[/|,\s\w]*\)/g, "") // German "(m/w/d)" style suffixes
    .replace(/\bfront[\s-]?end\b/g, "frontend")
    .replace(/\bback[\s-]?end\b/g, "backend")
    .replace(/\b(sr)\b\.?/g, "senior")
    .replace(/\b(jr)\b\.?/g, "junior")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeLocation(location: string, workMode: RawJob["workMode"]): string {
  if (workMode === "remote") return "remote";
  return location.toLowerCase().split(/[,;/]/)[0]!.replace(/[^a-z]+/g, " ").trim();
}

/** Same company + title + (city or "remote") counts as the same vacancy across boards. */
export function fingerprint(job: Pick<RawJob, "company" | "title" | "location" | "workMode">): string {
  const key = [normalizeCompany(job.company), normalizeTitle(job.title), normalizeLocation(job.location, job.workMode)].join("|");
  return createHash("sha1").update(key).digest("hex").slice(0, 16);
}

/** Strips tracking params so the same posting from two feeds compares equal. */
export function canonicalUrl(url: string): string {
  try {
    const u = new URL(url);
    for (const p of [...u.searchParams.keys()]) {
      if (/^(utm_|ref|source|gh_src|lever-source|src|trk)/i.test(p)) u.searchParams.delete(p);
    }
    u.hash = "";
    return u.toString().replace(/\/$/, "");
  } catch {
    return url;
  }
}

export function toJob(raw: RawJob, runId: string, at: string): Job {
  const fp = fingerprint(raw);
  return {
    ...raw,
    url: canonicalUrl(raw.url),
    applyUrl: raw.applyUrl ? canonicalUrl(raw.applyUrl) : undefined,
    id: fp,
    fingerprint: fp,
    title: raw.title.trim(),
    company: raw.company.trim(),
    description: htmlToText(raw.description),
    salary: raw.salary ?? null,
    salarySource: raw.salary ? "posting" : null,
    belowMinSalary: false,
    status: "new",
    selected: false,
    score: null,
    scoreResult: null,
    questions: null,
    autoFillable: null,
    firstSeenRun: runId,
    firstSeenAt: at,
    live: raw.firstParty || raw.verifiedLive ? true : null,
  };
}

/**
 * Deduplicates within a batch (by fingerprint and canonical URL).
 * Prefers first-party ATS entries and entries with a salary over aggregator copies.
 */
export function dedupe(jobs: Job[]): Job[] {
  const rank = (j: Job) => (j.firstParty ? 2 : 0) + (j.salary ? 1 : 0);
  const byFp = new Map<string, Job>();
  for (const job of jobs) {
    const existing = byFp.get(job.fingerprint);
    if (!existing || rank(job) > rank(existing)) byFp.set(job.fingerprint, job);
  }
  const byUrl = new Map<string, Job>();
  for (const job of byFp.values()) {
    const existing = byUrl.get(job.url);
    if (!existing || rank(job) > rank(existing)) byUrl.set(job.url, job);
  }
  return [...byUrl.values()];
}
