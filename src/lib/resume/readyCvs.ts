import fs from "node:fs";
import path from "node:path";
import type { Config } from "../config";
import type { Job } from "../jobs/types";
import { paths } from "../paths";
import { familyFor } from "./families";
import { paperFor, renderPdf, type Paper } from "./render";

/**
 * Ready CVs: cvs/<family>.md, one per role family, written and edited by you (or generated once
 * with `pnpm jobs cvs --generate`). Jobs are scored against them and applications use them as
 * they are; a resume for a single posting is only written when you ask ("Tailor for this job").
 */
export interface ReadyCv {
  family: string;
  md: string;
  /** File name recruiters see, without extension, e.g. Alex_Example_CV_Frontend_Platform. */
  name: string;
  pdf: Record<Paper, string>;
}

const titleCase = (family: string) => family.split(/[-_\s]+/).filter(Boolean).map((w) => w[0]!.toUpperCase() + w.slice(1)).join("_");

export function readyCvs(config: Config): ReadyCv[] {
  if (!fs.existsSync(paths.cvs)) return [];
  const person = `${config.profile.firstName}_${config.profile.lastName}`.replace(/\s+/g, "_");
  return fs
    .readdirSync(paths.cvs)
    .filter((f) => f.endsWith(".md") && !/^readme/i.test(f))
    .sort()
    .map((f) => {
      const family = f.slice(0, -3);
      const name = `${person}_CV_${titleCase(family)}`;
      return {
        family,
        md: path.join(paths.cvs, f),
        name,
        pdf: { Letter: path.join(paths.cvs, `${name}.pdf`), A4: path.join(paths.cvs, `${name}_A4.pdf`) },
      };
    });
}

const mtime = (f: string) => (fs.existsSync(f) ? fs.statSync(f).mtimeMs : 0);

export interface RenderReport {
  family: string;
  paper: Paper;
  file: string;
  pages: number;
  rendered: boolean;
}

/** Renders the PDFs of every ready CV whose Markdown changed (no AI involved). */
export async function renderReadyCvs(config: Config, force = false): Promise<RenderReport[]> {
  const out: RenderReport[] = [];
  for (const cv of readyCvs(config)) {
    const markdown = fs.readFileSync(cv.md, "utf8");
    for (const paper of ["Letter", "A4"] as Paper[]) {
      const file = cv.pdf[paper];
      if (!force && mtime(file) >= mtime(cv.md)) {
        out.push({ family: cv.family, paper, file, pages: 1, rendered: false });
        continue;
      }
      const r = await renderPdf(markdown, cv.name.replace(/_/g, " "), file, paper);
      out.push({ family: cv.family, paper, file, pages: r.pages, rendered: true });
    }
  }
  return out;
}

/** The ready CV that fits a job (scorer's pick, else by the job's words), or null when there are none. */
export function readyCvFor(job: Pick<Job, "title" | "description" | "scoreResult">, config: Config, family?: string): ReadyCv | null {
  const cvs = readyCvs(config);
  const pick = family ?? familyFor(job, cvs.map((c) => c.family));
  return cvs.find((c) => c.family === pick) ?? null;
}

/** The PDF to attach for a job's country (Letter for the US, A4 elsewhere). */
export const readyCvPdf = (cv: ReadyCv, countries: string[]) => cv.pdf[paperFor(countries)];

/** Records that a job uses a ready CV (no copy: edits to the ready CV apply everywhere). */
export function useReadyCv(job: Pick<Job, "countries" | "title" | "company">, cv: ReadyCv, jobDir: string) {
  fs.writeFileSync(path.join(jobDir, "resume-source.txt"), `family:${cv.family}`);
  fs.writeFileSync(
    path.join(jobDir, "changes.md"),
    [
      `# Resume for ${job.title} — ${job.company}`,
      "",
      `- Attach your ready CV **${path.basename(readyCvPdf(cv, job.countries))}** (${cv.family}).`,
      "- Want a resume written for this posting instead? Click “Tailor for this job” on the job page.",
    ].join("\n"),
  );
}

/** The PDF to attach for a job: its ready CV (paper by country) or the resume written for it. */
export function resumeFileFor(job: Pick<Job, "countries">, jobDir: string | null, config: Config): string | null {
  if (!jobDir || !fs.existsSync(jobDir)) return null;
  const sourceFile = path.join(jobDir, "resume-source.txt");
  const source = fs.existsSync(sourceFile) ? fs.readFileSync(sourceFile, "utf8").trim() : "";
  if (source.startsWith("family:")) {
    const cv = readyCvs(config).find((c) => c.family === source.slice("family:".length));
    const file = cv ? readyCvPdf(cv, job.countries) : null;
    return file && fs.existsSync(file) ? file : null;
  }
  const pdf = fs.readdirSync(jobDir).find((f) => f.endsWith(".pdf"));
  return pdf ? path.join(jobDir, pdf) : null;
}
