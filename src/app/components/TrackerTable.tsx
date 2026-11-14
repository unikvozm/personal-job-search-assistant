"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { fileUrl, post } from "./api";

export interface TrackerRow {
  id: number;
  jobId: string;
  company: string;
  title: string;
  url: string;
  status: string;
  submittedAt: string;
  followUpAt: string;
  interviewAt: string;
  notes: string;
  resumePdf: string | null;
}

const STATUSES = ["needs_input", "ready", "prefilled", "needs_manual", "approved", "submitted", "submit_unconfirmed", "interview", "offer", "rejected", "withdrawn", "skipped"];

export function TrackerTable({ rows, today }: { rows: TrackerRow[]; today: string }) {
  const router = useRouter();
  const update = async (id: number, patch: Record<string, string | null>) => {
    await post(`/api/applications/${id}`, { action: "update", patch });
    router.refresh();
  };

  if (!rows.length) return <p className="muted">No applications yet. Applications appear here once submitted, or when you mark a job as applied.</p>;
  return (
    <div className="scroll">
      <table className="table">
        <thead>
          <tr>
            <th>Company / role</th>
            <th>Status</th>
            <th>Submitted</th>
            <th>Follow up</th>
            <th>Interview</th>
            <th>Notes</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                <strong>{r.company}</strong>
                <div className="small"><a href={r.url} target="_blank" rel="noreferrer">{r.title}</a></div>
              </td>
              <td>
                <select defaultValue={r.status} onChange={(e) => update(r.id, { status: e.target.value })}>
                  {STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
                </select>
              </td>
              <td className="small">{r.submittedAt}</td>
              <td>
                <input
                  type="date"
                  defaultValue={r.followUpAt}
                  className={r.status === "submitted" && r.followUpAt && r.followUpAt <= today ? "warn" : ""}
                  onBlur={(e) => e.target.value !== r.followUpAt && update(r.id, { followUpAt: e.target.value ? new Date(e.target.value).toISOString() : null })}
                />
              </td>
              <td>
                <input
                  type="datetime-local"
                  defaultValue={r.interviewAt}
                  onBlur={(e) => e.target.value !== r.interviewAt && update(r.id, { interviewAt: e.target.value ? new Date(e.target.value).toISOString() : null })}
                />
              </td>
              <td>
                <input type="text" defaultValue={r.notes} onBlur={(e) => e.target.value !== r.notes && update(r.id, { notes: e.target.value })} />
              </td>
              <td className="small">
                <Link href={`/prep/${r.jobId}`}>Prep</Link>
                {r.resumePdf && <> · <a href={fileUrl(r.resumePdf)} target="_blank" rel="noreferrer">CV</a></>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
