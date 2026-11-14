import type { z } from "zod";
import type { Config } from "../config";
import { readCv, readStories } from "../config";
import { db, jobsRepo, now } from "../db";
import { getBackend, guardBudget } from "../llm";
import { FEEDBACK_SYSTEM, FeedbackSchema, PrepSchema, feedbackPrompt, jobBlock } from "../llm/prompts";
import { loadStories } from "../stories";
import { cvAndStories, prepTask } from "./tasks";

export type Prep = z.infer<typeof PrepSchema>;

export function getPrep(jobId: string): Prep | null {
  const row = db().prepare("SELECT content FROM prep WHERE job_id = ?").get(jobId) as { content: string } | undefined;
  return row ? (JSON.parse(row.content) as Prep) : null;
}

/** Step 6 - likely interview questions mapped to your stories, plus questions to ask. */
export async function generatePrep(config: Config, jobId: string, opts: { allowOverBudget?: boolean } = {}): Promise<Prep> {
  const job = jobsRepo.get(jobId);
  if (!job) throw new Error(`Job ${jobId} not found`);
  const task = prepTask(job, cvAndStories(readCv(), readStories()), jobBlock(job));
  guardBudget(config, [task], false, opts.allowOverBudget);
  const prep = await getBackend(config).run(task);
  db()
    .prepare("INSERT INTO prep (job_id, content, created_at) VALUES (?,?,?) ON CONFLICT(job_id) DO UPDATE SET content = excluded.content, created_at = excluded.created_at")
    .run(jobId, JSON.stringify(prep), now());
  return prep;
}

/** Practice mode: short coaching feedback on a typed answer (cheap model). */
export async function practiceFeedback(config: Config, input: { question: string; keyPoints: string[]; storyIds: string[]; answer: string }) {
  const stories = loadStories().filter((s) => input.storyIds.includes(s.id)).map((s) => s.body).join("\n\n");
  const task = {
    id: "feedback",
    step: "feedback" as const,
    tier: "score" as const,
    system: FEEDBACK_SYSTEM,
    prompt: feedbackPrompt(input.question, input.keyPoints, input.answer, stories),
    schema: FeedbackSchema,
    maxTokens: 3000,
    effort: "low" as const,
  };
  guardBudget(config, [task], false);
  return getBackend(config).run(task);
}
