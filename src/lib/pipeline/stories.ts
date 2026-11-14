import type { Config } from "../config";
import { readCv } from "../config";
import { db } from "../db";
import { getBackend, guardBudget } from "../llm";
import { appendStory, formatStory, loadStories, nextStoryId } from "../stories";
import { storyTask } from "./tasks";

export interface PendingStory {
  id: number;
  jobId: string;
  company: string;
  title: string;
  question: string;
  clarifyingQuestion: string;
  userInput: string | null;
  draft: string | null;
  status: "open" | "drafted" | "approved" | "dismissed";
}

export function listPendingStories(): PendingStory[] {
  // node:sqlite rows have a null prototype; spread them into plain objects for client components.
  return (db()
    .prepare(
      `SELECT p.id, p.job_id AS jobId, j.company, j.title, p.question, p.clarifying_question AS clarifyingQuestion,
              p.user_input AS userInput, p.draft, p.status
       FROM pending_stories p JOIN jobs j ON j.id = p.job_id
       WHERE p.status IN ('open', 'drafted') ORDER BY p.created_at`,
    )
    .all() as unknown as PendingStory[]).map((row) => ({ ...row }));
}

/** Turns your notes into a STAR story draft. Nothing is written to the story bank yet. */
export async function draftStory(config: Config, id: number, notes: string): Promise<string> {
  const p = db().prepare("SELECT question, clarifying_question FROM pending_stories WHERE id = ?").get(id) as
    | { question: string; clarifying_question: string }
    | undefined;
  if (!p) throw new Error(`Pending story ${id} not found`);
  const task = storyTask(String(id), readCv(), p.question, p.clarifying_question, notes);
  guardBudget(config, [task], false);
  const story = await getBackend(config).run(task);
  const draft = formatStory(nextStoryId(loadStories()), story);
  db().prepare("UPDATE pending_stories SET user_input = ?, draft = ?, status = 'drafted' WHERE id = ?").run(notes, draft, id);
  return draft;
}

/** Appends the (possibly edited) draft to interviewBankStories.md. Re-run "prepare" afterwards to use it. */
export function approveStory(id: number, draft: string): void {
  const fresh = draft.replace(/^## S\d+/, `## ${nextStoryId(loadStories())}`); // the bank may have grown since drafting
  appendStory(fresh);
  db().prepare("UPDATE pending_stories SET draft = ?, status = 'approved' WHERE id = ?").run(fresh, id);
}

export function dismissStory(id: number): void {
  db().prepare("UPDATE pending_stories SET status = 'dismissed' WHERE id = ?").run(id);
}
