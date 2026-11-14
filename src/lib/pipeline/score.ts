import type { Config } from "../config";
import { readCv } from "../config";
import { jobsRepo, runsRepo } from "../db";
import { fetchQuestions } from "../apply/questions";
import { standardValue } from "../apply/fields";
import { closeSharedBrowser } from "../apply/browser";
import { isBelowMin } from "../jobs/salary";
import type { ApplicationQuestion, Job, JobStatus } from "../jobs/types";
import { getBackend, guardBudget, type LlmTask } from "../llm";
import type { TaskResults } from "../llm/types";
import { CLASSIFY_SYSTEM, ClassifySchema, SCORE_SYSTEM, ScoreSchema, candidateContext, classifyPrompt, scorePrompt } from "../llm/prompts";
import { pMap } from "../sources/http";
import { loadStories, storyIndex } from "../stories";
import { z } from "zod";

export interface StepOptions {
  allowOverBudget?: boolean;
  log?: (m: string) => void;
}

/** Step 2 - score every unscored job against the CV, then classify application questions for the good ones. */
export async function scoreJobs(config: Config, opts: StepOptions = {}) {
  const log = opts.log ?? console.log;
  const jobs = jobsRepo.byStatus("new");
  if (!jobs.length) {
    log("No new jobs to score.");
    return { scored: 0 };
  }
  const run = runsRepo.start("score");
  try {
    const backend = getBackend(config);
    const context = candidateContext(readCv(), config);
    const tasks: LlmTask<z.infer<typeof ScoreSchema>>[] = jobs.map((job) => ({
      id: job.id,
      step: "score",
      tier: "score",
      system: SCORE_SYSTEM,
      context,
      prompt: scorePrompt(job),
      schema: ScoreSchema,
      maxTokens: 4000,
      effort: "low",
    }));
    const batch = backend.name === "api" && config.llm.useBatch;
    const usd = guardBudget(config, tasks, batch, opts.allowOverBudget);
    log(`Scoring ${jobs.length} jobs with ${backend.name}${batch ? " (batch)" : ""}${usd ? `, est. $${usd.toFixed(2)}` : ""}`);

    const results = await backend.runMany(tasks, { batch, onProgress: log });
    const { threshold } = config.scoring;
    const good: Job[] = [];
    let failed = 0;
    for (const job of jobs) {
      const r = results.get(job.id);
      if (!r || r instanceof Error) {
        failed++;
        log(`  ${job.company} — ${job.title}: ${r?.message ?? "no result"} (will retry next run)`);
        continue;
      }
      const salary = job.salary ?? r.salary;
      const belowMinSalary = isBelowMin(salary, config.search.minSalary, config.search.fx);
      const status: JobStatus = !r.eligible ? "ineligible" : r.score <= threshold ? "below_threshold" : "scored";
      jobsRepo.saveScore(job.id, {
        status,
        score: r.score,
        result: r,
        salary,
        salarySource: job.salary ? "posting" : r.salary ? "llm" : null,
        belowMinSalary,
      });
      if (status === "scored" && !belowMinSalary) good.push({ ...job, score: r.score, scoreResult: r, salary });
    }
    log(`${good.length} jobs above ${threshold}. Reading their application forms…`);
    await classifyQuestions(config, good, opts);
    const stats = { scored: jobs.length - failed, failed, aboveThreshold: good.length };
    runsRepo.finish(run.id, stats);
    return stats;
  } catch (e) {
    runsRepo.fail(run.id, (e as Error).message);
    throw e;
  } finally {
    await closeSharedBrowser();
  }
}

/**
 * Marks each job auto-fillable (ticked) when every required question can be answered from
 * configs.md or the story bank, or needs-input (unticked) otherwise.
 */
export async function classifyQuestions(config: Config, jobs: Job[], opts: StepOptions = {}) {
  const log = opts.log ?? console.log;
  const withQuestions = await pMap(jobs, 3, async (job) => {
    try {
      return { job, questions: await fetchQuestions(job) };
    } catch (e) {
      log(`  ${job.company}: could not read form (${(e as Error).message.split("\n")[0]})`);
      return { job, questions: null };
    }
  });

  const isCustom = (q: ApplicationQuestion) => !q.standardKey && q.type !== "file";
  const custom = withQuestions.filter((w) => w.questions?.some(isCustom));
  const context = `<candidate>\n<cv>\n${readCv()}\n</cv>\n<stories>\n${storyIndex(loadStories())}\n</stories>\n</candidate>`;
  const tasks: LlmTask<z.infer<typeof ClassifySchema>>[] = custom.map(({ job, questions }) => ({
    id: job.id,
    step: "classify",
    tier: "score",
    system: CLASSIFY_SYSTEM,
    context,
    prompt: classifyPrompt(job, questions!.filter(isCustom)),
    schema: ClassifySchema,
    maxTokens: 3000,
    effort: "low",
  }));
  const backend = getBackend(config);
  const batch = backend.name === "api" && config.llm.useBatch;
  if (tasks.length) guardBudget(config, tasks, batch, opts.allowOverBudget);
  const results: TaskResults<z.infer<typeof ClassifySchema>> = tasks.length
    ? await backend.runMany(tasks, { batch, onProgress: log })
    : new Map();

  for (const { job, questions } of withQuestions) {
    if (!questions) {
      jobsRepo.saveQuestions(job.id, null, false);
      continue;
    }
    const verdicts = results.get(job.id);
    const byId = new Map(verdicts && !(verdicts instanceof Error) ? verdicts.questions.map((v) => [v.id, v]) : []);
    const tagged = questions.map((q): ApplicationQuestion => {
      if (q.standardKey) return { ...q, answerable: standardValue(config, job, q) != null || !q.required };
      if (q.type === "file") return { ...q, answerable: !q.required };
      const v = byId.get(q.id);
      return { ...q, answerable: v?.answerable ?? false, storyIds: v?.storyIds, reason: v?.reason };
    });
    jobsRepo.saveQuestions(job.id, tagged, tagged.every((q) => q.answerable || !q.required));
  }
}
