import { applicationsRepo, jobsRepo, runsRepo } from "@/lib/db";
import { groupJobs } from "@/lib/jobs/sort";
import { formatSalary } from "@/lib/jobs/salary";
import type { Job } from "@/lib/jobs/types";
import { llmMode } from "@/lib/llm";
import { spentToday } from "@/lib/llm/cost";
import { tryConfig } from "@/lib/server";
import { JobList, type JobView } from "./components/JobList";
import { RunPanel } from "./components/RunPanel";
import { SetupNotice } from "./components/SetupNotice";

export const dynamic = "force-dynamic";

function toView(j: Job): JobView {
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
    score: j.score ?? 0,
    summary: j.scoreResult?.summary ?? "",
    matched: j.scoreResult?.matched ?? [],
    gaps: j.scoreResult?.gaps ?? [],
    selected: j.selected,
    status: j.status,
    autoFillable: j.autoFillable === true,
    needsInput:
      j.questions == null
        ? ["Application form could not be read automatically"]
        : j.questions.filter((q) => q.required && !q.answerable).map((q) => q.label),
    unverifiedLink: j.live === null,
    belowMinSalary: j.belowMinSalary,
    application: applicationsRepo.byJob(j.id)?.status ?? null,
  };
}

export default async function JobsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { config, error } = tryConfig();
  if (!config) return <SetupNotice error={error} />;
  const params = await searchParams;
  const showBelowMin = params.belowMin === "1";
  const showHidden = params.hidden === "1";

  const all = jobsRepo.byStatus("scored", "skipped", "hidden", "applying");
  const groups = groupJobs(all, { threshold: config.scoring.threshold, showBelowMinSalary: showBelowMin, showHidden });
  const belowMinCount = all.filter((j) => j.belowMinSalary && (j.score ?? 0) > config.scoring.threshold).length;
  const hiddenCount = all.filter((j) => j.status === "hidden" || j.status === "skipped").length;
  const total = groups.reduce((n, g) => n + g.ready.length + g.needsInput.length, 0);

  return (
    <>
      <h1>Jobs</h1>
      <p className="sub">
        {total} matches above {config.scoring.threshold} · LLM: {llmMode(config)}
        {llmMode(config) === "api" && ` · today $${spentToday().toFixed(2)} of $${config.llm.dailyBudgetUsd}`}
      </p>
      <RunPanel initialRuns={runsRepo.recent(5)} newJobs={jobsRepo.byStatus("new").length} />
      <JobList
        groups={groups.map((g) => ({ key: g.key, title: g.title, ready: g.ready.map(toView), needsInput: g.needsInput.map(toView) }))}
        showBelowMin={showBelowMin}
        showHidden={showHidden}
        belowMinCount={belowMinCount}
        hiddenCount={hiddenCount}
      />
    </>
  );
}
