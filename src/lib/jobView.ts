import type { JobView } from "@/app/components/JobList";
import type { InProgressItem } from "@/app/components/InProgress";
import { IN_PROGRESS_STATUSES } from "./applicationStatus";
import { applicationsRepo, jobsRepo } from "./db";
import { formatSalary } from "./jobs/salary";
import type { Job } from "./jobs/types";
import { ADDED_SOURCES } from "./sources/manual";

/** Server-side: a job as the list rows show it. */
export function toView(j: Job): JobView {
  return {
    id: j.id,
    title: j.title,
    company: j.company,
    location: [j.location, j.workMode].filter(Boolean).join(" · "),
    url: j.url,
    salary: formatSalary(j.salary),
    salaryEstimated: j.salarySource === "llm",
    postedAt: j.postedAt?.slice(0, 10) ?? "",
    source: j.source,
    addedByYou: (ADDED_SOURCES as readonly string[]).includes(j.source),
    score: j.score,
    summary: j.scoreResult?.summary ?? "",
    matched: j.scoreResult?.matched ?? [],
    gaps: j.scoreResult?.gaps ?? [],
    eligibilityNote: j.status === "ineligible" ? j.scoreResult?.eligibilityNotes || "Not eligible" : "",
    selected: j.selected,
    status: j.status,
    autoFillable: j.autoFillable === true,
    needsInput:
      j.score == null || j.status === "below_threshold" || j.status === "ineligible"
        ? []
        : j.questions == null
          ? ["Application form could not be read automatically"]
          : j.questions.filter((q) => q.required && !q.answerable).map((q) => q.label),
    unverifiedLink: j.live === null,
    belowMinSalary: j.belowMinSalary,
    application: applicationsRepo.byJob(j.id)?.status ?? null,
  };
}


/** Rows for the "In progress" section: applications not yet submitted or skipped. */
export function inProgressItems(filter: (job: Job) => boolean = () => true): InProgressItem[] {
  return applicationsRepo.byStatus(...IN_PROGRESS_STATUSES).flatMap((app) => {
    const job = jobsRepo.get(app.jobId);
    if (!job || !filter(job)) return [];
    return [{ jobId: job.id, title: job.title, company: job.company, score: job.score, status: app.status, note: app.notes, updatedAt: app.updatedAt }];
  });
}
