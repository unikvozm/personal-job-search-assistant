import fs from "node:fs";
import path from "node:path";
import type { Config } from "../config";
import { readCv, readStories } from "../config";
import { applicationsRepo, db, jobsRepo, now, runsRepo } from "../db";
import { standardValue } from "../apply/fields";
import { closeSharedBrowser } from "../apply/browser";
import type { Job } from "../jobs/types";
import { getBackend, guardBudget, type LlmTask } from "../llm";
import { ensureDir, paths, slugify } from "../paths";
import { hooksOf, newNumbers, paperFor, renderPdf } from "../resume/render";
import type { StepOptions } from "./score";
import { answersTask, customQuestions, cvAndStories, tailorTask } from "./tasks";

export const resumeDirFor = (job: Job) => path.join(paths.resumes, slugify(job.company, job.title, job.id.slice(0, 6)));

/** Estimated USD for preparing these jobs (0 in claude-code mode). */
export function prepareTasks(jobs: Job[], config: Config): LlmTask<unknown>[] {
  const cv = readCv();
  const context = cvAndStories(cv, readStories());
  return jobs.flatMap((job) => [
    tailorTask(job, cv, config),
    ...(customQuestions(job).length ? [answersTask(job, context)] : []),
  ]) as LlmTask<unknown>[];
}

/**
 * Step 3 + 4 for the jobs you selected: tailored resume (md + pdf) and application answers.
 * Questions without a supporting story become clarifying questions on the Stories page.
 */
export async function prepareApplications(config: Config, jobIds: string[], opts: StepOptions = {}) {
  const log = opts.log ?? console.log;
  const jobs = jobsRepo.byIds(jobIds);
  const run = runsRepo.start("prepare");
  try {
    const backend = getBackend(config);
    const usd = guardBudget(config, prepareTasks(jobs, config), false, opts.allowOverBudget);
    log(`Preparing ${jobs.length} applications${usd ? `, est. $${usd.toFixed(2)}` : ""}`);
    const cv = readCv();
    const context = cvAndStories(cv, readStories());
    const counts = { ready: 0, needsInput: 0, duplicate: 0, failed: 0 };

    for (const job of jobs) {
      const dupes = applicationsRepo.submittedDuplicates(job.company, job.title, job.id);
      if (dupes.length || applicationsRepo.byJob(job.id)?.submittedAt) {
        log(`  skip ${job.company} — ${job.title}: already applied`);
        counts.duplicate++;
        continue;
      }
      const app = applicationsRepo.upsert(job.id, "preparing");
      jobsRepo.setStatus([job.id], "applying");
      try {
        const dir = ensureDir(resumeDirFor(job));
        if (!fs.existsSync(path.join(dir, "resume.pdf"))) await tailor(job, cv, config, dir, log);
        const { answers, open } = await answer(job, context, config);
        fs.writeFileSync(path.join(dir, "answers.md"), answersMarkdown(job, answers));
        const status = open > 0 ? "needs_input" : "ready";
        applicationsRepo.update(app.id, { status, resumeDir: dir, answers });
        counts[open > 0 ? "needsInput" : "ready"]++;
        log(`  ${job.company} — ${job.title}: ${status}${open ? ` (${open} question(s) need your input)` : ""}`);
      } catch (e) {
        counts.failed++;
        applicationsRepo.update(app.id, { status: "needs_manual", notes: `Preparation failed: ${(e as Error).message}` });
        log(`  ${job.company} — ${job.title}: failed (${(e as Error).message})`);
      }
    }
    runsRepo.finish(run.id, counts);
    return counts;

    async function tailor(job: Job, cvText: string, cfg: Config, dir: string, logFn: (m: string) => void) {
      const out = await backend.run(tailorTask(job, cvText, cfg));
      const warnings: string[] = [];
      const hooks = hooksOf(cvText);
      if (hooks.length && !hooks.some((h) => out.markdown.includes(h.text))) warnings.push("The hook sentence was changed - check the summary.");
      const invented = newNumbers(cvText, out.markdown);
      if (invented.length) warnings.push(`Numbers not found in CV.md: ${invented.join(", ")} - verify or remove.`);
      fs.writeFileSync(path.join(dir, "resume.md"), out.markdown);
      const rendered = await renderPdf(
        out.markdown,
        `${cfg.profile.firstName} ${cfg.profile.lastName} — ${job.title}`,
        path.join(dir, "resume.pdf"),
        paperFor(job.countries),
      );
      if (rendered.pages > 1) warnings.push(`The PDF is ${rendered.pages} pages even at ${Math.round(rendered.scale * 100)}% type size - trim bullets in resume.md and re-render.`);
      fs.writeFileSync(
        path.join(dir, "changes.md"),
        [`# Changes for ${job.title} — ${job.company}`, "", ...out.changes.map((c) => `- ${c}`), "", `Keywords: ${out.keywordsUsed.join(", ")}`, "", ...warnings.map((w) => `> ⚠️ ${w}`)].join("\n"),
      );
      if (warnings.length) logFn(`    ⚠️ ${warnings.join(" ")}`);
    }

    async function answer(job: Job, ctx: string, cfg: Config) {
      const answers: Record<string, string> = {};
      for (const q of job.questions ?? []) {
        if (!q.standardKey) continue;
        const v = standardValue(cfg, job, q);
        if (v != null) answers[q.id] = v;
      }
      let open = 0;
      const custom = customQuestions(job);
      if (custom.length) {
        const out = await backend.run(answersTask(job, ctx));
        for (const a of out.answers) {
          const q = custom.find((c) => c.id === a.id);
          if (!q) continue;
          if (a.needsInput) {
            if (q.required) open++;
            addPendingStory(job.id, q.label, a.clarifyingQuestion);
          } else {
            answers[a.id] = a.answer;
          }
        }
      }
      return { answers, open };
    }
  } catch (e) {
    runsRepo.fail(run.id, (e as Error).message);
    throw e;
  } finally {
    await closeSharedBrowser();
  }
}

function addPendingStory(jobId: string, question: string, clarifying: string) {
  const exists = db().prepare("SELECT 1 FROM pending_stories WHERE job_id = ? AND question = ? AND status = 'open'").get(jobId, question);
  if (exists) return;
  db()
    .prepare("INSERT INTO pending_stories (job_id, question, clarifying_question, created_at) VALUES (?,?,?,?)")
    .run(jobId, question, clarifying, now());
}

export function answersMarkdown(job: Job, answers: Record<string, string>): string {
  const lines = [`# Application answers — ${job.title} at ${job.company}`, ""];
  for (const q of job.questions ?? []) {
    if (q.type === "file") continue;
    lines.push(`## ${q.label}${q.required ? " *" : ""}`, "", answers[q.id] ?? "_needs your input_", "");
  }
  return lines.join("\n");
}
