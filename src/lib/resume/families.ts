import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Job } from "../jobs/types";
import { ensureDir, paths } from "../paths";
import { hooksOf, newNumbers, paperFor, renderPdf, type Paper } from "./render";

/**
 * Role families are the named hook variants in CV.md (<!-- hook:name -->). Each family gets one
 * resume written once (re-written only when CV.md changes); jobs below applications.tailorMinScore
 * use it instead of a per-job resume.
 */
export function roleFamilies(cv: string): string[] {
  return hooksOf(cv).flatMap((h) => (h.variant ? [h.variant] : []));
}

export const familyDir = (family: string) => path.join(paths.resumes, "_families", family);
const cvHash = (cv: string) => createHash("sha1").update(cv).digest("hex");
const PAPERS: Paper[] = ["Letter", "A4"];
const pdfName = (paper: Paper) => `resume-${paper.toLowerCase()}.pdf`;

/** The family closest to a job: the scorer's pick, else the family whose name words appear most in the job. */
export function familyFor(job: Pick<Job, "title" | "description" | "scoreResult">, families: string[]): string | null {
  if (!families.length) return null;
  const picked = job.scoreResult?.roleFamily;
  if (picked && families.includes(picked)) return picked;
  const text = `${job.title} ${job.title} ${job.description.slice(0, 3000)}`.toLowerCase();
  const score = (f: string) => f.split("-").filter((w) => w.length > 2 && text.includes(w)).length;
  return families.reduce((best, f) => (score(f) > score(best) ? f : best), families[0]!);
}

/** True when the family resume exists and was made from the current CV.md. */
export function familyIsFresh(family: string, cv: string): boolean {
  const dir = familyDir(family);
  const hashFile = path.join(dir, "cv.sha1");
  return fs.existsSync(hashFile) && fs.readFileSync(hashFile, "utf8") === cvHash(cv) && PAPERS.every((p) => fs.existsSync(path.join(dir, pdfName(p))));
}

/** Saves and renders a family resume in both paper sizes. Returns warnings (changed hook, new numbers, >1 page). */
export async function writeFamilyResume(family: string, markdown: string, cv: string, name: string): Promise<string[]> {
  const dir = ensureDir(familyDir(family));
  const warnings: string[] = [];
  const hook = hooksOf(cv).find((h) => h.variant === family);
  if (hook && !markdown.includes(hook.text)) warnings.push("The hook sentence was changed - check the summary.");
  const invented = newNumbers(cv, markdown);
  if (invented.length) warnings.push(`Numbers not found in CV.md: ${invented.join(", ")} - verify or remove.`);
  fs.writeFileSync(path.join(dir, "resume.md"), markdown);
  for (const paper of PAPERS) {
    const r = await renderPdf(markdown, name, path.join(dir, pdfName(paper)), paper);
    if (r.pages > 1 && paper === "Letter") warnings.push(`${r.pages} pages even at ${Math.round(r.scale * 100)}% type size - trim resume.md.`);
  }
  fs.writeFileSync(path.join(dir, "warnings.md"), warnings.map((w) => `> ⚠️ ${w}`).join("\n"));
  fs.writeFileSync(path.join(dir, "cv.sha1"), cvHash(cv)); // written last: marks the family as complete
  return warnings;
}

/** Puts the family resume into a job's folder (right paper size) and notes where it came from. */
export function useFamilyResume(job: Pick<Job, "countries" | "title" | "company" | "score">, family: string, jobDir: string, tailorMinScore: number) {
  const src = familyDir(family);
  fs.copyFileSync(path.join(src, "resume.md"), path.join(jobDir, "resume.md"));
  fs.copyFileSync(path.join(src, pdfName(paperFor(job.countries))), path.join(jobDir, "resume.pdf"));
  const warnings = fs.existsSync(path.join(src, "warnings.md")) ? fs.readFileSync(path.join(src, "warnings.md"), "utf8") : "";
  fs.writeFileSync(
    path.join(jobDir, "changes.md"),
    [
      `# Resume for ${job.title} — ${job.company}`,
      "",
      `- Using your **${family}** resume (score ${job.score ?? "?"} is below ${tailorMinScore}, so no resume was written for this posting).`,
      `- Want one tailored to this job? Click “Tailor for this job” on the job page.`,
      "",
      warnings,
    ].join("\n"),
  );
  fs.writeFileSync(path.join(jobDir, "resume-source.txt"), `family:${family}`);
}

/** "tailored", "family:<name>", or null when there is no resume yet. */
export function resumeSource(jobDir: string | null): string | null {
  if (!jobDir) return null;
  const file = path.join(jobDir, "resume-source.txt");
  if (fs.existsSync(file)) return fs.readFileSync(file, "utf8").trim();
  return fs.existsSync(path.join(jobDir, "resume.pdf")) ? "tailored" : null;
}
