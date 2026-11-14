import { APPLIED_STATUSES, applicationsRepo, jobsRepo, now, type Application } from "@/lib/db";
import { json, startCli, tryConfig, rejectCrossSite } from "@/lib/server";

export const dynamic = "force-dynamic";

type Body =
  | { action: "approve" }
  | { action: "skip" }
  | { action: "markSubmitted" }
  | { action: "update"; patch: Partial<Pick<Application, "status" | "answers" | "notes" | "followUpAt" | "interviewAt">> };

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const blocked = rejectCrossSite(req);
  if (blocked) return blocked;
  const id = Number((await ctx.params).id);
  const app = applicationsRepo.get(id);
  if (!app) return json({ error: "Not found" }, 404);
  const body = (await req.json()) as Body;
  const { config } = tryConfig();
  const followUpDays = config?.tracker.followUpDays ?? 7;

  switch (body.action) {
    case "approve":
      // Your per-application yes: submits in a visible browser on this machine.
      if (app.status !== "prefilled") return json({ error: "Only prefilled applications can be auto-submitted" }, 400);
      applicationsRepo.update(id, { status: "approved", approvedAt: now() });
      startCli(["submit", String(id)]);
      break;
    case "markSubmitted": {
      // Manual forms: you submitted it yourself; record it.
      const at = now();
      applicationsRepo.update(id, {
        status: "submitted",
        approvedAt: app.approvedAt ?? at,
        submittedAt: at,
        followUpAt: new Date(Date.now() + followUpDays * 86_400_000).toISOString(),
      });
      jobsRepo.setStatus([app.jobId], "applied");
      break;
    }
    case "skip":
      applicationsRepo.update(id, { status: "skipped" });
      jobsRepo.setStatus([app.jobId], "skipped");
      break;
    case "update": {
      applicationsRepo.update(id, body.patch);
      const status = body.patch.status;
      if (status && (APPLIED_STATUSES as readonly string[]).includes(status)) {
        // Keep the job on the Applied tab and give it a submission date if it had none.
        jobsRepo.setStatus([app.jobId], "applied");
        if (!app.submittedAt) applicationsRepo.update(id, { submittedAt: now(), followUpAt: new Date(Date.now() + followUpDays * 86_400_000).toISOString() });
      }
      break;
    }
    default:
      return json({ error: "Unknown action" }, 400);
  }
  return json({ ok: true });
}
