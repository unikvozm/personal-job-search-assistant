import fs from "node:fs";
import path from "node:path";
import { formatSalary } from "../jobs/salary";
import type { Job } from "../jobs/types";
import { ensureDir, paths } from "../paths";

const excerpt = (text: string, max = 1200) => {
  // Requirements usually sit in the second half; prefer a "requirements"-like section when present.
  const idx = text.search(/\n.*(requirements|qualifications|what you.ll need|what we.re looking for|your profile|you have|ihr profil|anforderungen)/i);
  const body = idx > 0 ? text.slice(idx) : text;
  return body.length > max ? `${body.slice(0, max).trimEnd()}…` : body;
};

/** Writes data/runs/<date>/jobDescriptions.md: one section per new job, newest first. */
export function writeJobDescriptions(runDate: string, jobs: Job[], meta: { windowFrom: string; sources: string[]; stats: Record<string, number> }): string {
  const dir = ensureDir(path.join(paths.runs, runDate));
  const file = path.join(dir, "jobDescriptions.md");
  const sorted = [...jobs].sort((a, b) => (b.postedAt ?? "").localeCompare(a.postedAt ?? ""));
  const lines = [
    `# Job descriptions — ${runDate}`,
    "",
    `Window: postings since ${meta.windowFrom.slice(0, 10)} · Sources: ${meta.sources.join(", ")}`,
    "",
    Object.entries(meta.stats).map(([k, v]) => `- ${k}: ${v}`).join("\n"),
    "",
  ];
  for (const j of sorted) {
    lines.push(
      `## ${j.title} — ${j.company}`,
      "",
      `- **Location:** ${j.location || "n/a"}${j.workMode ? ` (${j.workMode})` : ""}`,
      `- **Salary:** ${formatSalary(j.salary) || "not stated"}`,
      `- **Posted:** ${j.postedAt?.slice(0, 10) ?? "unknown"} · **Source:** ${j.source}${j.live === null ? " · link not verified" : ""}`,
      `- **Apply:** ${j.applyUrl ?? j.url}`,
      "",
      excerpt(j.description),
      "",
    );
  }
  fs.writeFileSync(file, lines.join("\n"));
  return file;
}
