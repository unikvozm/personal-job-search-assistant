import fs from "node:fs";
import { readStories } from "./config";
import { paths } from "./paths";

export interface Story {
  id: string;
  title: string;
  tags: string[];
  body: string;
}

/** Parses `## S01 — Title` sections from interviewBankStories.md. */
export function parseStories(markdown: string): Story[] {
  const sections = markdown.split(/^## /m).slice(1);
  return sections.flatMap((section) => {
    const [heading = "", ...rest] = section.split("\n");
    const m = heading.match(/^(S\d+)\s*[—–-]\s*(.+)$/);
    if (!m) return [];
    const body = rest.join("\n").trim();
    const tags = body.match(/^Tags:\s*(.+)$/m)?.[1]?.split(",").map((t) => t.trim()).filter(Boolean) ?? [];
    return [{ id: m[1]!, title: m[2]!.trim(), tags, body }];
  });
}

/** One line per story - enough for classification without sending the full bank. */
export function storyIndex(stories: Story[]): string {
  return stories.map((s) => `${s.id} — ${s.title} [${s.tags.join(", ")}]: ${firstLine(s.body)}`).join("\n");
}

function firstLine(body: string): string {
  // STAR stories start with the Situation; saved application answers with the Answer.
  const line = body.match(/\*\*Situation:\*\*\s*(.+)/)?.[1] ?? body.match(/\*\*Answer:\*\*\s*(.+)/)?.[1] ?? "";
  return line.slice(0, 160);
}

export function nextStoryId(stories: Story[]): string {
  const max = stories.reduce((n, s) => Math.max(n, Number(s.id.slice(1))), 0);
  return `S${String(max + 1).padStart(2, "0")}`;
}

export function formatStory(id: string, s: { title: string; tags: string[]; situation: string; task: string; action: string; result: string }): string {
  return [
    `## ${id} — ${s.title}`,
    `Tags: ${s.tags.join(", ")}`,
    `**Situation:** ${s.situation}`,
    `**Task:** ${s.task}`,
    `**Action:** ${s.action}`,
    `**Result:** ${s.result}`,
  ].join("\n");
}

/** A reusable application answer, kept in your own words (not rewritten into STAR). */
export function formatAnswerStory(id: string, a: { question: string; answer: string; company: string }): string {
  const title = a.question.length > 90 ? `${a.question.slice(0, 87).trimEnd()}…` : a.question;
  return [`## ${id} — ${title}`, `Tags: application answer, ${a.company}`, `**Question:** ${a.question}`, `**Answer:** ${a.answer.trim()}`].join("\n");
}

export function appendStory(markdown: string): void {
  const current = fs.existsSync(paths.stories) ? fs.readFileSync(paths.stories, "utf8") : "# Interview story bank\n";
  fs.writeFileSync(paths.stories, `${current.trimEnd()}\n\n${markdown}\n`);
}

export const loadStories = () => parseStories(readStories());
