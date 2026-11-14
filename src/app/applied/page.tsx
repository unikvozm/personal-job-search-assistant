import path from "node:path";
import { APPLIED_STATUSES, applicationsRepo, jobsRepo } from "@/lib/db";
import { TrackerTable, type TrackerRow } from "../components/TrackerTable";

export const dynamic = "force-dynamic";

export default function AppliedPage() {
  const applied = new Set<string>(APPLIED_STATUSES);
  const rows: TrackerRow[] = applicationsRepo.all().flatMap((app) => {
    const job = jobsRepo.get(app.jobId);
    if (!job || !applied.has(app.status)) return [];
    return [{
      id: app.id,
      jobId: job.id,
      company: job.company,
      title: job.title,
      url: job.url,
      status: app.status,
      submittedAt: app.submittedAt?.slice(0, 10) ?? "",
      followUpAt: app.followUpAt?.slice(0, 10) ?? "",
      interviewAt: app.interviewAt?.slice(0, 16) ?? "",
      notes: app.notes,
      resumePdf: app.resumeDir ? path.join(app.resumeDir, "resume.pdf") : null,
    }];
  });
  const today = new Date().toISOString().slice(0, 10);
  const due = rows.filter((r) => r.status === "submitted" && r.followUpAt && r.followUpAt <= today).length;

  return (
    <>
      <div className="row">
        <h1>Applied</h1>
        <span className="spacer" />
        <a className="button" href="/api/calendar">Export follow-ups &amp; interviews (.ics)</a>
      </div>
      <p className="sub">
        {rows.length} applications · {rows.filter((r) => r.status === "interview").length} interviewing · {rows.filter((r) => r.status === "offer").length} offers
        {due > 0 && <span className="warn"> · {due} follow-up(s) due</span>}
      </p>
      <TrackerTable rows={rows} today={today} />
    </>
  );
}
