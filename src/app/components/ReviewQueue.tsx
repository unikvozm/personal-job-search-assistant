"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { fileUrl, post } from "./api";

export interface ReviewItem {
  id: number;
  status: string;
  title: string;
  company: string;
  url: string;
  score: number;
  resumePdf: string | null;
  changes: string;
  screenshot: string | null;
  missing: string[];
  notes: string;
  questions: { id: string; label: string; required: boolean; standard: boolean; answer: string }[];
}

export function ReviewQueue({ items }: { items: ReviewItem[] }) {
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const item = items[Math.min(index, items.length - 1)]!;
  const manual = item.status === "needs_manual";

  useEffect(() => {
    setAnswers(Object.fromEntries(item.questions.map((q) => [q.id, q.answer])));
    setDirty(false);
  }, [item]);

  const saveAnswers = useCallback(async () => {
    if (dirty) await post(`/api/applications/${item.id}`, { action: "update", patch: { answers } });
    setDirty(false);
  }, [dirty, answers, item.id]);

  const act = useCallback(
    async (action: "approve" | "skip" | "markSubmitted") => {
      setMessage(null);
      try {
        await saveAnswers();
        await post(`/api/applications/${item.id}`, { action });
        setMessage(
          action === "approve" ? `Submitting ${item.company} in a browser window - finish any CAPTCHA there.` : action === "skip" ? "Skipped." : "Recorded as submitted.",
        );
        router.refresh();
      } catch (e) {
        setMessage((e as Error).message);
      }
    },
    [item, saveAnswers, router],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("textarea, input")) return;
      if (e.key === "a") act(manual ? "markSubmitted" : "approve");
      if (e.key === "s") act("skip");
      if (e.key === "ArrowRight") setIndex((i) => (i + 1) % items.length);
      if (e.key === "ArrowLeft") setIndex((i) => (i - 1 + items.length) % items.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [act, manual, items.length]);

  const copy = (text: string) => navigator.clipboard.writeText(text);

  return (
    <div className="stack">
      <div className="card row">
        <span className="muted">{index + 1} / {items.length}</span>
        <strong>{item.title}</strong> <span className="muted">· {item.company} · score {item.score}</span>
        <span className="spacer" />
        <a className="button" href={item.url} target="_blank" rel="noreferrer">Open form</a>
        {item.resumePdf && <a className="button" href={fileUrl(item.resumePdf)} target="_blank" rel="noreferrer">Resume PDF</a>}
        {manual ? (
          <button className="primary" onClick={() => act("markSubmitted")}>I submitted it (A)</button>
        ) : (
          <button className="primary" onClick={() => act("approve")}>Approve &amp; submit (A)</button>
        )}
        <button onClick={() => act("skip")}>Skip (S)</button>
        <button onClick={() => setIndex((i) => (i + 1) % items.length)}>Next →</button>
      </div>
      {message && <p className="warn">{message}</p>}
      {manual && <p className="warn">This form can&apos;t be filled automatically{item.notes ? ` (${item.notes})` : ""}. Open it, paste the answers below, attach the resume, submit, then click “I submitted it”.</p>}
      {item.missing.length > 0 && <p className="warn">Required fields not filled: {item.missing.join("; ")}. The submit window will wait for you to complete them.</p>}

      <div className="review">
        <div className="stack">
          <h2>Answers</h2>
          {item.questions.map((q) => (
            <div key={q.id} className="card stack">
              <div className="row">
                <strong className="small">{q.label}{q.required && " *"}</strong>
                <span className="spacer" />
                {manual && <button className="small" onClick={() => copy(answers[q.id] ?? "")}>Copy</button>}
              </div>
              {q.standard ? (
                <span className="small">{answers[q.id] || <span className="warn">missing in configs.md</span>}</span>
              ) : (
                <textarea
                  value={answers[q.id] ?? ""}
                  onChange={(e) => {
                    setAnswers({ ...answers, [q.id]: e.target.value });
                    setDirty(true);
                  }}
                  onBlur={saveAnswers}
                />
              )}
            </div>
          ))}
          {item.changes && (
            <>
              <h2>Resume changes</h2>
              <pre className="card small" style={{ whiteSpace: "pre-wrap" }}>{item.changes}</pre>
            </>
          )}
        </div>
        <div>
          <h2>Prefilled form</h2>
          {item.screenshot ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={fileUrl(item.screenshot)} alt={`Prefilled form for ${item.company}`} />
          ) : (
            <p className="muted">No screenshot.</p>
          )}
        </div>
      </div>
    </div>
  );
}
