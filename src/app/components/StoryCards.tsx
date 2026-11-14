"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { PendingStory } from "@/lib/pipeline/stories";
import { post } from "./api";

export function StoryCards({ items }: { items: PendingStory[] }) {
  return <div className="stack">{items.map((p) => <StoryCard key={p.id} item={p} />)}</div>;
}

function StoryCard({ item }: { item: PendingStory }) {
  const router = useRouter();
  const [notes, setNotes] = useState(item.userInput ?? "");
  const [draft, setDraft] = useState(item.draft ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card stack">
      <div className="small muted">{item.title} · {item.company}</div>
      <div><strong>Application question:</strong> {item.question}</div>
      <div className="warn"><strong>We need to know:</strong> {item.clarifyingQuestion}</div>
      <textarea placeholder="Situation, what you did, and the outcome - rough notes are fine" value={notes} onChange={(e) => setNotes(e.target.value)} />
      <div className="row">
        <button disabled={busy || notes.trim().length < 20} onClick={() => run(async () => setDraft((await post<{ draft: string }>(`/api/stories/${item.id}`, { action: "draft", notes })).draft))}>
          {draft ? "Redraft" : "Draft STAR story"}
        </button>
        <button className="danger" disabled={busy} onClick={() => run(async () => { await post(`/api/stories/${item.id}`, { action: "dismiss" }); router.refresh(); })}>
          Dismiss
        </button>
      </div>
      {draft && (
        <>
          <textarea style={{ minHeight: 180 }} value={draft} onChange={(e) => setDraft(e.target.value)} />
          <div className="row">
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await post(`/api/stories/${item.id}`, { action: "approve", draft });
                  await post("/api/runs", { kind: "apply", ids: [item.jobId] }).catch(() => {});
                  setMessage("Added to your story bank. Re-preparing this application…");
                  router.refresh();
                })
              }
            >
              Add to story bank &amp; re-prepare
            </button>
          </div>
        </>
      )}
      {message && <div className="warn small">{message}</div>}
    </div>
  );
}
