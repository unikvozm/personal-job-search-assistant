import fs from "node:fs";
import path from "node:path";
import type { Config } from "../config";
import { applicationsRepo, db, jobsRepo, type ApplicationStatus } from "../db";
import { readStories } from "../config";
import { ensureDir } from "../paths";
import { appendStory, formatAnswerStory, loadStories, nextStoryId } from "../stories";
import { answersMarkdown, resumeDirFor } from "./prepare";
import { resumeFileFor } from "../resume/readyCvs";

const FILLABLE = new Set(["greenhouse", "lever", "ashby"]);

export interface SaveAnswersResult {
  status: ApplicationStatus;
  /** Story ids added to interviewBankStories.md. */
  addedStories: string[];
  /** True when the form should be prefilled again with the new answers. */
  prefill: boolean;
  missing: string[];
}

/**
 * Saves answers you edited: database, the job's answers.md, and - for the questions you tick -
 * the story bank, in your exact words. Questions waiting for your input are resolved, and a
 * "needs input" application moves on to "ready" once every required question has an answer.
 */
export function saveAnswers(config: Config, applicationId: number, input: { answers: Record<string, string>; saveToBank: string[] }): SaveAnswersResult {
  const app = applicationsRepo.get(applicationId);
  if (!app) throw new Error(`Application ${applicationId} not found`);
  const job = jobsRepo.get(app.jobId)!;
  const questions = (job.questions ?? []).filter((q) => q.type !== "file");

  const answers: Record<string, string> = { ...(app.answers ?? {}) };
  for (const [id, value] of Object.entries(input.answers)) {
    if (value.trim()) answers[id] = value.trim();
    else delete answers[id];
  }

  const dir = app.resumeDir ?? ensureDir(resumeDirFor(job));
  fs.writeFileSync(path.join(ensureDir(dir), "answers.md"), answersMarkdown(job, answers, resumeFileFor(job, dir, config)));

  // Questions you answered no longer need a clarifying story.
  const resolve = db().prepare("UPDATE pending_stories SET status = 'approved' WHERE job_id = ? AND question = ? AND status IN ('open', 'drafted')");
  for (const q of questions) if (answers[q.id]) resolve.run(job.id, q.label);

  const addedStories: string[] = [];
  const bank = readStories();
  for (const id of input.saveToBank) {
    const q = questions.find((x) => x.id === id);
    const answer = answers[id];
    if (!q || !answer || q.standardKey || bank.includes(answer)) continue;
    const storyId = nextStoryId(loadStories());
    appendStory(formatAnswerStory(storyId, { question: q.label, answer, company: job.company }));
    addedStories.push(storyId);
  }

  const missing = questions.filter((q) => q.required && !answers[q.id]).map((q) => q.label);
  let status = app.status;
  if (status === "needs_input" && !missing.length) status = "ready";
  applicationsRepo.update(app.id, { answers, status, resumeDir: dir });

  const hasResume = resumeFileFor(job, dir, config) != null;
  const prefill = hasResume && !!job.ats && FILLABLE.has(job.ats) && (status === "ready" || status === "prefilled");
  return { status, addedStories, prefill, missing };
}
