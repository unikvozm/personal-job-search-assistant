import { applicationsRepo, jobsRepo } from "@/lib/db";
import { toIcs, type CalendarEvent } from "@/lib/tracker/ics";

export const dynamic = "force-dynamic";

/** Follow-ups and interviews as an .ics file you can import or subscribe to. */
export function GET() {
  const events: CalendarEvent[] = [];
  for (const app of applicationsRepo.all()) {
    const job = jobsRepo.get(app.jobId);
    if (!job) continue;
    const label = `${job.title} — ${job.company}`;
    if (app.followUpAt && app.status === "submitted") {
      events.push({ uid: `followup-${app.id}`, start: app.followUpAt, allDay: true, title: `Follow up: ${label}`, url: job.url });
    }
    if (app.interviewAt) {
      events.push({ uid: `interview-${app.id}`, start: app.interviewAt, title: `Interview: ${label}`, description: app.notes, url: job.url });
    }
  }
  return new Response(toIcs(events), {
    headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": 'attachment; filename="job-search.ics"' },
  });
}
