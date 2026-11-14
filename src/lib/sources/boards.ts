import { parseSalaryText } from "../jobs/salary";
import type { RawJob, Salary } from "../jobs/types";
import { countriesFrom, workModeFrom } from "./geo";
import { HttpError, fetchJson } from "./http";
import type { Source, SourceContext } from "./types";

const iso = (v: string | number) => new Date(v).toISOString();
const unix = (seconds: number) => new Date(seconds * 1000).toISOString();

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One search per configured title, spaced out; stops the source (keeping results) once it rate-limits us. */
async function perTitle(ctx: SourceContext, name: string, fn: (title: string) => Promise<RawJob[]>): Promise<RawJob[]> {
  const out: RawJob[] = [];
  for (const [i, title] of ctx.config.search.titles.entries()) {
    if (i > 0) await pause(700);
    try {
      out.push(...(await fn(title)));
    } catch (e) {
      if (e instanceof HttpError && e.status === 429) {
        ctx.log(`  ${name}: rate-limited after ${i} of ${ctx.config.search.titles.length} titles, keeping ${out.length} results`);
        break;
      }
      ctx.log(`  ${name} "${title}": ${(e as Error).message}`);
    }
  }
  return out;
}

// ---------- Remotive (remote, worldwide) ----------

export const remotive: Source = {
  name: "remotive",
  fetch: (ctx) =>
    perTitle(ctx, "remotive", async (title) => {
      type J = { id: number; url: string; title: string; company_name: string; candidate_required_location: string; salary: string; description: string; publication_date: string };
      const d = await fetchJson<{ jobs: J[] }>(`https://remotive.com/api/remote-jobs?search=${encodeURIComponent(title)}&limit=100`);
      return d.jobs.map((j) => ({
        source: "remotive",
        sourceId: String(j.id),
        company: j.company_name,
        title: j.title,
        location: j.candidate_required_location,
        countries: countriesFrom(j.candidate_required_location),
        workMode: "remote" as const,
        url: j.url,
        description: j.description,
        postedAt: iso(j.publication_date),
        salary: parseSalaryText(j.salary),
      }));
    }),
};

// ---------- RemoteOK (remote, one global feed) ----------

export const remoteok: Source = {
  name: "remoteok",
  async fetch() {
    type J = { id: string; epoch: number; company: string; position: string; description: string; location: string; url: string; apply_url: string; salary_min: number; salary_max: number };
    const d = await fetchJson<(J | { legal: string })[]>("https://remoteok.com/api");
    return d
      .filter((j): j is J => "position" in j)
      .map((j) => ({
        source: "remoteok",
        sourceId: j.id,
        company: j.company,
        title: j.position,
        location: j.location,
        countries: countriesFrom(j.location),
        workMode: "remote" as const,
        url: j.url,
        description: j.description,
        postedAt: unix(j.epoch),
        salary: j.salary_max ? { min: j.salary_min || null, max: j.salary_max, currency: "USD", period: "year" as const } : null,
      }));
  },
};

// ---------- Himalayas (remote) ----------

export const himalayas: Source = {
  name: "himalayas",
  fetch: (ctx) =>
    perTitle(ctx, "himalayas", async (title) => {
      type J = { title: string; companyName: string; guid: string; applicationLink: string; pubDate: number; expiryDate: number; locationRestrictions: string[]; minSalary: number | null; maxSalary: number | null; currency: string | null; salaryPeriod: string; description: string };
      const out: RawJob[] = [];
      for (let page = 1; page <= 5; page++) {
        if (page > 1) await pause(700);
        const d = await fetchJson<{ jobs: J[] }>(`https://himalayas.app/jobs/api/search?q=${encodeURIComponent(title)}&page=${page}`);
        for (const j of d.jobs) {
          if (unix(j.pubDate) < ctx.since.toISOString()) continue;
          const location = j.locationRestrictions.join("; ") || "Worldwide";
          out.push({
            source: "himalayas",
            sourceId: j.guid,
            company: j.companyName,
            title: j.title,
            location,
            countries: countriesFrom(location),
            workMode: "remote",
            url: j.guid,
            applyUrl: j.applicationLink,
            description: j.description,
            postedAt: unix(j.pubDate),
            verifiedLive: j.expiryDate * 1000 > Date.now(), // the site blocks link checks; trust the API's expiry date
            salary:
              j.currency && (j.minSalary || j.maxSalary)
                ? { min: j.minSalary, max: j.maxSalary, currency: j.currency, period: j.salaryPeriod === "hourly" ? "hour" : j.salaryPeriod === "monthly" ? "month" : "year" }
                : null,
          });
        }
        if (d.jobs.length < 20) break;
      }
      return out;
    }),
};

// ---------- Jobicy (remote) ----------

export const jobicy: Source = {
  name: "jobicy",
  async fetch(ctx) {
    type J = { id: number; url: string; jobTitle: string; companyName: string; jobGeo: string; jobDescription: string; pubDate: string; salaryMin?: number; salaryMax?: number; salaryCurrency?: string; salaryPeriod?: string };
    // Jobicy tags are single slugs; multi-word or symbol keywords ("CI/CD", "design system") return 400.
    const single = ctx.config.search.keywords.filter((k) => /^[a-z0-9-]+$/i.test(k)).map((k) => k.toLowerCase());
    const tags = single.length ? single : [""];
    const out: RawJob[] = [];
    for (const tag of tags) {
      try {
        const d = await fetchJson<{ jobs?: J[] }>(`https://jobicy.com/api/v2/remote-jobs?count=100${tag ? `&tag=${encodeURIComponent(tag)}` : ""}`);
        for (const j of d.jobs ?? []) {
          const salary: Salary | null =
            j.salaryCurrency && (j.salaryMin || j.salaryMax)
              ? { min: j.salaryMin ?? null, max: j.salaryMax ?? null, currency: j.salaryCurrency, period: j.salaryPeriod === "hourly" ? "hour" : j.salaryPeriod === "monthly" ? "month" : "year" }
              : null;
          out.push({
            source: "jobicy",
            sourceId: String(j.id),
            company: j.companyName,
            title: j.jobTitle,
            location: j.jobGeo,
            countries: countriesFrom(j.jobGeo),
            workMode: "remote",
            url: j.url,
            description: j.jobDescription,
            postedAt: iso(j.pubDate),
            salary,
          });
        }
      } catch (e) {
        ctx.log(`  jobicy "${tag}": ${(e as Error).message}`);
      }
    }
    return out;
  },
};

// ---------- Arbeitnow (Germany / DACH) ----------

export const arbeitnow: Source = {
  name: "arbeitnow",
  async fetch(ctx) {
    type J = { slug: string; company_name: string; title: string; description: string; remote: boolean; url: string; location: string; created_at: number };
    const out: RawJob[] = [];
    for (let page = 1; page <= 30; page++) {
      let d: { data: J[]; links: { next: string | null } };
      try {
        if (page > 1) await new Promise((r) => setTimeout(r, 600)); // the API rate-limits fast paging
        d = await fetchJson(`https://www.arbeitnow.com/api/job-board-api?page=${page}`);
      } catch (e) {
        ctx.log(`  arbeitnow stopped at page ${page}: ${(e as Error).message}`); // keep what we have
        break;
      }
      let older = false;
      for (const j of d.data) {
        if (unix(j.created_at) < ctx.since.toISOString()) {
          older = true;
          continue;
        }
        out.push({
          source: "arbeitnow",
          sourceId: j.slug,
          company: j.company_name,
          title: j.title,
          location: j.location,
          countries: countriesFrom(j.location).length ? countriesFrom(j.location) : ["DE"],
          workMode: j.remote ? "remote" : workModeFrom(j.description.slice(0, 2000)),
          url: j.url,
          description: j.description,
          postedAt: unix(j.created_at),
          salary: parseSalaryText(j.description),
        });
      }
      if (older || !d.links.next) break;
    }
    return out;
  },
};

// ---------- Adzuna (national boards; free key) ----------

export const ADZUNA_COUNTRIES: Record<string, string> = {
  GB: "GBP", US: "USD", DE: "EUR", FR: "EUR", NL: "EUR", AT: "EUR", BE: "EUR", IT: "EUR", ES: "EUR",
  PL: "PLN", CH: "CHF", CA: "CAD", AU: "AUD", NZ: "NZD", SG: "SGD", IN: "INR", BR: "BRL", MX: "MXN", ZA: "ZAR",
};

export const adzuna: Source = {
  name: "adzuna",
  async fetch(ctx) {
    const { ADZUNA_APP_ID: id, ADZUNA_APP_KEY: key } = process.env;
    if (!id || !key) return [];
    type J = { id: string; title: string; company: { display_name: string }; location: { display_name: string }; redirect_url: string; description: string; created: string; salary_min?: number; salary_max?: number; salary_is_predicted?: string };
    const days = Math.max(1, Math.ceil((Date.now() - ctx.since.getTime()) / 86_400_000));
    const countries = ctx.config.search.countries.filter((c) => c in ADZUNA_COUNTRIES);
    const out: RawJob[] = [];
    for (const cc of countries) {
      out.push(
        ...(await perTitle(ctx, `adzuna ${cc}`, async (title) => {
          const jobs: RawJob[] = [];
          for (let page = 1; page <= 3; page++) {
            const q = new URLSearchParams({ app_id: id, app_key: key, what_phrase: title, max_days_old: String(days), results_per_page: "50" });
            const d = await fetchJson<{ results: J[] }>(`https://api.adzuna.com/v1/api/jobs/${cc.toLowerCase()}/search/${page}?${q}`);
            for (const j of d.results) {
              const stated = j.salary_is_predicted !== "1" && (j.salary_min || j.salary_max);
              jobs.push({
                source: "adzuna",
                sourceId: j.id,
                company: j.company.display_name,
                title: j.title,
                location: j.location.display_name,
                countries: [cc],
                workMode: workModeFrom(j.title, j.description),
                url: j.redirect_url,
                description: j.description, // Adzuna truncates descriptions; the scorer is told so
                postedAt: iso(j.created),
                salary: stated ? { min: j.salary_min ?? null, max: j.salary_max ?? null, currency: ADZUNA_COUNTRIES[cc]!, period: "year" } : null,
              });
            }
            if (d.results.length < 50) break;
          }
          return jobs;
        })),
      );
    }
    return out;
  },
};
