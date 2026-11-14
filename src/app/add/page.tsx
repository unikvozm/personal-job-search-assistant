import { jobsRepo } from "@/lib/db";
import { groupJobs } from "@/lib/jobs/sort";
import { toView } from "@/lib/jobView";
import { tryConfig } from "@/lib/server";
import { ADDED_SOURCES } from "@/lib/sources/manual";
import { AddJobsForm } from "../components/AddJobsForm";
import { JobList } from "../components/JobList";
import { SetupNotice } from "../components/SetupNotice";

export const dynamic = "force-dynamic";

export default function AddJobsPage() {
  const { config, error } = tryConfig();
  if (!config) return <SetupNotice error={error} />;
  const added = jobsRepo.bySources(ADDED_SOURCES).filter((j) => j.status !== "applied");
  const scored = added.filter((j) => j.status !== "new");
  const unscored = added.filter((j) => j.status === "new");
  // Jobs you picked yourself are all shown, whatever their score.
  const groups = groupJobs(scored, { threshold: config.scoring.threshold, showLowScores: true, showBelowMinSalary: true });

  return (
    <>
      <h1>Add jobs you found</h1>
      <p className="sub">
        Paste links or a job description. Jobs are scored against your CV right away; tick the ones you want and click “Apply to selected”, as on the Jobs page.
      </p>
      <AddJobsForm />
      <h2>Your added jobs</h2>
      {added.length === 0 ? (
        <p className="muted">Nothing added yet.</p>
      ) : (
        <JobList
          filters={false}
          groups={groups.map((g) => ({ key: g.key, title: g.title, ready: g.ready.map(toView), needsInput: g.needsInput.map(toView) }))}
          unscored={unscored.map(toView)}
          threshold={config.scoring.threshold}
          posted={null}
          showBelowMin
          showHidden={false}
          showLowScores
          belowMinCount={0}
          hiddenCount={0}
          lowCount={0}
        />
      )}
    </>
  );
}
