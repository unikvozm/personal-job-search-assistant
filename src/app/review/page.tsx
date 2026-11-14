import fs from "node:fs";
import path from "node:path";
import { applicationsRepo, jobsRepo } from "@/lib/db";
import { formUrl } from "@/lib/apply/prefill";
import { ReviewQueue, type ReviewItem } from "../components/ReviewQueue";

export const dynamic = "force-dynamic";

const read = (file: string) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "");

export default function ReviewPage() {
  const items: ReviewItem[] = applicationsRepo.byStatus("prefilled", "needs_manual").flatMap((app) => {
    const job = jobsRepo.get(app.jobId);
    if (!job) return [];
    const dir = app.resumeDir ?? "";
    return [{
      id: app.id,
      status: app.status,
      title: job.title,
      company: job.company,
      url: formUrl(job),
      score: job.score ?? 0,
      resumePdf: dir ? path.join(dir, "resume.pdf") : null,
      changes: dir ? read(path.join(dir, "changes.md")) : "",
      screenshot: app.screenshot,
      missing: app.missingFields ?? [],
      notes: app.notes,
      questions: (job.questions ?? [])
        .filter((q) => q.type !== "file")
        .map((q) => ({ id: q.id, label: q.label, required: q.required, standard: !!q.standardKey, answer: app.answers?.[q.id] ?? "" })),
    }];
  });

  return (
    <>
      <h1>Review queue</h1>
      <p className="sub">
        Each application is submitted only after you approve it. <kbd>A</kbd> approve · <kbd>S</kbd> skip · <kbd>→</kbd> next
      </p>
      {items.length === 0 ? <p className="muted">Nothing to review. Select jobs on the Jobs page and click “Apply to selected”.</p> : <ReviewQueue items={items} />}
    </>
  );
}
