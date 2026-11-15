import fs from "node:fs";
import path from "node:path";
import { notFound } from "next/navigation";
import { formUrl } from "@/lib/apply/prefill";
import { applicationsRepo, db, jobsRepo } from "@/lib/db";
import { formatSalary } from "@/lib/jobs/salary";
import { estimate } from "@/lib/llm";
import { prepareTasks } from "@/lib/pipeline/prepare";
import { customQuestions } from "@/lib/pipeline/tasks";
import { resumeSource } from "@/lib/resume/families";
import { tryConfig } from "@/lib/server";
import { ApplicationEditor, type EditorQuestion } from "../../components/ApplicationEditor";

export const dynamic = "force-dynamic";

const read = (file: string) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "");

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = jobsRepo.get(id);
  if (!job) notFound();
  const app = applicationsRepo.byJob(id);

  // Clarifying questions still open for this job, shown next to the question they belong to.
  const pending = db()
    .prepare("SELECT question, clarifying_question AS clarifying FROM pending_stories WHERE job_id = ? AND status IN ('open', 'drafted')")
    .all(id) as { question: string; clarifying: string }[];
  const hint = new Map(pending.map((p) => [p.question, p.clarifying]));

  const questions: EditorQuestion[] = (job.questions ?? [])
    .filter((q) => q.type !== "file")
    .map((q) => ({ id: q.id, label: q.label, required: q.required, standard: !!q.standardKey, options: q.options ?? [], hint: hint.get(q.label) ?? "" }));
  const dir = app?.resumeDir ?? "";
  const { config } = tryConfig();
  // What "Write answers" would send to Claude (saved answers and configs.md fields are free).
  const remaining = customQuestions(job).filter((q) => !app?.answers?.[q.id]).length;
  let answersCost: number | null = null;
  if (config && app && remaining) {
    try {
      const tasks = prepareTasks([job], config, { writeAnswers: true }).filter((t) => t.id.startsWith("answers-"));
      answersCost = estimate(config, tasks, config.llm.batchWriting);
    } catch {
      answersCost = null;
    }
  }

  return (
    <>
      <p className="small"><a href="/">← Jobs</a></p>
      <h1>{job.title}</h1>
      <p className="sub">
        {job.company} · {job.location || "location not stated"}
        {job.salary && ` · ${formatSalary(job.salary)}`}
        {job.score != null && ` · score ${job.score}`}
        {/^https?:/.test(job.url) && <> · <a href={job.url} target="_blank" rel="noreferrer">posting</a></>}
      </p>
      {job.scoreResult?.summary && <p>{job.scoreResult.summary}</p>}
      <ApplicationEditor
        jobId={job.id}
        application={
          app
            ? {
                id: app.id,
                status: app.status,
                notes: app.notes,
                answers: app.answers ?? {},
                resumePdf: dir && fs.existsSync(path.join(dir, "resume.pdf")) ? path.join(dir, "resume.pdf") : null,
                changes: dir ? read(path.join(dir, "changes.md")) : "",
                formUrl: formUrl(job),
              }
            : null
        }
        questions={questions}
        formKnown={job.questions != null}
        resumeSource={resumeSource(dir || null)}
        remaining={remaining}
        answersCost={answersCost}
      />
    </>
  );
}
