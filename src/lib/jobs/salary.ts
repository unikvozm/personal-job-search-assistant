import type { Config, SalarySpec } from "../config";
import type { Salary } from "./types";

const PERIOD_TO_YEAR = { year: 1, month: 12, hour: 2080 } as const;

const SYMBOLS: Record<string, string> = { "€": "EUR", $: "USD", "£": "GBP", CHF: "CHF" };

type Search = Config["search"];

const baseCurrency = (search: Search) => search.fxBase ?? search.minSalary?.currency ?? "EUR";

/** Amount in the fx base currency, or null when the rate is unknown. */
function toBase(amount: number, currency: string, search: Search): number | null {
  if (currency === baseCurrency(search)) return amount;
  const rate = search.fx[currency];
  return rate == null ? null : amount * rate;
}

/** Yearly upper bound of a salary in the fx base currency, or null when not comparable. */
export function yearlyInBase(salary: Salary, search: Search): number | null {
  const amount = salary.max ?? salary.min;
  if (amount == null) return null;
  return toBase(amount * PERIOD_TO_YEAR[salary.period], salary.currency, search);
}

function floorInBase(floor: SalarySpec, search: Search): number | null {
  return toBase(floor.amount * PERIOD_TO_YEAR[floor.period], floor.currency, search);
}

/**
 * The minimum salary that applies to a job: the lowest per-country floor among the job's
 * countries, else the default `minSalary` (worldwide remote, unknown location).
 */
export function floorFor(countries: string[], search: Search): SalarySpec | undefined {
  const specific = countries.flatMap((c) => (search.minSalaryByCountry[c] ? [search.minSalaryByCountry[c]] : []));
  if (!specific.length) return search.minSalary;
  return specific.reduce((low, f) => ((floorInBase(f, search) ?? Infinity) < (floorInBase(low, search) ?? Infinity) ? f : low));
}

/**
 * True only when the posting states a salary that is clearly below the floor for its country.
 * Unknown currency or no salary → false (never hide what we can't compare).
 */
export function isBelowMin(salary: Salary | null, countries: string[], search: Search): boolean {
  const floor = floorFor(countries, search);
  if (!salary || !floor) return false;
  const offered = yearlyInBase(salary, search);
  const min = floorInBase(floor, search);
  if (offered == null || min == null) return false;
  return offered < min;
}

const NUM = String.raw`(\d{1,3}(?:[.,\s]\d{3})+|\d+(?:[.,]\d+)?)\s*(k)?`;

function toNumber(raw: string, k: string | undefined): number {
  const cleaned = /[.,\s]\d{3}$/.test(raw) ? raw.replace(/[.,\s]/g, "") : raw.replace(",", ".");
  return Number(cleaned) * (k ? 1000 : 1);
}

/**
 * Cheap regex pass for salaries in free text ("€70,000 – €85,000 per year", "$120k-$150k").
 * The LLM scorer extracts salaries the regex misses.
 */
export function parseSalaryText(text: string): Salary | null {
  const re = new RegExp(String.raw`(€|\$|£|EUR|USD|GBP|CHF)\s*${NUM}\s*(?:-|–|—|to|bis)\s*(?:€|\$|£|EUR|USD|GBP|CHF)?\s*${NUM}`, "i");
  const m = text.match(re);
  if (!m) return null;
  const currency = SYMBOLS[m[1]!] ?? m[1]!.toUpperCase();
  const min = toNumber(m[2]!, m[3]);
  const max = toNumber(m[4]!, m[5]);
  const tail = text.slice(m.index! + m[0].length, m.index! + m[0].length + 30).toLowerCase();
  const period = /hour|hr|stunde/.test(tail) ? "hour" : /month|monat|mo\b/.test(tail) ? "month" : "year";
  if (period === "year" && max < 1000) return null; // "$5 - $10" is not a yearly salary
  return { min, max, currency, period };
}

export function formatSalary(s: Salary | null): string {
  if (!s) return "";
  const fmt = (n: number | null) => (n == null ? "?" : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
  const range = s.min != null && s.max != null && s.min !== s.max ? `${fmt(s.min)}–${fmt(s.max)}` : fmt(s.max ?? s.min);
  return `${range} ${s.currency}/${s.period === "year" ? "yr" : s.period === "month" ? "mo" : "h"}`;
}
