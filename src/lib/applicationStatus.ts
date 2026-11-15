/** Human labels for application statuses (safe to import from client components). */
export const STATUS_LABEL: Record<string, string> = {
  preparing: "Processing…",
  needs_input: "Needs your input",
  awaiting_answers: "Answers not written yet",
  ready: "Prepared",
  prefilled: "Ready for review",
  needs_manual: "Ready (manual form)",
  approved: "Submitting…",
  submitted: "Submitted",
  submit_unconfirmed: "Submitted? (unconfirmed)",
  interview: "Interview",
  offer: "Offer",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
  skipped: "Skipped",
};

/** Applications that are being worked on (not yet applied, not skipped). */
export const IN_PROGRESS_STATUSES = ["preparing", "needs_input", "awaiting_answers", "ready", "prefilled", "needs_manual", "approved"] as const;

/** Statuses during which the server is still working, so the page should keep refreshing. */
export const BUSY_STATUSES = new Set(["preparing", "approved"]);

export const statusLabel = (s: string) => STATUS_LABEL[s] ?? s.replace(/_/g, " ");
