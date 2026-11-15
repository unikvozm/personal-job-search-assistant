"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BUSY_STATUSES, statusLabel } from "@/lib/applicationStatus";
import { fileUrl, post } from "./api";

export interface EditorQuestion {
  id: string;
  label: string;
  required: boolean;
  standard: boolean;
  options: string[];
  /** What we still need to know from you, if the answer couldn't be written from your stories. */
  hint: string;
}

interface Props {
  jobId: string;
  application: {
    id: number;
    status: string;
    notes: string;
    answers: Record<string, string>;
    resumePdf: string | null;
    changes: string;
    formUrl: string;
  } | null;
  questions: EditorQuestion[];
  formKnown: boolean;
  /** "tailored", "family:<name>" or null. */
  resumeSource: string | null;
  /** Custom questions without an answer yet. */
  remaining: number;
  /** Estimated USD for "Write answers" (null = unknown, 0 = Claude plan). */
  answersCost: number | null;
}

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

export function ApplicationEditor({ jobId, application: app, questions, formKnown, resumeSource, remaining, answersCost }: Props) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, string>>(app?.answers ?? {});
  const [edited, setEdited] = useState<Set<string>>(new Set());
  const [toBank, setToBank] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const processing = !!app && BUSY_STATUSES.has(app.status);

  // While the server is still preparing, refresh until the answers arrive.
  useEffect(() => {
    if (!processing) return;
    const t = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(t);
  }, [processing, router]);
  useEffect(() => {
    if (!edited.size) setAnswers(app?.answers ?? {});
  }, [app?.answers]); // eslint-disable-line react-hooks/exhaustive-deps

  function change(q: EditorQuestion, value: string) {
    setAnswers({ ...answers, [q.id]: value });
    setEdited(new Set(edited).add(q.id));
    // Longer answers you wrote yourself are worth reusing: tick "save to story bank" by default.
    if (!q.standard && words(value) >= 40 && !edited.has(q.id)) setToBank(new Set(toBank).add(q.id));
  }

  async function save() {
    if (!app) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await post<{ status: string; addedStories: string[]; prefilling: boolean; missing: string[] }>(`/api/applications/${app.id}`, {
        action: "saveAnswers",
        answers: Object.fromEntries([...edited].map((id) => [id, answers[id] ?? ""])),
        saveToBank: [...toBank],
      });
      const parts = ["Saved to the database and answers.md."];
      if (res.addedStories.length) parts.push(`Added ${res.addedStories.join(", ")} to your story bank.`);
      if (res.missing.length) parts.push(`Still missing: ${res.missing.join("; ")}.`);
      if (res.prefilling) parts.push("Prefilling the form again with your answers; it will appear in Review.");
      setMessage(parts.join(" "));
      setEdited(new Set());
      setToBank(new Set());
      router.refresh();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /** Starts a background step for this job: apply (prepare again), answers or tailor. */
  async function start(kind: "apply" | "answers" | "tailor", confirmText?: string) {
    if (confirmText && !confirm(confirmText)) return;
    setMessage(null);
    try {
      await post("/api/runs", { kind, ids: [jobId] });
      router.refresh();
    } catch (e) {
      setMessage((e as Error).message);
    }
  }

  const copy = (text: string) => navigator.clipboard.writeText(text).then(() => setMessage("Copied."));
  const family = resumeSource?.startsWith("family:") ? resumeSource.slice("family:".length) : null;

  if (!app) {
    return <p className="muted">You haven&apos;t started applying to this job. Select it on the Jobs page and click “Apply to selected”.</p>;
  }

  return (
    <div className="stack">
      <div className="card row">
        <span className={`chip status-${app.status}`}>{statusLabel(app.status)}</span>
        {app.notes && <span className="small muted">{app.notes}</span>}
        <span className="spacer" />
        {app.resumePdf && <a className="button" href={fileUrl(app.resumePdf)} target="_blank" rel="noreferrer">Resume PDF</a>}
        <a className="button" href={app.formUrl} target="_blank" rel="noreferrer">Application form</a>
        {(app.status === "prefilled" || app.status === "needs_manual") && <Link className="button" href="/review">Review &amp; submit</Link>}
        {!processing && family && (
          <button onClick={() => start("tailor", "Write a resume for this posting? About $0.03 with the Batch API.")} title="Replace the family resume with one written for this job">
            Tailor for this job
          </button>
        )}
        {!processing && app.status === "needs_manual" && app.notes.startsWith("Prepar") && <button onClick={() => start("apply")}>Prepare again</button>}
      </div>

      {resumeSource && (
        <p className="small muted">
          Resume: {family ? `your “${family}” role-family resume (shared by similar jobs)` : "written for this posting"}.
        </p>
      )}
      {!processing && remaining > 0 && (
        <div className="card row">
          <span className="small">
            {remaining} question{remaining === 1 ? "" : "s"} still without an answer. Answers you saved before and your configs.md details are filled in for free.
          </span>
          <span className="spacer" />
          <button className="primary" onClick={() => start("answers")}>
            Write {remaining === 1 ? "the answer" : `${remaining} answers`}
            {answersCost ? ` (≈$${answersCost.toFixed(answersCost < 0.01 ? 3 : 2)})` : ""}
          </button>
        </div>
      )}
      {processing ? (
        <p className="muted">Tailoring your resume and writing answers… this page updates by itself.</p>
      ) : (
        <>
          <h2>Answers</h2>
          {!formKnown && <p className="small muted">The application form couldn&apos;t be read, so there are no questions here. Use the form link and your resume directly.</p>}
          {questions.map((q) => (
            <div key={q.id} className="card stack">
              <div className="row">
                <strong className="small">{q.label}{q.required && " *"}</strong>
                <span className="spacer" />
                {edited.has(q.id) && <span className="chip">edited</span>}
                {answers[q.id] && <button className="small" onClick={() => copy(answers[q.id]!)}>Copy</button>}
                {!q.standard && (
                  <label className="small" title="Keep this answer in your words for future applications">
                    <input
                      type="checkbox"
                      checked={toBank.has(q.id)}
                      onChange={(e) => {
                        const next = new Set(toBank);
                        if (e.target.checked) next.add(q.id);
                        else next.delete(q.id);
                        setToBank(next);
                      }}
                    />{" "}
                    Save to story bank
                  </label>
                )}
              </div>
              {q.hint && !answers[q.id] && <div className="small warn">We need to know: {q.hint}</div>}
              {q.options.length > 0 ? (
                <select value={answers[q.id] ?? ""} onChange={(e) => change(q, e.target.value)}>
                  <option value="">—</option>
                  {q.options.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : q.standard ? (
                <input type="text" value={answers[q.id] ?? ""} onChange={(e) => change(q, e.target.value)} />
              ) : (
                <textarea value={answers[q.id] ?? ""} onChange={(e) => change(q, e.target.value)} />
              )}
              {!q.standard && <span className="small muted">{words(answers[q.id] ?? "")} words</span>}
            </div>
          ))}
          {questions.length > 0 && (
            <div className="row">
              <button className="primary" disabled={busy || !edited.size} onClick={save}>
                {busy ? "Saving…" : `Save ${edited.size || ""} change${edited.size === 1 ? "" : "s"}`}
              </button>
              {message && <span className="small warn">{message}</span>}
            </div>
          )}
          {app.changes && (
            <>
              <h2>Resume changes</h2>
              <pre className="card small" style={{ whiteSpace: "pre-wrap" }}>{app.changes}</pre>
            </>
          )}
        </>
      )}
      {processing && message && <p className="warn">{message}</p>}
    </div>
  );
}
