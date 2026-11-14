import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { loadConfig, type Config } from "./config";
import { ensureDir, paths } from "./paths";

/** Config for server components / routes; null + message when configs.md is missing or invalid. */
export function tryConfig(): { config: Config; error: null } | { config: null; error: string } {
  try {
    return { config: loadConfig(), error: null };
  } catch (e) {
    return { config: null, error: (e as Error).message };
  }
}

/**
 * Starts a CLI command in the background (pipelines can take minutes) and logs to data/logs.
 * Progress is tracked through the runs table.
 */
export function startCli(args: string[]): string {
  const log = path.join(ensureDir(paths.logs), `${new Date().toISOString().replace(/[:.]/g, "-")}-${args[0]}.log`);
  const out = fs.openSync(log, "a");
  const tsx = path.join(paths.root, "node_modules", ".bin", "tsx");
  const child = spawn(tsx, [path.join(paths.root, "scripts", "cli.ts"), ...args], {
    cwd: paths.root,
    detached: true,
    stdio: ["ignore", out, out],
  });
  child.unref();
  return log;
}

export const json = (data: unknown, status = 200) => Response.json(data, { status });

/**
 * Rejects cross-site POSTs: any web page you visit could otherwise call localhost and start runs.
 * Returns an error Response, or null when the request comes from this app.
 */
export function rejectCrossSite(req: Request): Response | null {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (origin && host && new URL(origin).host === host) return null;
  return json({ error: "Cross-site request blocked" }, 403);
}
