import type { z } from "zod";
import type { Config } from "../config";
import type { ApplicationQuestion, Job } from "../jobs/types";
import type { LlmTask } from "../llm";
import {
  ANSWERS_SYSTEM,
  AnswersSchema,
  PREP_SYSTEM,
  PrepSchema,
  STORY_SYSTEM,
  StorySchema,
  TAILOR_SYSTEM,
  TailorSchema,
  answersPrompt,
  candidateContext,
  storyPrompt,
  tailorPrompt,
} from "../llm/prompts";

/** Task builders, shared by the runners and the cost estimates shown in the UI. */

export const cvAndStories = (cv: string, stories: string) =>
  `<candidate>\n<cv>\n${cv}\n</cv>\n<stories>\n${stories}\n</stories>\n</candidate>`;

export const tailorTask = (job: Job, cv: string, config: Config): LlmTask<z.infer<typeof TailorSchema>> => ({
  id: `tailor-${job.id}`,
  step: "tailor",
  tier: "write",
  system: TAILOR_SYSTEM,
  context: candidateContext(cv, config),
  prompt: tailorPrompt(job),
  schema: TailorSchema,
  maxTokens: 16000,
  effort: "medium",
});

/** Questions the LLM has to answer: not standard profile fields, not file uploads. */
export const customQuestions = (job: Job): ApplicationQuestion[] =>
  (job.questions ?? []).filter((q) => !q.standardKey && q.type !== "file");

export const answersTask = (job: Job, context: string): LlmTask<z.infer<typeof AnswersSchema>> => ({
  id: `answers-${job.id}`,
  step: "answers",
  tier: "write",
  system: ANSWERS_SYSTEM,
  context,
  prompt: answersPrompt(job, customQuestions(job)),
  schema: AnswersSchema,
  maxTokens: 12000,
  effort: "medium",
});

export const storyTask = (id: string, cv: string, question: string, clarifying: string, notes: string): LlmTask<z.infer<typeof StorySchema>> => ({
  id: `story-${id}`,
  step: "story",
  tier: "write",
  system: STORY_SYSTEM,
  context: `<candidate>\n<cv>\n${cv}\n</cv>\n</candidate>`,
  prompt: storyPrompt(question, clarifying, notes),
  schema: StorySchema,
  maxTokens: 4000,
  effort: "low",
});

export const prepTask = (job: Job, context: string, jobText: string): LlmTask<z.infer<typeof PrepSchema>> => ({
  id: `prep-${job.id}`,
  step: "prep",
  tier: "write",
  system: PREP_SYSTEM,
  context,
  prompt: jobText,
  schema: PrepSchema,
  maxTokens: 12000,
  effort: "medium",
});
