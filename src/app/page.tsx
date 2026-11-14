import { jobsRepo, runsRepo } from "@/lib/db";
import { groupJobs, postedWithin } from "@/lib/jobs/sort";
import { llmMode } from "@/lib/llm";
import { spentToday } from "@/lib/llm/cost";
import { tryConfig } from "@/lib/server";
import { JobList } from "./components/JobList";
import { toView } from "@/lib/jobView";
import { RunPanel } from "./components/RunPanel";
import { SetupNotice } from "./components/SetupNotice";

export const dynamic = "force-dynamic";

const POSTED_DAYS = [1, 3, 7, 14, 30];

export default async function JobsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { config, error } = tryConfig();
  if (!config) return <SetupNotice error={error} />;
  const params = await searchParams;
  const showBelowMin = params.belowMin === "1";
  const showHidden = params.hidden === "1";
  const showLowScores = params.low === "1";
  const posted = POSTED_DAYS.includes(Number(params.posted)) ? Number(params.posted) : null;
  const threshold = config.scoring.threshold;

  const scored = postedWithin(
    jobsRepo.byStatus("scored", "skipped", "hidden", "applying", ...(showLowScores ? (["below_threshold", "ineligible"] as const) : [])),
    posted,
  );
  const unscored = postedWithin(jobsRepo.byStatus("new"), posted).sort((a, b) => (b.postedAt ?? "").localeCompare(a.postedAt ?? ""));
  const groups = groupJobs(scored, { threshold, showBelowMinSalary: showBelowMin, showHidden, showLowScores });
  const lowCount = postedWithin(jobsRepo.byStatus("below_threshold", "ineligible"), posted).length;
  const belowMinCount = scored.filter((j) => j.belowMinSalary && (showLowScores || (j.score ?? 0) > threshold)).length;
  const hiddenCount = scored.filter((j) => j.status === "hidden" || j.status === "skipped").length;
  const total = groups.reduce((n, g) => n + g.ready.length + g.needsInput.length, 0);

  return (
    <>
      <h1>Jobs</h1>
      <p className="sub">
        {total} {showLowScores ? "scored jobs" : `matches above ${threshold}`}
        {unscored.length > 0 && ` · ${unscored.length} not scored yet`} · LLM: {llmMode(config)}
        {llmMode(config) === "api" && ` · today $${spentToday().toFixed(2)} of $${config.llm.dailyBudgetUsd}`}
      </p>
      <RunPanel initialRuns={runsRepo.recent(5)} newJobs={jobsRepo.byStatus("new").length} />
      <JobList
        groups={groups.map((g) => ({ key: g.key, title: g.title, ready: g.ready.map(toView), needsInput: g.needsInput.map(toView) }))}
        unscored={unscored.map(toView)}
        threshold={threshold}
        posted={posted}
        showBelowMin={showBelowMin}
        showHidden={showHidden}
        showLowScores={showLowScores}
        belowMinCount={belowMinCount}
        hiddenCount={hiddenCount}
        lowCount={lowCount}
      />
    </>
  );
}
