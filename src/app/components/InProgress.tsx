"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { BUSY_STATUSES, statusLabel } from "@/lib/applicationStatus";

export interface InProgressItem {
  jobId: string;
  title: string;
  company: string;
  score: number | null;
  status: string;
  note: string;
  updatedAt: string;
}

/** Jobs you selected for applying, until they are submitted. Refreshes itself while any are processing. */
export function InProgress({ items }: { items: InProgressItem[] }) {
  const router = useRouter();
  const busy = items.some((i) => BUSY_STATUSES.has(i.status));

  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(t);
  }, [busy, router]);

  if (!items.length) return null;
  return (
    <section>
      <h2>
        In progress <span className="muted small">({items.length})</span>
      </h2>
      <div className="list">
        {items.map((i) => (
          <Link key={i.jobId} href={`/jobs/${i.jobId}`} className="job inprogress">
            <span />
            <span className="score">{i.score ?? "—"}</span>
            <div>
              <div className="title">{i.title} <span className="muted">· {i.company}</span></div>
              {i.note && <div className="small muted">{i.note}</div>}
            </div>
            <div className="meta small" style={{ textAlign: "right" }}>
              <span className={`chip status-${i.status}`}>{statusLabel(i.status)}</span>
              <div className="muted">{new Date(i.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
