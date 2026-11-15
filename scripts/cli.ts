import fs from "node:fs";
import { prefill, submit } from "../src/lib/apply/prefill";
import { loadConfig } from "../src/lib/config";
import { applicationsRepo, jobsRepo } from "../src/lib/db";
import { BudgetError, spentToday } from "../src/lib/llm/cost";
import { llmMode } from "../src/lib/llm";
import { findJobs } from "../src/lib/pipeline/find";
import { generatePrep } from "../src/lib/pipeline/prep";
import { prepareApplications } from "../src/lib/pipeline/prepare";
import { scoreJobs } from "../src/lib/pipeline/score";

if (fs.existsSync(".env.local")) process.loadEnvFile(".env.local");

const [command = "help", ...rest] = process.argv.slice(2);
const flags = new Set(rest.filter((a) => a.startsWith("--")));
const args = rest.filter((a) => !a.startsWith("--"));
const allowOverBudget = flags.has("--allow-over-budget");
/** --days=30 → search postings from the last 30 days instead of "since the last run". */
const daysFlag = [...flags].find((f) => f.startsWith("--days="));
const days = daysFlag ? Number(daysFlag.slice("--days=".length)) || undefined : undefined;

const HELP = `Usage: pnpm jobs <command>

  find                 Fetch, filter, dedupe and store new postings (no LLM) → data/runs/<date>/jobDescriptions.md
  score [jobId…]       Score unscored jobs (all, or just these) against CV.md and classify their questions
  daily                find + score
  prepare <jobId…>     Resume (family or tailored) + free answers (or --selected for all ticked jobs)
  apply <jobId…>       prepare, then prefill the forms that are ready
  answers <jobId…>     Write the remaining answers with Claude, then prefill
  tailor <jobId…>      Write a resume for these postings (even below applications.tailorMinScore)
  prefill [appId…]     Fill forms headlessly and screenshot them for review (default: all "ready")
  submit <appId>       Submit ONE approved application in a visible browser
  prep <jobId>         Generate interview questions and practice material
  status               Counts and today's API spend

Flags: --allow-over-budget  run even if the estimate exceeds llm.dailyBudgetUsd
       --days=N             find/daily: postings from the last N days instead of since the last run`;

async function main() {
  if (command === "help") return console.log(HELP);
  const config = loadConfig();
  switch (command) {
    case "find": {
      const r = await findJobs(config, console.log, { days });
      console.log(r.stats, `\n→ ${r.file}`);
      r.warnings.forEach((w) => console.warn(`⚠️ ${w}`));
      break;
    }
    case "score":
      console.log(await scoreJobs(config, { allowOverBudget, ids: args }));
      break;
    case "daily": {
      const r = await findJobs(config, console.log, { days });
      r.warnings.forEach((w) => console.warn(`⚠️ ${w}`));
      if (r.stats.new === 0) {
        // Nothing new: don't start a scoring batch. Older unscored jobs are scored via "score".
        console.log("No new jobs found - scoring skipped.");
        break;
      }
      console.log(await scoreJobs(config, { allowOverBudget }));
      break;
    }
    case "prepare": {
      const ids = flags.has("--selected") ? jobsRepo.byStatus("scored").filter((j) => j.selected).map((j) => j.id) : args;
      if (!ids.length) throw new Error("Pass job ids or --selected");
      console.log(await prepareApplications(config, ids, { allowOverBudget }));
      break;
    }
    case "apply":
    case "answers":
    case "tailor": {
      // apply: "Apply to selected" (resume + free answers, Claude answers if applications.answers = auto)
      // answers: "Write answers" on the job page; tailor: "Tailor for this job".
      if (!args.length) throw new Error("Pass job ids");
      console.log(await prepareApplications(config, args, { allowOverBudget, writeAnswers: command === "answers", tailor: command === "tailor" }));
      const ready = args.map((id) => applicationsRepo.byJob(id)).filter((a) => a?.status === "ready").map((a) => a!.id);
      if (ready.length) console.log(await prefill(config, ready));
      break;
    }
    case "prefill":
      console.log(await prefill(config, args.map(Number)));
      break;
    case "submit":
      if (!args[0]) throw new Error("Pass an application id");
      await submit(config, Number(args[0]));
      break;
    case "prep":
      if (!args[0]) throw new Error("Pass a job id");
      console.log(JSON.stringify(await generatePrep(config, args[0], { allowOverBudget }), null, 2));
      break;
    case "status": {
      const count = (s: Parameters<typeof jobsRepo.byStatus>[0]) => jobsRepo.byStatus(s).length;
      console.log({
        llmMode: llmMode(config),
        spentTodayUsd: Number(spentToday().toFixed(3)),
        budgetUsd: config.llm.dailyBudgetUsd,
        jobs: { new: count("new"), scored: count("scored"), applying: count("applying"), applied: count("applied") },
        reviewQueue: applicationsRepo.byStatus("prefilled", "needs_manual").length,
      });
      break;
    }
    default:
      console.log(HELP);
      process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e instanceof BudgetError ? `💸 ${e.message}` : `✖ ${(e as Error).message}`);
  process.exitCode = e instanceof BudgetError ? 3 : 1;
});
