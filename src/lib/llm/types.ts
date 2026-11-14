import type { z } from "zod";

export type Step = "score" | "classify" | "tailor" | "answers" | "story" | "prep" | "feedback";

export interface LlmTask<T> {
  /** Unique within a batch; [a-zA-Z0-9_-]{1,64}. */
  id: string;
  step: Step;
  /** "score" = cheap high-volume model, "write" = quality writing model (see configs.md llm.models). */
  tier: "score" | "write";
  /** Stable instructions, identical across tasks of a step so the prefix caches. */
  system: string;
  /** Large stable context (CV, story bank), cached after the first call. */
  context?: string;
  /** Per-item content (job description, questions). */
  prompt: string;
  schema: z.ZodType<T>;
  maxTokens: number;
  effort?: "low" | "medium" | "high";
}

export type TaskResults<T> = Map<string, T | Error>;

export interface LlmBackend {
  readonly name: "api" | "claude-code";
  run<T>(task: LlmTask<T>): Promise<T>;
  /** `batch` uses the 50%-cheaper Batch API where the backend supports it. */
  runMany<T>(tasks: LlmTask<T>[], opts?: { batch?: boolean; onProgress?: (msg: string) => void }): Promise<TaskResults<T>>;
}
