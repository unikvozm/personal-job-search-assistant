import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { Config } from "../config";
import { pMap } from "../sources/http";
import { recordSpend } from "./cost";
import type { LlmBackend, LlmTask, TaskResults } from "./types";

/** Models that accept the server-side refusal fallback (`fallbacks: "default"`). Haiku has none. */
const SUPPORTS_FALLBACK = /^claude-(sonnet-5-5|opus-5|fable-5)/;

type SystemBlocks = { type: "text"; text: string; cache_control?: { type: "ephemeral" } }[];

function systemBlocks(task: LlmTask<unknown>): SystemBlocks {
  const blocks: SystemBlocks = [{ type: "text", text: task.system }];
  // The CV / story bank goes last in the system prompt with a cache breakpoint, so every
  // task of the same step reuses it at ~10% of the input price.
  if (task.context) blocks.push({ type: "text", text: task.context, cache_control: { type: "ephemeral" } });
  return blocks;
}

function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("No JSON object in model output");
  return JSON.parse(text.slice(start, end + 1));
}

export class ApiBackend implements LlmBackend {
  readonly name = "api" as const;
  private client = new Anthropic();

  constructor(private config: Config) {}

  model(task: LlmTask<unknown>): string {
    return this.config.llm.models[task.tier];
  }

  async run<T>(task: LlmTask<T>): Promise<T> {
    const model = this.model(task);
    const fallback = SUPPORTS_FALLBACK.test(model);
    const response = await this.client.beta.messages.parse({
      model,
      max_tokens: task.maxTokens,
      system: systemBlocks(task),
      messages: [{ role: "user", content: task.prompt }],
      output_config: { format: betaZodOutputFormat(task.schema), effort: task.effort ?? "medium" },
      ...(fallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    });
    const u = response.usage;
    recordSpend(task.step, model, {
      inputTokens: u.input_tokens,
      outputTokens: u.output_tokens,
      cacheReadTokens: u.cache_read_input_tokens ?? 0,
      cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
    }, false);
    if (response.stop_reason === "refusal") throw new Error(`Model declined (${response.stop_details?.category ?? "no category"})`);
    if (response.stop_reason === "max_tokens") throw new Error(`Output hit max_tokens (${task.maxTokens})`);
    if (response.parsed_output == null) throw new Error("Model output did not match the expected schema");
    return response.parsed_output as T;
  }

  async runMany<T>(tasks: LlmTask<T>[], opts: { batch?: boolean; onProgress?: (msg: string) => void } = {}): Promise<TaskResults<T>> {
    // Callers decide when batching is worth the wait; a batch of one still costs half.
    if (opts.batch && tasks.length) return this.runBatch(tasks, opts.onProgress);
    const results: TaskResults<T> = new Map();
    let done = 0;
    await pMap(tasks, 4, async (task) => {
      try {
        results.set(task.id, await this.run(task));
      } catch (e) {
        results.set(task.id, e as Error);
      }
      opts.onProgress?.(`${++done}/${tasks.length}`);
    });
    return results;
  }

  /** Batch API: 50% cheaper, asynchronous (usually minutes). Fallbacks are not supported there. */
  private async runBatch<T>(tasks: LlmTask<T>[], onProgress?: (msg: string) => void): Promise<TaskResults<T>> {
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const batch = await this.client.messages.batches.create({
      requests: tasks.map((task) => ({
        custom_id: task.id,
        params: {
          model: this.model(task),
          max_tokens: task.maxTokens,
          system: systemBlocks(task),
          messages: [{ role: "user" as const, content: task.prompt }],
          output_config: { format: zodOutputFormat(task.schema), effort: task.effort ?? "medium" },
        },
      })),
    });
    onProgress?.(`batch ${batch.id} submitted (${tasks.length} requests)`);

    let status = batch;
    while (status.processing_status !== "ended") {
      await new Promise((r) => setTimeout(r, 30_000));
      status = await this.client.messages.batches.retrieve(batch.id);
      const c = status.request_counts;
      onProgress?.(`batch: ${c.succeeded + c.errored + c.expired + c.canceled}/${tasks.length} done`);
    }

    const results: TaskResults<T> = new Map();
    for await (const item of await this.client.messages.batches.results(batch.id)) {
      const task = byId.get(item.custom_id);
      if (!task) continue;
      if (item.result.type !== "succeeded") {
        results.set(item.custom_id, new Error(`Batch request ${item.result.type}`));
        continue;
      }
      const message = item.result.message;
      const u = message.usage;
      recordSpend(task.step, this.model(task), {
        inputTokens: u.input_tokens,
        outputTokens: u.output_tokens,
        cacheReadTokens: u.cache_read_input_tokens ?? 0,
        cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
      }, true);
      try {
        if (message.stop_reason === "refusal") throw new Error("Model declined");
        const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
        results.set(item.custom_id, task.schema.parse(extractJson(text)));
      } catch (e) {
        results.set(item.custom_id, e as Error);
      }
    }
    return results;
  }
}
