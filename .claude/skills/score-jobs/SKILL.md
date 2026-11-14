---
name: score-jobs
description: Score unscored jobs against CV.md (0-100 with breakdown), hide weak or ineligible ones, and mark which applications can be auto-filled from the story bank. Use when the user asks to evaluate, rank or match jobs.
---

# Score jobs

1. Run `pnpm jobs score`. Scoring uses the cheap model (Haiku) through the Batch API and caches the CV, so 100 jobs cost about $0.05.
2. Report: how many were scored, how many are above the threshold, failures.
3. To show the top matches, query the database instead of reading files:
   ```bash
   sqlite3 data/tracker.sqlite "SELECT score, company, title, json_extract(salary,'$.max') FROM jobs WHERE status='scored' AND below_min_salary=0 ORDER BY (salary IS NULL), score DESC LIMIT 20"
   ```
4. Never change scores by hand; adjust `scoring.threshold` in configs.md if the user wants a different cut-off.
