# CV Optimizer — Design

A public GitHub template for a personal job-search pipeline. All personal data lives only on your machine (gitignored).

## Decisions

| Topic | Decision |
|---|---|
| Repo | Public GitHub **template** repo under your personal account. Personal files gitignored + pre-commit guard. |
| Stack | Single Next.js 16 + TypeScript app (UI + API routes) with a CLI (`scripts/cli.ts`) for long-running steps, SQLite via Node's built-in `node:sqlite`, Playwright. |
| LLM | `llm.mode: api` by default (Anthropic SDK: Haiku 5.5 for scoring/classifying, Sonnet 5.5 for writing). `claude-code` mode runs the same steps as Claude Code skills on your plan. Switchable in the UI. Cost estimate shown before each run; daily budget cap. |
| Job sourcing | Scripts, not Claude: board adapters picked by the countries in `configs.md`, plus ATS public APIs (Greenhouse, Lever, Ashby, SmartRecruiters) for a target-company list. Workable and the Bundesagentur API were dropped: no usable public endpoint. |
| Search window | First run: postings from the last 30 days. Next runs: since the previous run, capped at 30 days. One run per day, on demand (UI button or `pnpm jobs:find`). |
| Applying | Playwright prefills Greenhouse, Lever and Ashby forms. Other forms (Workday, SmartRecruiters, aggregator links) go to the review queue as "open & copy" with copy buttons. LinkedIn/Indeed stay manual (their terms forbid automation). |
| Approval | Fast review queue: every prefilled application needs its own approve/skip. Nothing is submitted without it. |
| Resume output | PDF from an ATS-friendly single-column HTML template; Markdown source kept. |
| Tracking | Manual status updates, follow-up reminders, `.ics` export. No mailbox access. |

## Files

```
configs.example.md, CV.example.md, interviewBankStories.example.md   templates (copied by `pnpm setup`)
data/                       (gitignored) tracker.sqlite, runs/<date>/jobDescriptions.md, resumes/<company-role>/, screenshots/, logs/
scripts/cli.ts              pnpm jobs <find|score|daily|prepare|apply|prefill|submit|prep|status>
src/lib/sources/            job board + ATS adapters, picked by country
src/lib/jobs/               normalize, dedupe, salary, filters, list ordering
src/lib/llm/                prompts + schemas, API backend (batch, caching, fallbacks), Claude Code CLI backend, cost guard
src/lib/pipeline/           find, score (+ question classification), prepare (tailor + answers), stories, prep
src/lib/apply/              form questions, standard fields, prefill, submit
src/app/                    Jobs, Review, Stories, Tracker, Prep, Settings + API routes
.claude/skills/             find-jobs, score-jobs, tailor-resume, application-answers, apply, interview-prep
```

`configs.md` prerequisites: target titles, **countries** (decides which boards run), remote preference, visa/work-authorization per country, min salary + currency, seniority, target companies, excluded companies/keywords, daily budget cap, `llm.mode`.

## Pipeline (6 skills)

1. **Find jobs** (no LLM): fetch → normalize → dedupe (canonical URL + company/title/location fingerprint) → check links are live → drop expired → keyword pre-filter → write `runs/<date>/jobDescriptions.md` + db rows.
2. **Score** (Haiku, Batch API, CV cached): per job, a 0–100 score with breakdown (experience, skills, qualifications, responsibilities, eligibility/visa) + evidence. Score ≤ 70 hidden. Stated salary below your minimum is hidden behind a "Below min salary" toggle.
   Also classifies application questions (fetched from the ATS form) as *answerable from bank stories* or *needs input*.
3. **Tailor** (Sonnet, only for jobs you select): rewrites summary (keeps your hook), skills and relevant bullets; ATS keywords only where the CV supports them; never invents numbers. Shows a diff against CV.md for approval → PDF.
4. **Answers** (Sonnet): answers each question from CV + stories. When a page gives separate instructions for humans and AI, the human instructions are followed. With no matching story it asks you, drafts it in STAR format, and adds it to `interviewBankStories.md` after you approve.
5. **Apply** (Playwright): prefill → check for duplicate submissions and missing fields → screenshot → review queue → submit only after you approve → application log.
6. **Track & prep**: statuses, submission dates, follow-up dates, interview invites (manual), plus interview questions and practice sessions generated per job description.

## Job list order (score > 70)

1. **Salary stated**, by score, then **no salary stated**, by score.
2. Within each group: **ticked** = all questions can be filled from bank stories; **unticked** = needs your input.
3. Bulk actions: Apply to selected · Skip · Hide.

## Cost (API mode, estimated)

| Step | Model | Unit cost |
|---|---|---|
| Score | Haiku 5.5 (batch) | ~$0.0005 / job → 300 jobs ≈ $0.15 |
| Tailor resume | Sonnet 5.5 | ~$0.05–0.08 / job |
| Answers | Sonnet 5.5 | ~$0.03 / job |
| Interview prep | Sonnet 5.5 | ~$0.05 / job |

A day with 300 scored jobs and 20 selected costs about $2–3. The daily cap (default $5) stops runs that would go over and asks first.
