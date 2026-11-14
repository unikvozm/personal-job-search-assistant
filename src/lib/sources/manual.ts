import { createHash } from "node:crypto";
import { sharedBrowser } from "../apply/browser";
import { matchStandard } from "../apply/fields";
import { decodeEntities, htmlToText } from "../jobs/normalize";
import { parseSalaryText } from "../jobs/salary";
import type { ApplicationQuestion, RawJob, Salary } from "../jobs/types";
import { fetchAtsPosting, parseAtsLink } from "./ats";
import { countriesFrom, workModeFrom } from "./geo";
import { fetchText } from "./http";

/** Jobs you add yourself, from a link ("link") or pasted text ("manual"). */
export const ADDED_SOURCES = ["link", "manual"] as const;

const shortId = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 12);

interface JsonLdJob {
  "@type"?: string | string[];
  title?: string;
  description?: string;
  datePosted?: string;
  url?: string;
  hiringOrganization?: { name?: string } | string;
  jobLocation?: JsonLdPlace | JsonLdPlace[];
  jobLocationType?: string;
  baseSalary?: { currency?: string; value?: { minValue?: number; maxValue?: number; value?: number; unitText?: string } };
}
interface JsonLdPlace { address?: { addressLocality?: string; addressRegion?: string; addressCountry?: string | { name?: string } } | string }

/** Finds a schema.org JobPosting in the page's JSON-LD blocks (most career sites publish one for Google Jobs). */
export function jobPostingFromHtml(html: string): JsonLdJob | null {
  const blocks = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const [, raw] of blocks) {
    let data: unknown;
    try {
      data = JSON.parse(raw!.trim());
    } catch {
      continue;
    }
    const queue: unknown[] = [data];
    while (queue.length) {
      const node = queue.shift();
      if (Array.isArray(node)) queue.push(...node);
      else if (node && typeof node === "object") {
        const n = node as JsonLdJob & { "@graph"?: unknown };
        const type = n["@type"];
        if ((Array.isArray(type) ? type : [type]).includes("JobPosting") && n.title) return n;
        if (n["@graph"]) queue.push(n["@graph"]);
      }
    }
  }
  return null;
}

function placeText(p: JsonLdPlace): string {
  if (typeof p.address === "string") return p.address;
  const a = p.address ?? {};
  const country = typeof a.addressCountry === "string" ? a.addressCountry : a.addressCountry?.name;
  return [a.addressLocality, a.addressRegion, country].filter(Boolean).join(", ");
}

function salaryFrom(ld: JsonLdJob): Salary | null {
  const v = ld.baseSalary?.value;
  if (!ld.baseSalary?.currency || !v) return null;
  const unit = (v.unitText ?? "YEAR").toUpperCase();
  return {
    min: v.minValue ?? v.value ?? null,
    max: v.maxValue ?? v.value ?? null,
    currency: ld.baseSalary.currency,
    period: unit === "HOUR" ? "hour" : unit === "MONTH" ? "month" : "year",
  };
}

const hostCompany = (url: string) => new URL(url).hostname.replace(/^(www|jobs|careers|boards|apply)\./, "").split(".")[0]!;

function fromJsonLd(ld: JsonLdJob, url: string): RawJob {
  const places = ld.jobLocation ? (Array.isArray(ld.jobLocation) ? ld.jobLocation : [ld.jobLocation]) : [];
  const location = places.map(placeText).filter(Boolean).join("; ");
  const description = ld.description ?? "";
  const org = typeof ld.hiringOrganization === "string" ? ld.hiringOrganization : ld.hiringOrganization?.name;
  return {
    source: "link",
    sourceId: shortId(url),
    company: org || hostCompany(url),
    title: decodeEntities(htmlToText(ld.title ?? "")), // some sites double-encode titles
    location: location || (ld.jobLocationType === "TELECOMMUTE" ? "Remote" : ""),
    countries: countriesFrom(location),
    workMode: ld.jobLocationType === "TELECOMMUTE" ? "remote" : workModeFrom(location, ld.title),
    url,
    description,
    postedAt: ld.datePosted ? new Date(ld.datePosted).toISOString() : null,
    salary: salaryFrom(ld) ?? parseSalaryText(htmlToText(description)),
  };
}

/** Renders the page in Chromium for sites that build the job description with JavaScript. */
async function renderedPage(url: string): Promise<{ html: string; title: string; text: string }> {
  const browser = await sharedBrowser();
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 45_000 });
    return {
      html: await page.content(),
      title: await page.title(),
      text: await page.evaluate(() => (document.querySelector("main, article, [role=main]") as HTMLElement | null ?? document.body).innerText),
    };
  } finally {
    await page.close();
  }
}

/**
 * A job from a link: ATS API for Greenhouse/Lever/Ashby/SmartRecruiters (with application
 * questions later), JSON-LD for most other career sites, rendered page text as a last resort.
 */
export async function jobFromUrl(url: string): Promise<RawJob> {
  const link = parseAtsLink(url);
  if (link) return fetchAtsPosting(link);

  const res = await fetchText(url).catch(() => null);
  if (res && (res.status === 404 || res.status === 410)) throw new Error("Page not found - the posting may be closed.");
  const ld = res && res.status < 400 ? jobPostingFromHtml(res.text) : null;
  if (ld) return fromJsonLd(ld, url);

  const page = await renderedPage(url);
  const renderedLd = jobPostingFromHtml(page.html);
  if (renderedLd) return fromJsonLd(renderedLd, url);
  if (/not found|404|no longer available|page doesn.t exist|error/i.test(page.title)) {
    throw new Error("Page not found - the posting may be closed.");
  }
  if (page.text.trim().length < 600) {
    throw new Error("Couldn't read a job description on this page (it may need a login). Paste the details instead.");
  }
  const [title = "Untitled role", company] = page.title.split(/\s+[|–—-]\s+/);
  return {
    source: "link",
    sourceId: shortId(url),
    company: company?.trim() || hostCompany(url),
    title: title.trim(),
    location: "",
    countries: [],
    workMode: workModeFrom(page.text.slice(0, 3000)),
    url,
    description: page.text.slice(0, 20_000),
    postedAt: null,
    salary: parseSalaryText(page.text),
  };
}

/**
 * Pasted application questions, one per line. A trailing "*" or "(required)" marks a required
 * question; leading bullets and numbers are ignored.
 */
export function parseQuestions(text: string): ApplicationQuestion[] {
  return text
    .split("\n")
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter(Boolean)
    .map((line, i) => {
      const required = /(\*|\(required\))\s*$/i.test(line);
      const label = line.replace(/\s*(\*|\(required\))\s*$/i, "").trim();
      return { id: `q${i + 1}`, label, required, type: "textarea" as const, standardKey: matchStandard(label) ?? undefined };
    });
}

export interface PastedJob {
  company: string;
  title: string;
  location?: string;
  url?: string;
  description: string;
  questions?: string;
}

export function jobFromPaste(p: PastedJob): { raw: RawJob; questions: ApplicationQuestion[] | null } {
  const location = p.location?.trim() ?? "";
  const url = p.url?.trim() || `manual:${shortId(`${p.company}|${p.title}|${p.description.slice(0, 200)}`)}`;
  return {
    raw: {
      source: "manual",
      sourceId: shortId(url),
      company: p.company.trim(),
      title: p.title.trim(),
      location,
      countries: countriesFrom(location),
      workMode: workModeFrom(location, p.description.slice(0, 3000)),
      url,
      description: p.description,
      postedAt: null,
      salary: parseSalaryText(p.description),
    },
    questions: p.questions?.trim() ? parseQuestions(p.questions) : null,
  };
}
