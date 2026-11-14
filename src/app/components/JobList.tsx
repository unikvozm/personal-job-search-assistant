"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { post } from "./api";

export interface JobView {
  id: string;
  title: string;
  company: string;
  location: string;
  url: string;
  salary: string;
  salaryEstimated: boolean;
  postedAt: string;
  source: string;
  /** null = not scored yet */
  score: number | null;
  summary: string;
  matched: string[];
  gaps: string[];
  eligibilityNote: string;
  selected: boolean;
  status: string;
  autoFillable: boolean;
  needsInput: string[];
  unverifiedLink: boolean;
  belowMinSalary: boolean;
  application: string | null;
}

interface Group {
  key: string;
  title: string;
  ready: JobView[];
  needsInput: JobView[];
}

interface Props {
  groups: Group[];
  unscored: JobView[];
  threshold: number;
  posted: number | null;
  showBelowMin: boolean;
  showHidden: boolean;
  showLowScores: boolean;
  belowMinCount: number;
  hiddenCount: number;
  lowCount: number;
}

const POSTED_OPTIONS: [string, string][] = [
  ["", "Any time"],
  ["1", "Last 24 hours"],
  ["3", "Last 3 days"],
  ["7", "Last 7 days"],
  ["14", "Last 14 days"],
  ["30", "Last 30 days"],
];

export function JobList(props: Props) {
  const router = useRouter();
  const all = useMemo(() => props.groups.flatMap((g) => [...g.ready, ...g.needsInput]), [props.groups]);
  const [selected, setSelected] = useState(() => new Set(all.filter((j) => j.selected && !j.application).map((j) => j.id)));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function toggle(id: string) {
    const next = new Set(selected);
    const on = !next.has(id);
    if (on) next.add(id);
    else next.delete(id);
    setSelected(next);
    await post("/api/jobs", { ids: [id], action: on ? "select" : "deselect" }).catch(() => {});
  }

  async function bulk(action: "skip" | "hide" | "restore") {
    const ids = [...selected];
    if (!ids.length) return;
    await post("/api/jobs", { ids, action });
    setSelected(new Set());
    router.refresh();
  }

  async function applySelected() {
    const ids = [...selected];
    if (!ids.length) return;
    setBusy(true);
    setMessage(null);
    try {
      const est = await post<{ usd: number; mode: string; spentToday: number; budget: number }>("/api/estimate", { ids });
      const cost = est.mode === "api" ? `Estimated $${est.usd.toFixed(2)} (today: $${est.spentToday.toFixed(2)} of $${est.budget}).` : "Runs on your Claude plan.";
      const over = est.mode === "api" && est.spentToday + est.usd > est.budget;
      const ok = confirm(
        `Prepare ${ids.length} application(s): tailored resume + answers, then prefill the forms.\n${cost}${over ? "\n\nThis exceeds your daily budget." : ""}\n\nNothing is submitted until you approve each one in Review.`,
      );
      if (!ok) return;
      await post("/api/runs", { kind: "apply", ids, allowOverBudget: over });
      setMessage("Preparing… prefilled applications will appear in Review.");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /** Updates one URL filter; null removes it. */
  const setParam = (key: string, value: string | null) => {
    const url = new URL(window.location.href);
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
    router.push(url.pathname + url.search);
  };

  const rowProps = { threshold: props.threshold, selected, onToggle: toggle };

  return (
    <>
      <div className="toolbar row">
        <button className="primary" disabled={!selected.size || busy} onClick={applySelected}>
          Apply to selected ({selected.size})
        </button>
        <button disabled={!selected.size} onClick={() => bulk("skip")}>Skip</button>
        <button disabled={!selected.size} onClick={() => bulk("hide")}>Hide</button>
        {props.showHidden && <button disabled={!selected.size} onClick={() => bulk("restore")}>Restore</button>}
        <span className="spacer" />
        <label className="small">
          Posted{" "}
          <select value={props.posted ? String(props.posted) : ""} onChange={(e) => setParam("posted", e.target.value || null)}>
            {POSTED_OPTIONS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
          </select>
        </label>
        <label className="small">
          <input type="checkbox" checked={!props.showLowScores} onChange={(e) => setParam("low", e.target.checked ? null : "1")} /> Hide score &lt; {props.threshold} ({props.lowCount})
        </label>
        <label className="small">
          <input type="checkbox" checked={props.showBelowMin} onChange={(e) => setParam("belowMin", e.target.checked ? "1" : null)} /> Below min salary ({props.belowMinCount})
        </label>
        <label className="small">
          <input type="checkbox" checked={props.showHidden} onChange={(e) => setParam("hidden", e.target.checked ? "1" : null)} /> Hidden / skipped ({props.hiddenCount})
        </label>
      </div>
      {message && <p className="warn">{message}</p>}

      {props.groups.map((g) => (
        <section key={g.key}>
          <h2>
            {g.title} <span className="muted small">({g.ready.length + g.needsInput.length})</span>
          </h2>
          {g.ready.length + g.needsInput.length === 0 && <p className="muted">Nothing here for these filters.</p>}
          {g.ready.length > 0 && (
            <>
              <h3>Ready to auto-fill</h3>
              <div className="list">{g.ready.map((j) => <Row key={j.id} job={j} {...rowProps} />)}</div>
            </>
          )}
          {g.needsInput.length > 0 && (
            <>
              <h3>Needs your input</h3>
              <div className="list">{g.needsInput.map((j) => <Row key={j.id} job={j} {...rowProps} />)}</div>
            </>
          )}
        </section>
      ))}

      {props.unscored.length > 0 && (
        <section>
          <h2>
            Not scored yet <span className="muted small">({props.unscored.length})</span>
          </h2>
          <p className="muted small">Found but not scored. Use “Score unscored” above; they then move into the lists above.</p>
          <div className="list">{props.unscored.map((j) => <Row key={j.id} job={j} {...rowProps} />)}</div>
        </section>
      )}
    </>
  );
}

function Row({ job, threshold, selected, onToggle }: { job: JobView; threshold: number; selected: Set<string>; onToggle: (id: string) => void }) {
  const scored = job.score != null;
  const tone = !scored ? "" : job.score! >= 85 ? "high" : job.score! >= 75 ? "mid" : job.score! <= threshold ? "low" : "";
  return (
    <div className="job">
      <input
        type="checkbox"
        checked={selected.has(job.id)}
        disabled={!!job.application || !scored}
        onChange={() => onToggle(job.id)}
        aria-label={`Select ${job.title}`}
      />
      <span className={`score ${tone}`} title={scored ? `Match score ${job.score}/100` : "Not scored yet"}>
        {scored ? job.score : "—"}
      </span>
      <div>
        <div className="title">
          <a href={job.url} target="_blank" rel="noreferrer">{job.title}</a> <span className="muted">· {job.company}</span>
        </div>
        <div className="small muted">
          {job.location} {job.postedAt && `· ${job.postedAt}`} · {job.source}
          {job.unverifiedLink && " · link not verified"}
        </div>
        {job.summary && <div className="small">{job.summary}</div>}
        {job.eligibilityNote && <div className="small error">Not eligible: {job.eligibilityNote}</div>}
        {scored && !job.autoFillable && job.needsInput.length > 0 && (
          <div className="small warn">Needs input: {job.needsInput.slice(0, 3).join("; ")}{job.needsInput.length > 3 && ` +${job.needsInput.length - 3}`}</div>
        )}
        {scored && (
          <details>
            <summary>Fit details</summary>
            <div className="small">
              <div className="good">✓ {job.matched.join(" · ")}</div>
              <div className="warn">✗ {job.gaps.join(" · ") || "no gaps found"}</div>
              <Link href={`/prep/${job.id}`}>Interview prep →</Link>
            </div>
          </details>
        )}
      </div>
      <div className="meta small" style={{ textAlign: "right" }}>
        {job.salary && <div>{job.salary}{job.salaryEstimated && <span className="muted" title="Extracted from the description"> *</span>}</div>}
        {job.belowMinSalary && <span className="chip">below min</span>}
        {job.status === "ineligible" && <span className="chip">ineligible</span>}
        {job.application && <span className="chip">{job.application.replace("_", " ")}</span>}
        {job.status === "hidden" || job.status === "skipped" ? <span className="chip">{job.status}</span> : null}
      </div>
    </div>
  );
}
