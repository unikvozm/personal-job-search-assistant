import type { Ats, Config } from "../config";
import { titleMatches } from "../jobs/filter";
import type { RawJob, Salary } from "../jobs/types";
import { countriesFrom, workModeFrom } from "./geo";
import { HttpError, fetchJson, pMap } from "./http";
import type { Source, SourceContext } from "./types";

type Company = Config["search"]["targetCompanies"][number];

const iso = (v: string | number | null | undefined) => (v == null ? null : new Date(v).toISOString());

// ---------- Greenhouse ----------

interface GreenhouseJob {
  id: number;
  title: string;
  absolute_url: string;
  updated_at: string;
  first_published?: string;
  company_name?: string;
  location: { name: string };
  content: string;
}

function mapGreenhouse(j: GreenhouseJob, company: string, board: string): RawJob {
  return {
    source: "greenhouse",
    sourceId: String(j.id),
    company,
    title: j.title,
    location: j.location.name,
    countries: countriesFrom(j.location.name),
    workMode: workModeFrom(j.location.name, j.title),
    url: j.absolute_url,
    description: j.content,
    postedAt: iso(j.first_published ?? j.updated_at),
    ats: "greenhouse",
    atsRef: { board, jobId: String(j.id) },
    firstParty: true,
  };
}

async function greenhouse(c: Company): Promise<RawJob[]> {
  const data = await fetchJson<{ jobs: GreenhouseJob[] }>(`https://boards-api.greenhouse.io/v1/boards/${c.slug}/jobs?content=true`);
  return data.jobs.map((j) => mapGreenhouse(j, c.name, c.slug));
}

// ---------- Lever ----------

interface LeverJob {
  id: string;
  text: string;
  hostedUrl: string;
  applyUrl: string;
  createdAt: number;
  country?: string;
  workplaceType?: "remote" | "hybrid" | "onsite" | "unspecified";
  categories: { location?: string; allLocations?: string[] };
  description: string;
  lists: { text: string; content: string }[];
  additional?: string;
  salaryRange?: { min: number; max: number; currency: string; interval: string };
}

function mapLever(j: LeverJob, company: string, slug: string, host: string): RawJob {
  const location = j.categories.allLocations?.join("; ") ?? j.categories.location ?? "";
  const sr = j.salaryRange;
  const salary: Salary | null = sr
    ? { min: sr.min, max: sr.max, currency: sr.currency, period: /hour/.test(sr.interval) ? "hour" : /month/.test(sr.interval) ? "month" : "year" }
    : null;
  return {
    source: "lever",
    sourceId: j.id,
    company,
    title: j.text,
    location,
    countries: j.country ? [j.country.toUpperCase()] : countriesFrom(location),
    workMode: j.workplaceType && j.workplaceType !== "unspecified" ? j.workplaceType : workModeFrom(location),
    url: j.hostedUrl,
    applyUrl: j.applyUrl,
    description: [j.description, ...j.lists.map((l) => `<h3>${l.text}</h3><ul>${l.content}</ul>`), j.additional ?? ""].join("\n"),
    postedAt: iso(j.createdAt),
    salary,
    ats: "lever",
    atsRef: { company: slug, postingId: j.id, host },
    firstParty: true,
  };
}

/** Lever boards live on api.lever.co or, for EU-hosted companies, api.eu.lever.co. */
async function leverJson<T>(path: string): Promise<{ data: T; host: string }> {
  try {
    return { data: await fetchJson<T>(`https://api.lever.co/v0/postings/${path}`), host: "api.lever.co" };
  } catch (e) {
    if (!(e instanceof HttpError && e.status === 404)) throw e;
    return { data: await fetchJson<T>(`https://api.eu.lever.co/v0/postings/${path}`), host: "api.eu.lever.co" };
  }
}

async function lever(c: Company): Promise<RawJob[]> {
  const { data, host } = await leverJson<LeverJob[]>(`${c.slug}?mode=json`);
  return data.map((j) => mapLever(j, c.name, c.slug, host));
}

// ---------- Ashby ----------

interface AshbyAddress { postalAddress?: { addressCountry?: string; addressLocality?: string } }
interface AshbyJob {
  id: string;
  title: string;
  location: string;
  isRemote: boolean;
  workplaceType?: "OnSite" | "Remote" | "Hybrid";
  publishedAt: string;
  jobUrl: string;
  applyUrl: string;
  descriptionHtml: string;
  address?: AshbyAddress;
  secondaryLocations?: { location: string; address?: AshbyAddress }[];
  compensation?: {
    summaryComponents: { compensationType: string; interval: string; currencyCode: string | null; minValue: number | null; maxValue: number | null }[];
  };
}

function mapAshby(j: AshbyJob, company: string, board: string): RawJob {
  const places = [j.address, ...(j.secondaryLocations ?? []).map((s) => s.address)]
    .map((a) => a?.postalAddress?.addressCountry ?? "")
    .join("; ");
  const salaryPart = j.compensation?.summaryComponents.find((s) => s.compensationType === "Salary" && s.currencyCode);
  const mode = j.workplaceType === "OnSite" ? "onsite" : j.workplaceType === "Hybrid" ? "hybrid" : j.isRemote ? "remote" : null;
  return {
    source: "ashby",
    sourceId: j.id,
    company,
    title: j.title,
    location: [j.location, ...(j.secondaryLocations ?? []).map((s) => s.location)].join("; "),
    countries: countriesFrom(`${places}; ${j.location}`),
    workMode: mode,
    url: j.jobUrl,
    applyUrl: j.applyUrl,
    description: j.descriptionHtml,
    postedAt: iso(j.publishedAt),
    salary: salaryPart
      ? {
          min: salaryPart.minValue,
          max: salaryPart.maxValue,
          currency: salaryPart.currencyCode!,
          period: /HOUR/.test(salaryPart.interval) ? "hour" : /MONTH/.test(salaryPart.interval) ? "month" : "year",
        }
      : null,
    ats: "ashby",
    atsRef: { board, jobId: j.id },
    firstParty: true,
  };
}

const ashbyBoard = (board: string) =>
  fetchJson<{ jobs: AshbyJob[] }>(`https://api.ashbyhq.com/posting-api/job-board/${board}?includeCompensation=true`);

async function ashby(c: Company): Promise<RawJob[]> {
  return (await ashbyBoard(c.slug)).jobs.map((j) => mapAshby(j, c.name, c.slug));
}

// ---------- SmartRecruiters ----------

interface SrPosting {
  id: string;
  name: string;
  releasedDate: string;
  location: { fullLocation?: string; city?: string; country?: string; remote?: boolean; hybrid?: boolean };
  company: { name: string };
}
interface SrDetail extends SrPosting {
  jobAd?: { sections?: Record<string, { title?: string; text?: string }> };
}

const srBase = (company: string) => `https://api.smartrecruiters.com/v1/companies/${company}/postings`;

function mapSmartRecruiters(d: SrDetail, company: string, slug: string): RawJob {
  const sections = Object.values(d.jobAd?.sections ?? {}).map((s) => `<h3>${s.title ?? ""}</h3>${s.text ?? ""}`);
  const location = d.location.fullLocation ?? d.location.city ?? "";
  return {
    source: "smartrecruiters",
    sourceId: d.id,
    company,
    title: d.name,
    location,
    countries: d.location.country ? [d.location.country.toUpperCase()] : countriesFrom(location),
    workMode: d.location.remote ? "remote" : d.location.hybrid ? "hybrid" : "onsite",
    url: `https://jobs.smartrecruiters.com/${slug}/${d.id}`,
    description: sections.join("\n"),
    postedAt: iso(d.releasedDate),
    ats: "smartrecruiters",
    atsRef: { company: slug, postingId: d.id },
    firstParty: true,
  };
}

async function smartrecruiters(c: Company, titles: string[]): Promise<RawJob[]> {
  const postings: SrPosting[] = [];
  for (let offset = 0; offset < 1000; offset += 100) {
    const page = await fetchJson<{ content: SrPosting[]; totalFound: number }>(`${srBase(c.slug)}?limit=100&offset=${offset}`);
    postings.push(...page.content);
    if (offset + 100 >= page.totalFound) break;
  }
  // Descriptions need one request per posting, so only fetch the ones whose title matches.
  const relevant = postings.filter((p) => titleMatches(p.name, titles));
  return pMap(relevant, 4, async (p) => mapSmartRecruiters(await fetchJson<SrDetail>(`${srBase(c.slug)}/${p.id}`), c.name, c.slug));
}

const fetchers: Record<Ats, (c: Company, titles: string[]) => Promise<RawJob[]>> = {
  greenhouse,
  lever,
  ashby,
  smartrecruiters,
};

/** One source covering every company in `search.targetCompanies`. */
export const targetCompanies: Source = {
  name: "target companies",
  async fetch(ctx: SourceContext) {
    const results = await pMap(ctx.config.search.targetCompanies, 4, async (c) => {
      try {
        return await fetchers[c.ats](c, ctx.config.search.titles);
      } catch (e) {
        ctx.log(`  ${c.name} (${c.ats}/${c.slug}): ${(e as Error).message}`);
        return [];
      }
    });
    return results.flat();
  },
};

// ---------- Single postings from a link ----------

export interface AtsLink {
  ats: Ats;
  slug: string;
  id: string;
}

/** Recognizes posting links on the four supported ATSs. */
export function parseAtsLink(url: string): AtsLink | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const parts = u.pathname.split("/").filter(Boolean);
  const host = u.hostname.toLowerCase();
  if (/(^|\.)greenhouse\.io$/.test(host) && parts[1] === "jobs" && parts[2]) return { ats: "greenhouse", slug: parts[0]!, id: parts[2] };
  if (/^jobs\.(eu\.)?lever\.co$/.test(host) && parts[1]) return { ats: "lever", slug: parts[0]!, id: parts[1] };
  if (host === "jobs.ashbyhq.com" && parts[1]) return { ats: "ashby", slug: parts[0]!, id: parts[1] };
  if (host === "jobs.smartrecruiters.com" && parts[1]) return { ats: "smartrecruiters", slug: parts[0]!, id: parts[1].split("-")[0]! };
  return null;
}

const titleCase = (slug: string) => slug.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/** Fetches one posting through its ATS API. */
export async function fetchAtsPosting(link: AtsLink): Promise<RawJob> {
  switch (link.ats) {
    case "greenhouse": {
      const j = await fetchJson<GreenhouseJob>(`https://boards-api.greenhouse.io/v1/boards/${link.slug}/jobs/${link.id}`);
      return mapGreenhouse(j, j.company_name ?? titleCase(link.slug), link.slug);
    }
    case "lever": {
      const { data, host } = await leverJson<LeverJob>(`${link.slug}/${link.id}`);
      return mapLever(data, titleCase(link.slug), link.slug, host);
    }
    case "ashby": {
      const job = (await ashbyBoard(link.slug)).jobs.find((j) => j.id === link.id);
      if (!job) throw new Error("This Ashby posting is no longer on the company's board");
      return mapAshby(job, titleCase(link.slug), link.slug);
    }
    case "smartrecruiters": {
      const d = await fetchJson<SrDetail>(`${srBase(link.slug)}/${link.id}`);
      return mapSmartRecruiters(d, d.company?.name ?? titleCase(link.slug), link.slug);
    }
  }
}
