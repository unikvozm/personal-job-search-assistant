---
name: tailor-resume
description: Tailor CV.md to selected job descriptions and produce an ATS-friendly PDF resume per job (keeps the hook, never invents facts). Use when the user asks to customize, tailor or rewrite their resume for a job.
---

# Tailor resumes

1. Get the job ids: the user's selection in the UI (`pnpm jobs prepare --selected`) or specific ids from the jobs table.
2. Run `pnpm jobs prepare <jobId…>`. It writes `data/resumes/<company-role>/resume.md`, `resume.pdf` and `changes.md`, and drafts application answers in the same pass.
3. Read only `changes.md` for each job and relay it, including every ⚠️ line - those flag a changed hook or numbers that are not in CV.md. Ask the user to fix or confirm them before applying.
4. Hard rules if the user asks you to edit a tailored resume directly: use exactly one hook from CV.md word for word (CV.md may hold variants `<!-- hook:name -->…<!-- /hook -->`, one per role family), never add employers, dates, tools or numbers that aren't in CV.md, and keep the Markdown contract documented at the top of `src/lib/resume/render.ts` (`### Company — Role | Dates`, `- **Outcome:** …`). Resumes must stay one page; `changes.md` warns when they don't. Re-render by deleting resume.pdf and re-running prepare.
