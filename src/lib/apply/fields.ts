import type { Config } from "../config";
import { countriesFrom } from "../sources/geo";
import type { ApplicationQuestion, Job } from "../jobs/types";

type Resolver = (config: Config, job: Job, q: ApplicationQuestion) => string | null;

const yesNo = (v: boolean) => (v ? "Yes" : "No");

/** "DE" → "Germany" (forms list country names, configs.md stores codes). */
export function countryName(code: string): string {
  if (!/^[A-Z]{2}$/i.test(code)) return code;
  return new Intl.DisplayNames(["en"], { type: "region" }).of(code.toUpperCase()) ?? code;
}

/** Country the question is about: named in the label, else the job's first country, else home country. */
function questionCountry(q: ApplicationQuestion, job: Job, config: Config): string {
  return countriesFrom(q.label)[0] ?? job.countries[0] ?? config.profile.country;
}

/**
 * Standard form fields answered straight from configs.md - no LLM involved.
 * Order matters: the first matching pattern wins.
 */
const STANDARD: [string, RegExp, Resolver][] = [
  ["resume", /\b(resume|cv|curriculum)\b/i, () => "__RESUME__"],
  ["coverLetter", /cover letter/i, () => null],
  ["firstName", /\b(first|given|preferred first) name\b/i, (c) => c.profile.firstName],
  ["lastName", /\b(last|family|sur) ?name\b/i, (c) => c.profile.lastName],
  ["fullName", /^(full )?name\b/i, (c) => `${c.profile.firstName} ${c.profile.lastName}`],
  ["email", /e-?mail/i, (c) => c.profile.email],
  ["phone", /phone|mobile/i, (c) => c.profile.phone || null],
  ["linkedin", /linkedin/i, (c) => c.profile.linkedin || null],
  ["github", /github/i, (c) => c.profile.github || null],
  ["website", /website|portfolio|personal (site|url)/i, (c) => c.profile.website || c.profile.github || null],
  ["sponsorship", /sponsor/i, (c, j, q) => {
    const a = c.workAuthorization[questionCountry(q, j, c)];
    return a ? yesNo(a.needsSponsorship) : null;
  }],
  ["workAuthorization", /(authori[sz]ed|eligible|right) to work|work (permit|authori[sz]ation)/i, (c, j, q) => {
    const a = c.workAuthorization[questionCountry(q, j, c)];
    return a ? yesNo(a.authorized) : null;
  }],
  ["noticePeriod", /notice period/i, (c) => c.profile.noticePeriod || null],
  ["startDate", /start date|earliest start|available to start|availability/i, (c) => c.profile.earliestStart || null],
  ["salary", /salary|compensation|pay expectation/i, (c) => c.profile.salaryExpectation || null],
  ["howDidYouHear", /how did you (hear|find)|referral source|^source$/i, (c) => c.profile.howDidYouHear || null],
  ["country", /^country\b|country (where )?you (currently )?(reside|live)|country of residence/i, (c) => countryName(c.profile.country) || null],
  ["location", /^(location|city|current (city|location))\b|where are you (based|located)|current address/i, (c) => [c.profile.city, countryName(c.profile.country)].filter(Boolean).join(", ") || null],
  ["eeo", /gender|race|ethnic|veteran|disability|pronoun|sexual orientation|hispanic/i, (c) => (c.profile.eeo === "decline" ? "__DECLINE__" : null)],
];

export function matchStandard(label: string): string | null {
  return STANDARD.find(([, re]) => re.test(label))?.[0] ?? null;
}

/** Picks the option that best matches a desired value (e.g. "Yes", or a decline option for EEO). */
export function pickOption(options: string[], value: string): string | null {
  if (!options.length) return value;
  if (value === "__DECLINE__") {
    return options.find((o) => /decline|prefer not|don.t wish|do not wish|not to (say|disclose|answer)/i.test(o)) ?? null;
  }
  const v = value.toLowerCase();
  return options.find((o) => o.toLowerCase() === v) ?? options.find((o) => o.toLowerCase().startsWith(v)) ?? null;
}

/** Value for a standard question, or null when configs.md doesn't have it. */
export function standardValue(config: Config, job: Job, q: ApplicationQuestion): string | null {
  const entry = STANDARD.find(([key]) => key === q.standardKey);
  if (!entry) return null;
  const value = entry[2](config, job, q);
  if (value == null) return null;
  if (q.options?.length) return pickOption(q.options, value);
  return value === "__DECLINE__" ? null : value;
}
