import { spawn } from "node:child_process";
import os from "node:os";
import { z } from "zod";
import type { Config } from "../config";
import { pMap } from "../sources/http";
import type { LlmBackend, LlmTask, TaskResults } from "./types";

/**
 * Runs tasks through the Claude Code CLI (`claude -p`) so they count against your
 * Claude plan instead of API credits. Same prompts and schemas as the API backend.
 */
export class ClaudeCodeBackend implements LlmBackend {
  readonly name = "claude-code" as const;

  constructor(private config: Config) {}

  async run<T>(task: LlmTask<T>): Promise<T> {
    const schema = JSON.stringify(z.toJSONSchema(task.schema));
    const prompt = [
      task.system,
      task.context ? `<context>\n${task.context}\n</context>` : "",
      task.prompt,
      `Respond with ONLY a JSON object (no prose, no code fences) that validates against this JSON Schema:\n${schema}`,
    ]
      .filter(Boolean)
      .join("\n\n");

    const model = task.tier === "score" ? "haiku" : "sonnet";
    // Run from the temp dir so the CLI doesn't load this project's CLAUDE.md and skills into context.
    const stdout = await exec(this.config.llm.claudeBin, ["-p", "--output-format", "json", "--model", model], prompt, os.tmpdir());
    const envelope = JSON.parse(stdout) as { result?: string; is_error?: boolean };
    if (envelope.is_error || typeof envelope.result !== "string") throw new Error(`claude CLI error: ${stdout.slice(0, 300)}`);
    const text = envelope.result;
    const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
    return task.schema.parse(JSON.parse(json));
  }

  async runMany<T>(tasks: LlmTask<T>[], opts: { onProgress?: (msg: string) => void } = {}): Promise<TaskResults<T>> {
    const results: TaskResults<T> = new Map();
    let done = 0;
    await pMap(tasks, 2, async (task) => {
      try {
        results.set(task.id, await this.run(task));
      } catch (e) {
        results.set(task.id, e as Error);
      }
      opts.onProgress?.(`${++done}/${tasks.length}`);
    });
    return results;
  }
}

function exec(bin: string, args: string[], input: string, cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d: Buffer) => (out += d));
    child.stderr.on("data", (d: Buffer) => (err += d));
    child.on("error", (e) =>
      reject(new Error(`Could not start "${bin}" (${e.message}). Install Claude Code or set llm.claudeBin in configs.md.`)),
    );
    child.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`claude exited with ${code}: ${err.slice(0, 300)}`))));
    child.stdin.end(input);
  });
}
