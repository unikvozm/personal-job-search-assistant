import type { Config } from "../config";
import { settingsRepo } from "../db";
import { ApiBackend } from "./api";
import { ClaudeCodeBackend } from "./claudeCode";
import { assertBudget, estimateCost } from "./cost";
import type { LlmBackend, LlmTask } from "./types";

export type LlmMode = "api" | "claude-code";

/** The UI switch (stored in the db) overrides configs.md. */
export function llmMode(config: Config): LlmMode {
  return (settingsRepo.get("llm.mode") as LlmMode | null) ?? config.llm.mode;
}

export function getBackend(config: Config): LlmBackend {
  return llmMode(config) === "api" ? new ApiBackend(config) : new ClaudeCodeBackend(config);
}

/** Estimate in USD; 0 in claude-code mode (runs on your plan). */
export function estimate(config: Config, tasks: LlmTask<unknown>[], batch: boolean): number {
  if (llmMode(config) !== "api") return 0;
  return estimateCost(tasks, (t) => config.llm.models[t.tier], batch);
}

/** Throws BudgetError when an API run would push today's spend over llm.dailyBudgetUsd. */
export function guardBudget(config: Config, tasks: LlmTask<unknown>[], batch: boolean, allowOver = false): number {
  const usd = estimate(config, tasks, batch);
  if (usd > 0) assertBudget(usd, config.llm.dailyBudgetUsd, allowOver);
  return usd;
}

export type { LlmBackend, LlmTask } from "./types";
