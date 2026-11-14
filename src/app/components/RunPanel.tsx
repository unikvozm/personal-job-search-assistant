"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Run } from "@/lib/db";
import { post } from "./api";

const LABELS: Record<string, string> = {
  find: "Find jobs",
  score: "Score",
  prepare: "Prepare",
  prefill: "Prefill",
  submit: "Submit",
  prep: "Interview prep",
};

export function RunPanel({ initialRuns, newJobs }: { initialRuns: Run[]; newJobs: number }) {
  const router = useRouter();
  const [runs, setRuns] = useState(initialRuns);
  const [error, setError] = useState<string | null>(null);
  /** "" = since the last run; otherwise postings from the last N days. */
  const [days, setDays] = useState("");
  const running = runs.some((r) => r.status === "running");

  useEffect(() => {
    if (!running) return;
    const t = setInterval(async () => {
      const data = (await (await fetch("/api/runs")).json()) as { runs: Run[] };
      setRuns(data.runs);
      if (!data.runs.some((r) => r.status === "running")) router.refresh();
    }, 4000);
    return () => clearInterval(t);
  }, [running, router]);

  async function start(kind: string, allowOverBudget = false) {
    setError(null);
    try {
      await post("/api/runs", { kind, allowOverBudget, days: days ? Number(days) : undefined });
      setRuns([{ id: "pending", kind: "find", status: "running", startedAt: new Date().toISOString(), finishedAt: null, windowFrom: null, stats: null, error: null }, ...runs]);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function stop(id: string) {
    if (!confirm("Stop this run? Results saved so far are kept.")) return;
    await post("/api/runs", { kind: "stop", id }).catch((e) => setError((e as Error).message));
    setRuns((await (await fetch("/api/runs")).json()).runs);
    router.refresh();
  }

  const last = runs[0];
  const budgetFailure = last?.status === "failed" && /budget/i.test(last.error ?? "");

  return (
    <div className="card stack" style={{ marginBottom: 16 }}>
      <div className="row">
        <button className="primary" disabled={running} onClick={() => start("daily")}>
          {running ? "Running…" : "Find & score new jobs"}
        </button>
        <label className="small">
          posted{" "}
          <select value={days} disabled={running} onChange={(e) => setDays(e.target.value)}>
            <option value="">since the last run</option>
            <option value="1">in the last 24 hours</option>
            <option value="7">in the last 7 days</option>
            <option value="14">in the last 14 days</option>
            <option value="30">in the last 30 days</option>
          </select>
        </label>
        {newJobs > 0 && (
          <button disabled={running} onClick={() => start("score")}>
            Score {newJobs} unscored
          </button>
        )}
        <span className="muted small">Finding is free; scoring costs about $0.0005 per job (Haiku, batch).</span>
      </div>
      {error && <div className="error">{error}</div>}
      {budgetFailure && (
        <div className="row warn">
          {last.error}
          <button onClick={() => start(last.kind === "score" ? "score" : "daily", true)}>Run anyway</button>
        </div>
      )}
      {runs.length > 0 && (
        <div className="small muted">
          {runs.slice(0, 3).map((r) => (
            <div key={r.id}>
              {LABELS[r.kind] ?? r.kind} · {new Date(r.startedAt).toLocaleString()} ·{" "}
              <span className={r.status === "failed" ? "error" : r.status === "done" ? "good" : ""}>{r.status}</span>
              {r.status === "running" && r.id !== "pending" && (
                <>
                  {" "}
                  <button className="small danger" onClick={() => stop(r.id)}>Stop</button>
                </>
              )}
              {r.stats && ` · ${Object.entries(r.stats).filter(([, v]) => typeof v === "number").map(([k, v]) => `${k}: ${v}`).join(", ")}`}
              {r.status === "failed" && !budgetFailure && r.error && ` · ${r.error}`}
              {Array.isArray(r.stats?.warnings) && (r.stats.warnings as string[]).map((w) => <div key={w} className="warn">⚠️ {w}</div>)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
