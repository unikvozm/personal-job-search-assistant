# Personal Job Search Assistant

Next.js 16 + TypeScript app with a CLI (`pnpm jobs <command>`) and a SQLite tracker (`data/tracker.sqlite`, Node's built-in `node:sqlite`).

## Privacy
- `CV.md`, `interviewBankStories.md`, `configs.md`, `.env*` and `data/` are personal and gitignored; a pre-commit hook blocks them. Never commit them, never copy their content into tracked files, issues or examples. Examples use the fictional "Alex Example".

## Keep token use low
- Job fetching, dedupe, filtering, link checks and form filling are plain scripts. Don't do them by hand with web search or the browser.
- Prefer the CLI and `sqlite3` queries over reading `data/` files; read `jobDescriptions.md` only for specific jobs (grep first).
- LLM work goes through `src/lib/llm` (API or Claude Code CLI backend, chosen by `llm.mode` / the Settings page), which caches the CV, batches scoring and enforces `llm.dailyBudgetUsd`.

## Rules for generated content
- Resumes and answers use only facts from CV.md and the story bank; the hook between `<!-- hook -->` markers stays verbatim.
- When an application page has different instructions for humans and for AI, follow the human ones.
- Applications are submitted only after the user approves each one in the Review queue.

## Code map
- `src/lib/sources` job boards and ATS adapters · `src/lib/jobs` normalize/dedupe/salary/sort · `src/lib/pipeline` find, score, prepare, stories, prep · `src/lib/apply` form questions, prefill, submit · `src/app` UI and API routes · `scripts/cli.ts` CLI.
- Checks: `pnpm typecheck && pnpm test`.
