# Personal Job Search Assistant

A local job-search pipeline: find 100+ fresh openings a day, score them against your CV, tailor a resume and answers for the ones you pick, prefill the application forms, and track everything until the offer, with interview practice along the way.

This repository is a **template**: it contains no personal data. Your CV, stories, config and the database stay on your machine (gitignored, plus a pre-commit guard).

| Step | What happens | Claude used? |
|---|---|---|
| 1. Find | Job boards and company ATS boards are fetched, filtered, deduplicated and link-checked → `data/runs/<date>/jobDescriptions.md` | No |
| 2. Score | Each job gets a 0–100 fit score with breakdown; ≤ 70 and ineligible jobs are hidden | Haiku, batch (~$0.0005/job) |
| 3. Tailor | Summary (hook kept), skills and bullets rewritten per job → Markdown + ATS-friendly PDF | Sonnet, only for jobs you select |
| 4. Answers | Screening questions answered from your CV and story bank; missing stories become questions for you | Sonnet |
| 5. Apply | Forms prefilled (Greenhouse, Lever, Ashby), screenshots queued; you approve each submission | No |
| 6. Track & prep | Statuses, follow-ups, interview dates, `.ics` export, likely interview questions and practice feedback | Sonnet / Haiku |

## Setup

Requires Node 22.13+ and pnpm.

```bash
pnpm install
pnpm setup                               # creates configs.md, CV.md, interviewBankStories.md, .env.local
pnpm exec playwright install chromium    # PDFs, form reading, prefill
```

1. **configs.md**: fill in the YAML block. `search.countries` (ISO codes, or `REMOTE`) and `search.titles` are required; the countries decide which boards are searched. Add 20–50 `targetCompanies` (their Greenhouse/Lever/Ashby/SmartRecruiters board slug) for the best results.
2. **CV.md**: your CV in Markdown. Wrap your hook sentence in `<!-- hook -->…<!-- /hook -->` so tailoring never changes it.
3. **interviewBankStories.md**: your STAR stories (`## S01 — Title`, `Tags:`, Situation/Task/Action/Result).
4. **.env.local**: `ANTHROPIC_API_KEY` for API mode; optionally a free [Adzuna](https://developer.adzuna.com) key for national job boards.

```bash
pnpm dev     # http://localhost:3000 (bound to 127.0.0.1 only)
```

## Daily use

1. **Jobs** → *Find & score new jobs*. The first run looks back 30 days; later runs pick up from the previous run.
2. The list shows jobs scoring above 70: **salary stated** first, then **no salary stated**. Within each, jobs whose application can be filled entirely from your config and stories are **ticked**; jobs needing your input are unticked. Skip or hide anything you don't want.
3. **Apply to selected** shows the cost estimate, then tailors resumes, writes answers and prefills forms. Nothing is submitted yet.
4. **Review**: check each prefilled form, resume and answers; <kbd>A</kbd> approves (a browser window fills and submits; you handle any CAPTCHA), <kbd>S</kbd> skips. Forms that can't be filled automatically get copy buttons and *I submitted it*.
5. **Stories**: answer the open questions; a STAR draft is generated and added to your story bank after you approve it.
6. **Tracker**: update statuses, follow-up and interview dates; export to your calendar; open **Prep** for interview questions and practice.

Everything is also available from the CLI (`pnpm jobs help`) and as Claude Code skills in `.claude/skills` (`/find-jobs`, `/score-jobs`, `/tailor-resume`, `/application-answers`, `/apply`, `/interview-prep`).

## Cost and Claude modes

**Settings** switches between:
- **Anthropic API** (default): Haiku for high-volume scoring through the 50%-cheaper Batch API, Sonnet for writing, CV cached across calls. A typical day (300 jobs scored, 20 applications prepared) costs about $2–3. Every run is estimated first and stops at `llm.dailyBudgetUsd` unless you confirm.
- **Claude plan**: the same prompts run through the Claude Code CLI (`claude -p`), with no API charges, subject to your plan's limits.

## Job sources

| Source | When it runs | Notes |
|---|---|---|
| Greenhouse, Lever, Ashby, SmartRecruiters | `targetCompanies` listed | First-party, always live, structured salary where published |
| Remotive, RemoteOK, Himalayas, Jobicy | `workModes` includes remote, or `REMOTE` in countries | Remote roles; check `countries` restrictions |
| Arbeitnow | DE, AT, CH | German market |
| Adzuna | GB, US, DE, FR, NL, AT, BE, IT, ES, PL, CH, CA, AU, … | Needs a free key; descriptions are snippets |

LinkedIn and Indeed are not scraped or automated (their terms forbid it); apply there manually and add the job to the tracker.

## Development

```bash
pnpm typecheck
pnpm test
```

See [docs/DESIGN.md](docs/DESIGN.md) for the architecture.
