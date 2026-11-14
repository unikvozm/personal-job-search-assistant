import fs from "node:fs";
import path from "node:path";

/** Project root: where package.json lives. Overridable for tests. */
export const ROOT = process.env.JSA_ROOT ?? process.cwd();

export const paths = {
  root: ROOT,
  cv: path.join(ROOT, "CV.md"),
  stories: path.join(ROOT, "interviewBankStories.md"),
  config: path.join(ROOT, "configs.md"),
  data: path.join(ROOT, "data"),
  db: path.join(ROOT, "data", "tracker.sqlite"),
  runs: path.join(ROOT, "data", "runs"),
  resumes: path.join(ROOT, "data", "resumes"),
  screenshots: path.join(ROOT, "data", "screenshots"),
  logs: path.join(ROOT, "data", "logs"),
};

export function ensureDir(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Filesystem-safe slug, e.g. for resume folders. */
export function slugify(...parts: string[]): string {
  return parts
    .join("-")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** Resolves a path inside data/ and rejects anything that escapes it. */
export function dataPath(relative: string): string {
  const resolved = path.resolve(paths.data, relative);
  if (!resolved.startsWith(paths.data + path.sep)) throw new Error("Path outside data directory");
  return resolved;
}
