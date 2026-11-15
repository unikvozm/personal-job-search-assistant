import fs from "node:fs";
import path from "node:path";
import type { z } from "zod";
import type { Config } from "../config";
import { readCv, readStories } from "../config";
import { applicationsRepo, db, jobsRepo, now, runsRepo, type Application } from "../db";
import { standardValue } from "../apply/fields";
import { closeSharedBrowser } from "../apply/browser";
import type { ApplicationQuestion, Job } from "../jobs/types";
import { getBackend, guardBudget, type LlmTask } from "../llm";
import type { AnswersSchema, TailorSchema } from "../llm/prompts";
import { ensureDir, paths, slugify } from "../paths";
import { resumeSource } from "../resume/families";
import { readyCvFor, readyCvPdf, readyCvs, renderReadyCvs, resumeFileFor, useReadyCv } from "../resume/readyCvs";
import { hooksOf, newNumbers, paperFor, renderPdf } from "../resume/render";
import { loadStories, reusableAnswer, savedAnswers } from "../stories";
import type { StepOptions } from "./score";
import { answersTask, customQuestions, cvAndStories, familyTask, tailorTask } from "./tasks";

export const resumeDirFor = (job: Job) => path.join(paths.resumes, slugify(job.company, job.title, job.id.slice(0, 6)));

export interface PrepareOptions extends StepOptions {
  /** Write a resume for this posting with Claude instead of using the ready CV (only when you ask). */
  tailor?: boolean;
  /** Write the remaining answers now, whatever applications.answers says. */
  writeAnswers?: boolean;
}

/** tailor: written for the posting (on request) · keep: already has one · ready: a cvs/<family>.md · none: no ready CV */
type ResumePlan = "tailor" | "keep" | { ready: string } | "none";

interface JobPlan {
  job: Job;
  dir: string;
  resume: ResumePlan;
  /** Answers known without the LLM: kept edits, configs.md fields, reused saved answers. */
  answers: Record<string, string>;
  reused: number;
  /** Custom questions still without an answer. */
  remaining: ApplicationQuestion[];
}

/** Decides, without any LLM call, what each job needs. */
function plan(config: Config, jobs: Job[], opts: PrepareOptions): JobPlan[] {
  const saved = savedAnswers(loadStories());
  return jobs.map((job) => {
    const existing = applicationsRepo.byJob(job.id);
    const dir = existing?.resumeDir ?? resumeDirFor(job);
    const source = resumeSource(fs.existsSync(dir) ? dir : null);
    let resume: ResumePlan;
    if (opts.tailor) resume = "tailor";
    else if (source) resume = "keep";
    else {
      const ready = readyCvFor(job, config);
      resume = ready ? { ready: ready.family } : "none";
    }

    // Keep answers you already have (edited or earlier written); add configs.md fields and saved answers.
    const answers: Record<string, string> = { ...(existing?.answers ?? {}) };
    for (const q of job.questions ?? []) {
      if (q.standardKey && !answers[q.id]) {
        const v = standardValue(config, job, q);
        if (v != null) answers[q.id] = v;
      }
    }
    let reused = 0;
    for (const q of customQuestions(job)) {
      if (answers[q.id]) continue;
      const hit = reusableAnswer(q.label, job.company, saved);
      if (hit) {
        answers[q.id] = hit.answer;
        reused++;
      }
    }
    return { job, dir, resume, answers, reused, remaining: customQuestions(job).filter((q) => !answers[q.id]) };
  });
}

const writeAnswersNow = (config: Config, opts: PrepareOptions) => opts.writeAnswers || config.applications.answers === "auto";

/** The LLM tasks a prepare run would send (used for the cost estimate and the run itself). */
function tasksFor(config: Config, plans: JobPlan[], cv: string, opts: PrepareOptions): LlmTask<unknown>[] {
  const context = cvAndStories(cv, readStories());
  return [
    ...plans.filter((p) => p.resume === "tailor").map((p) => tailorTask(p.job, cv, config)),
    ...(writeAnswersNow(config, opts) ? plans.filter((p) => p.remaining.length).map((p) => answersTask(p.job, context, p.remaining)) : []),
  ] as LlmTask<unknown>[];
}

/** Tasks for the cost estimate shown before "Apply to selected". */
export function prepareTasks(jobs: Job[], config: Config, opts: PrepareOptions = {}): LlmTask<unknown>[] {
  return tasksFor(config, plan(config, jobs, opts), readCv(), opts);
}

/**
 * Prepares applications for the jobs you selected, as cheaply as the settings allow:
 * - resume: the ready CV (cvs/<family>.md) that fits the job, as it is; a resume for the
 *   posting is only written when you ask ("Tailor for this job");
 * - answers: configs.md fields and saved answers for free; the rest with Claude now
 *   (applications.answers = auto, or "Write answers") or later on demand;
 * - all Claude calls in one Batch API request when llm.batchWriting is on (half price).
 */
export async function prepareApplications(config: Config, jobIds: string[], opts: PrepareOptions = {}) {
  const log = opts.log ?? console.log;
  const run = runsRepo.start("prepare");
  try {
    const counts = { ready: 0, needsInput: 0, awaitingAnswers: 0, duplicate: 0, failed: 0, reusedAnswers: 0, readyCvs: 0, tailored: 0 };
    const jobs = jobsRepo.byIds(jobIds).filter((job) => {
      if (applicationsRepo.submittedDuplicates(job.company, job.title, job.id).length || applicationsRepo.byJob(job.id)?.submittedAt) {
        log(`  skip ${job.company} — ${job.title}: already applied`);
        counts.duplicate++;
        return false;
      }
      return true;
    });
    const apps = new Map<string, Application>();
    for (const job of jobs) {
      apps.set(job.id, applicationsRepo.upsert(job.id, "preparing"));
      jobsRepo.setStatus([job.id], "applying");
    }

    const cv = readCv();
    await renderReadyCvs(config); // only re-renders ready CVs you edited; no AI
    const plans = plan(config, jobs, opts);
    const tasks = tasksFor(config, plans, cv, opts);
    const backend = getBackend(config);
    const batch = backend.name === "api" && config.llm.batchWriting;
    const usd = guardBudget(config, tasks, batch, opts.allowOverBudget);
    log(`Preparing ${jobs.length} application(s): ${tasks.length} Claude request(s)${batch ? " in one batch" : ""}${usd ? `, est. $${usd.toFixed(2)}` : ""}`);
    const results = tasks.length ? await backend.runMany(tasks, { batch, onProgress: log }) : new Map<string, unknown>();
    const result = <T>(id: string): T => {
      const r = results.get(id);
      if (r === undefined) throw new Error(`No result for ${id}`);
      if (r instanceof Error) throw r;
      return r as T;
    };

    for (const p of plans) {
      const app = apps.get(p.job.id)!;
      try {
        ensureDir(p.dir);
        if (p.resume === "tailor") {
          await writeTailoredResume(p.job, cv, config, p.dir, result<z.infer<typeof TailorSchema>>(`tailor-${p.job.id}`), log);
          counts.tailored++;
        } else if (typeof p.resume === "object") {
          useReadyCv(p.job, readyCvs(config).find((c) => c.family === (p.resume as { ready: string }).ready)!, p.dir);
          counts.readyCvs++;
        } else if (p.resume === "none") {
          throw new Error("No ready CV in cvs/ - add one (or run `pnpm jobs cvs --generate`), or click “Tailor for this job”");
        }

        const answers = { ...p.answers };
        let open = 0;
        if (writeAnswersNow(config, opts) && p.remaining.length) {
          for (const a of result<z.infer<typeof AnswersSchema>>(`answers-${p.job.id}`).answers) {
            const q = p.remaining.find((c) => c.id === a.id);
            if (!q) continue;
            if (a.needsInput) {
              if (q.required) open++;
              addPendingStory(p.job.id, q.label, a.clarifyingQuestion);
            } else answers[a.id] = a.answer;
          }
        }
        const unansweredRequired = customQuestions(p.job).filter((q) => q.required && !answers[q.id]).length;
        const status = open > 0 ? "needs_input" : unansweredRequired > 0 ? "awaiting_answers" : "ready";
        fs.writeFileSync(path.join(p.dir, "answers.md"), answersMarkdown(p.job, answers, resumeFileFor(p.job, p.dir, config)));
        applicationsRepo.update(app.id, { status, resumeDir: p.dir, answers, notes: "" });
        counts.reusedAnswers += p.reused;
        counts[status === "needs_input" ? "needsInput" : status === "awaiting_answers" ? "awaitingAnswers" : "ready"]++;
        log(`  ${p.job.company} — ${p.job.title}: ${status}${p.reused ? ` (${p.reused} saved answer(s) reused)` : ""}`);
      } catch (e) {
        counts.failed++;
        applicationsRepo.update(app.id, { status: "needs_manual", notes: `Preparation failed: ${(e as Error).message}` });
        log(`  ${p.job.company} — ${p.job.title}: failed (${(e as Error).message})`);
      }
    }
    runsRepo.finish(run.id, counts);
    return counts;
  } catch (e) {
    runsRepo.fail(run.id, (e as Error).message);
    throw e;
  } finally {
    await closeSharedBrowser();
  }
}

async function writeTailoredResume(job: Job, cv: string, config: Config, dir: string, out: z.infer<typeof TailorSchema>, log: (m: string) => void) {
  const warnings: string[] = [];
  const hooks = hooksOf(cv);
  if (hooks.length && !hooks.some((h) => out.markdown.includes(h.text))) warnings.push("The hook sentence was changed - check the summary.");
  const invented = newNumbers(cv, out.markdown);
  if (invented.length) warnings.push(`Numbers not found in CV.md: ${invented.join(", ")} - verify or remove.`);
  fs.writeFileSync(path.join(dir, "resume.md"), out.markdown);
  for (const f of fs.readdirSync(dir)) if (f.endsWith(".pdf")) fs.rmSync(path.join(dir, f)); // replace an earlier tailored PDF
  const person = `${config.profile.firstName}_${config.profile.lastName}`.replace(/\s+/g, "_");
  const company = job.company.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const pdf = path.join(dir, `${person}_CV_${company}.pdf`);
  const rendered = await renderPdf(out.markdown, `${config.profile.firstName} ${config.profile.lastName} — ${job.title}`, pdf, paperFor(job.countries));
  if (rendered.pages > 1) warnings.push(`The PDF is ${rendered.pages} pages even at ${Math.round(rendered.scale * 100)}% type size - trim bullets in resume.md and re-render.`);
  fs.writeFileSync(
    path.join(dir, "changes.md"),
    [`# Changes for ${job.title} — ${job.company}`, "", ...out.changes.map((c) => `- ${c}`), "", `Keywords: ${out.keywordsUsed.join(", ")}`, "", ...warnings.map((w) => `> ⚠️ ${w}`)].join("\n"),
  );
  fs.writeFileSync(path.join(dir, "resume-source.txt"), "tailored");
  if (warnings.length) log(`    ⚠️ ${warnings.join(" ")}`);
}

function addPendingStory(jobId: string, question: string, clarifying: string) {
  const exists = db().prepare("SELECT 1 FROM pending_stories WHERE job_id = ? AND question = ? AND status = 'open'").get(jobId, question);
  if (exists) return;
  db()
    .prepare("INSERT INTO pending_stories (job_id, question, clarifying_question, created_at) VALUES (?,?,?,?)")
    .run(jobId, question, clarifying, now());
}

export function answersMarkdown(job: Job, answers: Record<string, string>, resumeFile: string | null = null): string {
  const lines = [`# Application answers — ${job.title} at ${job.company}`, ""];
  if (resumeFile) lines.push(`**CV to attach:** ${path.basename(resumeFile)}`, "");
  for (const q of job.questions ?? []) {
    if (q.type === "file") continue;
    lines.push(`## ${q.label}${q.required ? " *" : ""}`, "", answers[q.id] ?? "_not written yet_", "");
  }
  return lines.join("\n");
}
