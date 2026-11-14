import { db, now } from "../db";
import type { LlmTask } from "./types";

/** USD per million tokens. Cache writes cost 1.25x input; batch halves everything. */
const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
};

/** Expected output tokens per step (including thinking), used for estimates only. */
const EXPECTED_OUTPUT: Record<LlmTask<unknown>["step"], number> = {
  score: 600,
  classify: 400,
  tailor: 3500,
  answers: 2000,
  story: 800,
  prep: 3000,
  feedback: 500,
};

const priceOf = (model: string) => PRICES[model] ?? PRICES["claude-sonnet-5-5"]!;

/** Rough token count; good enough for budgeting (real usage is recorded after each call). */
export const approxTokens = (text: string) => Math.ceil(text.length / 3.5);

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export function costOf(model: string, u: Usage, batch: boolean): number {
  const p = priceOf(model);
  const usd =
    (u.inputTokens * p.input + u.cacheWriteTokens * p.input * 1.25 + u.cacheReadTokens * p.cacheRead + u.outputTokens * p.output) /
    1_000_000;
  return batch ? usd / 2 : usd;
}

/** Estimate for a set of tasks, assuming the shared context is cached after the first call. */
export function estimateCost(tasks: LlmTask<unknown>[], modelFor: (t: LlmTask<unknown>) => string, batch: boolean): number {
  let total = 0;
  const cached = new Set<string>();
  for (const t of tasks) {
    const model = modelFor(t);
    const ctx = approxTokens(t.context ?? "");
    const key = `${model}:${t.context?.length ?? 0}`;
    const usage: Usage = {
      inputTokens: approxTokens(t.system + t.prompt),
      outputTokens: EXPECTED_OUTPUT[t.step],
      cacheReadTokens: cached.has(key) ? ctx : 0,
      cacheWriteTokens: cached.has(key) ? 0 : ctx,
    };
    cached.add(key);
    total += costOf(model, usage, batch);
  }
  return total;
}

export function recordSpend(step: string, model: string, u: Usage, batch: boolean): number {
  const cost = costOf(model, u, batch);
  db()
    .prepare(
      `INSERT INTO spend (at, step, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, batch, cost_usd)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    )
    .run(now(), step, model, u.inputTokens, u.outputTokens, u.cacheReadTokens, u.cacheWriteTokens, batch ? 1 : 0, cost);
  return cost;
}

export function spentToday(): number {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const row = db().prepare("SELECT COALESCE(SUM(cost_usd), 0) AS total FROM spend WHERE at >= ?").get(start.toISOString()) as {
    total: number;
  };
  return row.total;
}

export function spendByStep(days = 30): { step: string; cost: number; calls: number }[] {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  return db()
    .prepare("SELECT step, SUM(cost_usd) AS cost, COUNT(*) AS calls FROM spend WHERE at >= ? GROUP BY step ORDER BY cost DESC")
    .all(since) as { step: string; cost: number; calls: number }[];
}

export class BudgetError extends Error {
  constructor(public estimate: number, public spent: number, public budget: number) {
    super(
      `Estimated $${estimate.toFixed(2)} would exceed today's budget ($${spent.toFixed(2)} of $${budget.toFixed(2)} spent). ` +
        "Re-run with --allow-over-budget (CLI) or confirm in the UI.",
    );
  }
}

export function assertBudget(estimate: number, budget: number, allowOver = false): void {
  const spent = spentToday();
  if (!allowOver && spent + estimate > budget) throw new BudgetError(estimate, spent, budget);
}
