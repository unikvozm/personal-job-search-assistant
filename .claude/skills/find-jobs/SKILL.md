---
name: find-jobs
description: Find new job openings for the user's target titles and countries (configs.md), dedupe them, drop expired ones and write data/runs/<date>/jobDescriptions.md. Use when the user asks to search for jobs, run the daily job search, or refresh job listings.
---

# Find jobs

Fetching is done by scripts, not by you - this keeps token use near zero.

1. Run `pnpm jobs daily` (find + score). Use `pnpm jobs find` if the user only wants the search without scoring.
2. Report the stats line and any ⚠️ warnings from the output, plus the path of the jobDescriptions.md file. Do **not** read jobDescriptions.md into context unless the user asks about specific jobs; if they do, grep for the company or title instead of reading the whole file.
3. If fewer than `search.minJobs` jobs were found, suggest concrete configs.md changes: more `titles`, more `targetCompanies` (Greenhouse/Lever/Ashby/SmartRecruiters slugs), or an Adzuna key in `.env.local`.
4. If the run stopped with a budget message, tell the user the estimate and ask before re-running with `--allow-over-budget`.

Point the user to http://127.0.0.1:3417 (`pnpm dev`) to review and select jobs.
