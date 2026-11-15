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
import { familyFor, familyIsFresh, resumeSource, roleFamilies, useFamilyResume, writeFamilyResume } from "../resume/families";
import { hooksOf, newNumbers, paperFor, renderPdf } from "../resume/render";
import { loadStories, reusableAnswer, savedAnswers } from "../stories";
import type { StepOptions } from "./score";
import { answersTask, customQuestions, cvAndStories, familyTask, tailorTask } from "./tasks";

export const resumeDirFor = (job: Job) => path.join(paths.resumes, slugify(job.company, job.title, job.id.slice(0, 6)));

export interface PrepareOptions extends StepOptions {
  /** Write a resume for this posting even below applications.tailorMinScore (replaces an existing one). */
  tailor?: boolean;
  /** Write the remaining answers now, whatever applications.answers says. */
  writeAnswers?: boolean;
}

type ResumePlan = "tailor" | "keep" | { family: string };

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
function plan(config: Config, jobs: Job[], cv: string, opts: PrepareOptions): JobPlan[] {
  const families = roleFamilies(cv);
  const saved = savedAnswers(loadStories());
  return jobs.map((job) => {
    const existing = applicationsRepo.byJob(job.id);
    const dir = existing?.resumeDir ?? resumeDirFor(job);
    const source = resumeSource(fs.existsSync(dir) ? dir : null);
    let resume: ResumePlan;
    if (opts.tailor) resume = "tailor";
    else if (source) resume = "keep";
    else if ((job.score ?? 0) >= config.applications.tailorMinScore || !families.length) resume = "tailor";
    else resume = { family: familyFor(job, families)! };

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
  const families = [...new Set(plans.flatMap((p) => (typeof p.resume === "object" ? [p.resume.family] : [])))];
  const context = cvAndStories(cv, readStories());
  return [
    ...families.filter((f) => !familyIsFresh(f, cv)).map((f) => familyTask(f, cv, config)),
    ...plans.filter((p) => p.resume === "tailor").map((p) => tailorTask(p.job, cv, config)),
    ...(writeAnswersNow(config, opts) ? plans.filter((p) => p.remaining.length).map((p) => answersTask(p.job, context, p.remaining)) : []),
  ] as LlmTask<unknown>[];
}

/** Tasks for the cost estimate shown before "Apply to selected". */
export function prepareTasks(jobs: Job[], config: Config, opts: PrepareOptions = {}): LlmTask<unknown>[] {
  const cv = readCv();
  return tasksFor(config, plan(config, jobs, cv, opts), cv, opts);
}

/**
 * Prepares applications for the jobs you selected, as cheaply as the settings allow:
 * - resume: role-family resume (written once per family) below applications.tailorMinScore,
 *   a resume written for the posting above it or when you ask;
 * - answers: configs.md fields and saved answers for free; the rest with Claude now
 *   (applications.answers = auto, or "Write answers") or later on demand;
 * - all Claude calls in one Batch API request when llm.batchWriting is on (half price).
 */
export async function prepareApplications(config: Config, jobIds: string[], opts: PrepareOptions = {}) {
  const log = opts.log ?? console.log;
  const run = runsRepo.start("prepare");
  try {
    const counts = { ready: 0, needsInput: 0, awaitingAnswers: 0, duplicate: 0, failed: 0, reusedAnswers: 0, familyResumes: 0, tailored: 0 };
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
    const plans = plan(config, jobs, cv, opts);
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

    // Family resumes first: jobs below depend on them.
    const name = `${config.profile.firstName} ${config.profile.lastName}`;
    for (const t of tasks.filter((x) => x.id.startsWith("family-"))) {
      const family = t.id.slice("family-".length);
      try {
        const out = result<z.infer<typeof TailorSchema>>(t.id);
        const warnings = await writeFamilyResume(family, out.markdown, cv, name);
        log(`  ${family} resume written${warnings.length ? ` ⚠️ ${warnings.join(" ")}` : ""}`);
      } catch (e) {
        log(`  ${family} resume failed: ${(e as Error).message}`);
      }
    }

    for (const p of plans) {
      const app = apps.get(p.job.id)!;
      try {
        ensureDir(p.dir);
        if (p.resume === "tailor") {
          await writeTailoredResume(p.job, cv, config, p.dir, result<z.infer<typeof TailorSchema>>(`tailor-${p.job.id}`), log);
          counts.tailored++;
        } else if (typeof p.resume === "object") {
          if (!familyIsFresh(p.resume.family, cv)) throw new Error(`The ${p.resume.family} resume could not be written`);
          useFamilyResume(p.job, p.resume.family, p.dir, config.applications.tailorMinScore);
          counts.familyResumes++;
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
        fs.writeFileSync(path.join(p.dir, "answers.md"), answersMarkdown(p.job, answers));
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
  const rendered = await renderPdf(out.markdown, `${config.profile.firstName} ${config.profile.lastName} — ${job.title}`, path.join(dir, "resume.pdf"), paperFor(job.countries));
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

export function answersMarkdown(job: Job, answers: Record<string, string>): string {
  const lines = [`# Application answers — ${job.title} at ${job.company}`, ""];
  for (const q of job.questions ?? []) {
    if (q.type === "file") continue;
    lines.push(`## ${q.label}${q.required ? " *" : ""}`, "", answers[q.id] ?? "_not written yet_", "");
  }
  return lines.join("\n");
}
