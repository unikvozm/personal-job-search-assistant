import path from "node:path";
import { applicationsRepo, jobsRepo } from "@/lib/db";
import { TrackerTable, type TrackerRow } from "../components/TrackerTable";

export const dynamic = "force-dynamic";

export default function TrackerPage() {
  const rows: TrackerRow[] = applicationsRepo.all().flatMap((app) => {
    const job = jobsRepo.get(app.jobId);
    if (!job || app.status === "preparing") return [];
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
        <h1>Application tracker</h1>
        <span className="spacer" />
        <a className="button" href="/api/calendar">Export follow-ups &amp; interviews (.ics)</a>
      </div>
      <p className="sub">
        {rows.filter((r) => r.submittedAt).length} submitted · {rows.filter((r) => r.status === "interview").length} interviewing
        {due > 0 && <span className="warn"> · {due} follow-up(s) due</span>}
      </p>
      <TrackerTable rows={rows} today={today} />
    </>
  );
}
