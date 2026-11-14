---
name: apply
description: Prepare and prefill job applications for selected jobs (resume upload, profile fields, screening answers) with duplicate and missing-field checks, then queue them for the user's approval. Use when the user asks to apply to jobs or bulk-apply.
---

# Apply

Submissions always need the user's approval per application. Never submit on your own.

1. Run `pnpm jobs apply <jobId…>` (or select jobs in the UI and click "Apply to selected"). This tailors the resume, writes answers, checks for earlier submissions to the same company and title, and prefills supported forms (Greenhouse, Lever, Ashby) headlessly with a screenshot. Nothing is submitted.
2. Report: prefilled, needs manual, needs input, skipped as duplicate.
3. Send the user to http://localhost:3000/review. There they approve each application (A) or skip it (S). Approving opens a visible browser that fills the form again and submits; CAPTCHAs are left to the user.
4. Questions that need the user's input appear on http://localhost:3000/stories.

Do not drive the browser yourself for submissions, do not solve CAPTCHAs, and do not automate LinkedIn or Indeed.
