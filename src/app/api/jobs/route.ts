import { applicationsRepo, jobsRepo } from "@/lib/db";
import { json, rejectCrossSite, tryConfig } from "@/lib/server";

export const dynamic = "force-dynamic";

/** Bulk list actions. Body: { ids, action: select | deselect | skip | hide | restore | applied } */
export async function POST(req: Request) {
  const blocked = rejectCrossSite(req);
  if (blocked) return blocked;
  const { ids, action } = (await req.json()) as { ids: string[]; action: string };
  switch (action) {
    case "select":
    case "deselect":
      jobsRepo.setSelected(ids, action === "select");
      break;
    case "skip":
    case "hide":
      jobsRepo.setStatus(ids, action === "skip" ? "skipped" : "hidden");
      jobsRepo.setSelected(ids, false);
      break;
    case "applied":
      // Applied outside the app (LinkedIn, email, ...): record it so the job moves to the Applied tab.
      applicationsRepo.markApplied(ids, tryConfig().config?.tracker.followUpDays ?? 7);
      break;
    case "restore":
      jobsRepo.setStatus(ids, "scored");
      break;
    default:
      return json({ error: `Unknown action ${action}` }, 400);
  }
  return json({ ok: true });
}
