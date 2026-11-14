import type { Config } from "../config";
import { targetCompanies } from "./ats";
import { ADZUNA_COUNTRIES, adzuna, arbeitnow, himalayas, jobicy, remoteok, remotive } from "./boards";
import type { Source } from "./types";

const DACH = ["DE", "AT", "CH"];

/**
 * Picks job sources from the countries in configs.md.
 * - Target companies (ATS boards) always run: first-party, always live, best data.
 * - Remote boards run when remote work is wanted.
 * - National boards run for the countries they cover.
 */
export function selectSources(config: Config): Source[] {
  const { countries, workModes, targetCompanies: companies } = config.search;
  const sources: Source[] = [];
  if (companies.length) sources.push(targetCompanies);
  if (workModes.includes("remote") || countries.includes("REMOTE")) sources.push(remotive, remoteok, himalayas, jobicy);
  if (countries.some((c) => DACH.includes(c))) sources.push(arbeitnow);
  if (countries.some((c) => c in ADZUNA_COUNTRIES)) sources.push(adzuna);
  return sources;
}

/** Shown in the UI and docs so you know what a country setting buys you. */
export function describeSources(config: Config): string[] {
  const notes = selectSources(config).map((s) => s.name);
  if (selectSources(config).includes(adzuna) && !(process.env.ADZUNA_APP_ID && process.env.ADZUNA_APP_KEY)) {
    notes.push("adzuna skipped: add ADZUNA_APP_ID / ADZUNA_APP_KEY to .env.local for national boards");
  }
  return notes;
}
