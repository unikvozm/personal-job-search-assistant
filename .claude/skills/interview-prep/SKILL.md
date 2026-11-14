---
name: interview-prep
description: Track applications (statuses, follow-ups, interview dates) and prepare customized interview questions and practice sessions for a job. Use when the user asks about application status, follow-ups, an upcoming interview, or wants to practice.
---

# Tracker and interview prep

- Status overview: `pnpm jobs status`. Due follow-ups:
  ```bash
  sqlite3 data/tracker.sqlite "SELECT j.company, j.title, a.follow_up_at FROM applications a JOIN jobs j ON j.id=a.job_id WHERE a.status='submitted' AND a.follow_up_at <= datetime('now')"
  ```
- Status changes, interview dates and notes are edited at http://127.0.0.1:3417/tracker; follow-ups and interviews export to a calendar via /api/calendar (.ics).
- Interview prep: `pnpm jobs prep <jobId>` generates likely questions mapped to story ids, gaps to prepare and questions to ask; practice with feedback at http://127.0.0.1:3417/prep/<jobId>.
- For a live mock interview in this chat: read the prep output, ask one question at a time, wait for the user's answer, then give short feedback (STAR completeness, relevance, concreteness) using only facts from their answer and stories.
