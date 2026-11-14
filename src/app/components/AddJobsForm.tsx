"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Run } from "@/lib/db";
import { post } from "./api";

interface AddResult {
  input: string;
  ok: boolean;
  jobId?: string;
  company?: string;
  title?: string;
  existing?: boolean;
  error?: string;
}

const EMPTY = { company: "", title: "", location: "", url: "", description: "", questions: "" };

export function AddJobsForm() {
  const router = useRouter();
  const [tab, setTab] = useState<"links" | "paste">("links");
  const [links, setLinks] = useState("");
  const [pasted, setPasted] = useState(EMPTY);
  const [alreadyApplied, setAlreadyApplied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [results, setResults] = useState<AddResult[]>([]);

  /** Refreshes the list once background scoring has finished. */
  async function waitForScoring() {
    setStatus("Scoring against your CV…");
    for (let i = 0; i < 150; i++) {
      await new Promise((r) => setTimeout(r, 4000));
      const { runs } = (await (await fetch("/api/runs")).json()) as { runs: Run[] };
      if (!runs.some((r) => r.status === "running")) {
        const last = runs[0];
        setStatus(last?.status === "failed" ? `Scoring failed: ${last.error}` : "Scored. See your added jobs below.");
        router.refresh();
        return;
      }
    }
    setStatus("Still scoring; reload the page later.");
  }

  async function submit() {
    setBusy(true);
    setStatus(tab === "links" ? "Reading the job pages…" : "Adding…");
    setResults([]);
    try {
      const body =
        tab === "links"
          ? { urls: links.split(/\s+/).filter(Boolean), alreadyApplied }
          : { pasted, alreadyApplied };
      const res = await post<{ results: AddResult[]; scoring: boolean }>("/api/add", body);
      setResults(res.results);
      router.refresh();
      if (tab === "links") setLinks(res.results.filter((r) => !r.ok).map((r) => r.input).join("\n"));
      else if (res.results.every((r) => r.ok)) setPasted(EMPTY);
      if (res.scoring) await waitForScoring();
      else setStatus(alreadyApplied ? "Recorded as applied; see the Applied tab." : null);
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const pasteFor = (url: string) => {
    setPasted({ ...EMPTY, url });
    setTab("paste");
  };
  const field = (key: keyof typeof EMPTY) => ({
    value: pasted[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setPasted({ ...pasted, [key]: e.target.value }),
  });

  return (
    <div className="card stack">
      <div className="row">
        <button className={tab === "links" ? "primary" : ""} onClick={() => setTab("links")}>Paste links</button>
        <button className={tab === "paste" ? "primary" : ""} onClick={() => setTab("paste")}>Paste details</button>
      </div>

      {tab === "links" ? (
        <>
          <textarea
            style={{ minHeight: 120 }}
            placeholder={"One job link per line (up to 20)\nhttps://job-boards.greenhouse.io/company/jobs/123\nhttps://jobs.lever.co/company/abc"}
            value={links}
            onChange={(e) => setLinks(e.target.value)}
          />
          <p className="small muted">
            Greenhouse, Lever, Ashby and SmartRecruiters links are read with their application questions, so they can be prefilled.
            Other career sites are read from the page; if a page can&apos;t be read, paste its details instead.
          </p>
        </>
      ) : (
        <div className="stack">
          <div className="row">
            <input type="text" placeholder="Company *" {...field("company")} />
            <input type="text" placeholder="Job title *" {...field("title")} />
            <input type="text" placeholder="Location (e.g. Austin, TX or Remote)" {...field("location")} />
          </div>
          <input type="text" placeholder="Job link (optional)" {...field("url")} />
          <textarea style={{ minHeight: 160 }} placeholder="Job description *" {...field("description")} />
          <textarea
            placeholder={"Application questions (optional), one per line; end required ones with *\nWhy do you want to work here? *\nDescribe a project you led."}
            {...field("questions")}
          />
        </div>
      )}

      <div className="row">
        <button
          className="primary"
          disabled={busy || (tab === "links" ? !links.trim() : !pasted.company || !pasted.title || !pasted.description)}
          onClick={submit}
        >
          {busy ? "Working…" : alreadyApplied ? "Add as applied" : "Add and score"}
        </button>
        <label className="small">
          <input type="checkbox" checked={alreadyApplied} onChange={(e) => setAlreadyApplied(e.target.checked)} /> I already applied to these
        </label>
        {status && <span className="small warn">{status}</span>}
      </div>

      {results.length > 0 && (
        <ul className="small">
          {results.map((r) => (
            <li key={r.input}>
              {r.ok ? (
                <span className="good">
                  ✓ {r.title} · {r.company}
                  {r.existing && <span className="muted"> (already in your list)</span>}
                </span>
              ) : (
                <span className="error">
                  ✗ {r.input}: {r.error} <button className="small" onClick={() => pasteFor(r.input)}>Paste details</button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
