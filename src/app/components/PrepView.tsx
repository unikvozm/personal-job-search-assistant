"use client";

import { useState } from "react";
import type { Prep } from "@/lib/pipeline/prep";
import { post } from "./api";

type Feedback = { score: number; strengths: string[]; improvements: string[]; improvedAnswer: string };

export function PrepView({ jobId, initial, storyTitles }: { jobId: string; initial: Prep | null; storyTitles: Record<string, string> }) {
  const [prep, setPrep] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [practice, setPractice] = useState<number | null>(null);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      setPrep((await post<{ prep: Prep }>(`/api/prep/${jobId}`)).prep);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!prep) {
    return (
      <div className="card stack">
        <p>Generate likely interview questions for this job, mapped to your stories (about $0.05 in API mode).</p>
        <button className="primary" disabled={busy} onClick={generate}>{busy ? "Generating…" : "Generate prep"}</button>
        {error && <p className="error">{error}</p>}
      </div>
    );
  }

  const q = practice != null ? prep.questions[practice] : null;
  return (
    <div className="stack">
      {q ? (
        <Practice key={practice} question={q} storyTitles={storyTitles} onDone={() => setPractice(null)} onNext={() => setPractice(((practice ?? 0) + 1) % prep.questions.length)} />
      ) : (
        <div className="row">
          <button className="primary" onClick={() => setPractice(0)}>Start practice session</button>
          <button disabled={busy} onClick={generate}>Regenerate</button>
        </div>
      )}

      {prep.focusAreas.length > 0 && (
        <div className="card">
          <h3>Prepare for these gaps</h3>
          <ul>{prep.focusAreas.map((f) => <li key={f}>{f}</li>)}</ul>
        </div>
      )}

      <h2>Likely questions</h2>
      {prep.questions.map((item, i) => (
        <div key={item.question} className="card stack">
          <div className="row">
            <span className="chip">{item.category}</span>
            <strong>{item.question}</strong>
            <span className="spacer" />
            <button className="small" onClick={() => setPractice(i)}>Practice</button>
          </div>
          <div className="small muted">{item.why}</div>
          <ul className="small">{item.keyPoints.map((k) => <li key={k}>{k}</li>)}</ul>
          {item.storyIds.length > 0 && <div className="small">Stories: {item.storyIds.map((id) => `${id} ${storyTitles[id] ?? ""}`).join(" · ")}</div>}
        </div>
      ))}

      <h2>Questions to ask them</h2>
      <ul className="card">{prep.questionsToAsk.map((x) => <li key={x}>{x}</li>)}</ul>
    </div>
  );
}

function Practice(props: { question: Prep["questions"][number]; storyTitles: Record<string, string>; onDone: () => void; onNext: () => void }) {
  const { question } = props;
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function check() {
    setBusy(true);
    setError(null);
    try {
      setFeedback((await post<{ feedback: Feedback }>("/api/practice", { question: question.question, keyPoints: question.keyPoints, storyIds: question.storyIds, answer })).feedback);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card stack">
      <div className="row">
        <span className="chip">practice</span>
        <strong>{question.question}</strong>
      </div>
      <textarea style={{ minHeight: 150 }} placeholder="Type your answer as you would say it…" value={answer} onChange={(e) => setAnswer(e.target.value)} />
      <div className="row">
        <button className="primary" disabled={busy || answer.trim().length < 30} onClick={check}>{busy ? "Checking…" : "Get feedback"}</button>
        <button onClick={props.onNext}>Next question</button>
        <button onClick={props.onDone}>End session</button>
      </div>
      {error && <p className="error">{error}</p>}
      {feedback && (
        <div className="stack small">
          <div><strong>Score: {feedback.score}/10</strong></div>
          <div className="good">✓ {feedback.strengths.join(" · ")}</div>
          <div className="warn">→ {feedback.improvements.join(" · ")}</div>
          <details>
            <summary>Improved answer</summary>
            <p style={{ whiteSpace: "pre-wrap" }}>{feedback.improvedAnswer}</p>
          </details>
        </div>
      )}
    </div>
  );
}
