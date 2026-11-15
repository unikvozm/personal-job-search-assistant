import fs from "node:fs";
import path from "node:path";
import type { Job } from "../jobs/types";
import { hooksOf } from "./render";

/** Role families named by the hook variants in CV.md (<!-- hook:name -->). */
export function roleFamilies(cv: string): string[] {
  return hooksOf(cv).flatMap((h) => (h.variant ? [h.variant] : []));
}

/** The family closest to a job: the scorer's pick, else the family whose name words appear most in the job. */
export function familyFor(job: Pick<Job, "title" | "description" | "scoreResult">, families: string[]): string | null {
  if (!families.length) return null;
  const picked = job.scoreResult?.roleFamily;
  if (picked && families.includes(picked)) return picked;
  const text = `${job.title} ${job.title} ${job.description.slice(0, 3000)}`.toLowerCase();
  const score = (f: string) => f.split("-").filter((w) => w.length > 2 && text.includes(w)).length;
  return families.reduce((best, f) => (score(f) > score(best) ? f : best), families[0]!);
}

/** "tailored", "family:<name>" (a ready CV), or null when the job has no resume yet. */
export function resumeSource(jobDir: string | null): string | null {
  if (!jobDir || !fs.existsSync(jobDir)) return null;
  const file = path.join(jobDir, "resume-source.txt");
  if (fs.existsSync(file)) return fs.readFileSync(file, "utf8").trim();
  return fs.readdirSync(jobDir).some((f) => f.endsWith(".pdf")) ? "tailored" : null;
}
