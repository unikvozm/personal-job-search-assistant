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
  location: { name: string };
  content: string;
}

async function greenhouse(c: Company): Promise<RawJob[]> {
  const data = await fetchJson<{ jobs: GreenhouseJob[] }>(
    `https://boards-api.greenhouse.io/v1/boards/${c.slug}/jobs?content=true`,
  );
  return data.jobs.map((j) => ({
    source: "greenhouse",
    sourceId: String(j.id),
    company: c.name,
    title: j.title,
    location: j.location.name,
    countries: countriesFrom(j.location.name),
    workMode: workModeFrom(j.location.name, j.title),
    url: j.absolute_url,
    description: j.content,
    postedAt: iso(j.first_published ?? j.updated_at),
    ats: "greenhouse" as const,
    atsRef: { board: c.slug, jobId: String(j.id) },
    firstParty: true,
  }));
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

async function lever(c: Company): Promise<RawJob[]> {
  let host = "api.lever.co";
  let data: LeverJob[];
  try {
    data = await fetchJson<LeverJob[]>(`https://${host}/v0/postings/${c.slug}?mode=json`);
  } catch (e) {
    if (!(e instanceof HttpError && e.status === 404)) throw e;
    host = "api.eu.lever.co"; // EU-hosted boards
    data = await fetchJson<LeverJob[]>(`https://${host}/v0/postings/${c.slug}?mode=json`);
  }
  return data.map((j) => {
    const location = j.categories.allLocations?.join("; ") ?? j.categories.location ?? "";
    const sr = j.salaryRange;
    const salary: Salary | null = sr
      ? { min: sr.min, max: sr.max, currency: sr.currency, period: /hour/.test(sr.interval) ? "hour" : /month/.test(sr.interval) ? "month" : "year" }
      : null;
    return {
      source: "lever",
      sourceId: j.id,
      company: c.name,
      title: j.text,
      location,
      countries: j.country ? [j.country.toUpperCase()] : countriesFrom(location),
      workMode: j.workplaceType && j.workplaceType !== "unspecified" ? j.workplaceType : workModeFrom(location),
      url: j.hostedUrl,
      applyUrl: j.applyUrl,
      description: [j.description, ...j.lists.map((l) => `<h3>${l.text}</h3><ul>${l.content}</ul>`), j.additional ?? ""].join("\n"),
      postedAt: iso(j.createdAt),
      salary,
      ats: "lever" as const,
      atsRef: { company: c.slug, postingId: j.id, host },
      firstParty: true,
    };
  });
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

async function ashby(c: Company): Promise<RawJob[]> {
  const data = await fetchJson<{ jobs: AshbyJob[] }>(
    `https://api.ashbyhq.com/posting-api/job-board/${c.slug}?includeCompensation=true`,
  );
  return data.jobs.map((j) => {
    const places = [j.address, ...(j.secondaryLocations ?? []).map((s) => s.address)]
      .map((a) => a?.postalAddress?.addressCountry ?? "")
      .join("; ");
    const salaryPart = j.compensation?.summaryComponents.find((s) => s.compensationType === "Salary" && s.currencyCode);
    const mode = j.workplaceType === "OnSite" ? "onsite" : j.workplaceType === "Hybrid" ? "hybrid" : j.isRemote ? "remote" : null;
    return {
      source: "ashby",
      sourceId: j.id,
      company: c.name,
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
      ats: "ashby" as const,
      atsRef: { board: c.slug, jobId: j.id },
      firstParty: true,
    };
  });
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

async function smartrecruiters(c: Company, titles: string[]): Promise<RawJob[]> {
  const base = `https://api.smartrecruiters.com/v1/companies/${c.slug}/postings`;
  const postings: SrPosting[] = [];
  for (let offset = 0; offset < 1000; offset += 100) {
    const page = await fetchJson<{ content: SrPosting[]; totalFound: number }>(`${base}?limit=100&offset=${offset}`);
    postings.push(...page.content);
    if (offset + 100 >= page.totalFound) break;
  }
  // Descriptions need one request per posting, so only fetch the ones whose title matches.
  const relevant = postings.filter((p) => titleMatches(p.name, titles));
  return pMap(relevant, 4, async (p) => {
    const d = await fetchJson<SrDetail>(`${base}/${p.id}`);
    const sections = Object.values(d.jobAd?.sections ?? {}).map((s) => `<h3>${s.title ?? ""}</h3>${s.text ?? ""}`);
    const location = p.location.fullLocation ?? p.location.city ?? "";
    return {
      source: "smartrecruiters",
      sourceId: p.id,
      company: c.name,
      title: p.name,
      location,
      countries: p.location.country ? [p.location.country.toUpperCase()] : countriesFrom(location),
      workMode: p.location.remote ? "remote" : p.location.hybrid ? "hybrid" : "onsite",
      url: `https://jobs.smartrecruiters.com/${c.slug}/${p.id}`,
      description: sections.join("\n"),
      postedAt: iso(p.releasedDate),
      ats: "smartrecruiters" as const,
      atsRef: { company: c.slug, postingId: p.id },
      firstParty: true,
    };
  });
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
