import fs from "node:fs";
import path from "node:path";
import type { Locator, Page } from "playwright";
import type { Config } from "../config";
import { applicationsRepo, jobsRepo, now, runsRepo, type Application } from "../db";
import type { ApplicationQuestion, Job } from "../jobs/types";
import { ensureDir, paths } from "../paths";
import { launch, sharedBrowser, closeSharedBrowser } from "./browser";

/** ATSs whose forms we fill automatically; everything else goes to the queue as "open & copy". */
const FILLABLE = new Set(["greenhouse", "lever", "ashby"]);

export function formUrl(job: Job): string {
  if (job.ats === "greenhouse" && job.atsRef) return `https://job-boards.greenhouse.io/${job.atsRef.board}/jobs/${job.atsRef.jobId}`;
  return job.applyUrl ?? job.url;
}

const cssId = (id: string) => id.replace(/([^a-zA-Z0-9_-])/g, "\\$1");

async function first(...locators: Locator[]): Promise<Locator | null> {
  for (const l of locators) if ((await l.count()) > 0) return l.first();
  return null;
}

async function fillQuestion(page: Page, q: ApplicationQuestion, value: string, resumePdf: string): Promise<boolean> {
  const byId = page.locator(`#${cssId(q.id)}, [name="${q.id}"]`);
  const byLabel = page.getByLabel(q.label, { exact: false });
  try {
    if (q.type === "file") {
      if (value !== "__RESUME__") return false;
      const input = await first(page.locator(`input[type=file][id*=resume i], input[type=file][name*=resume i]`), byId, byLabel, page.locator("input[type=file]"));
      await input?.setInputFiles(resumePdf);
      return input != null;
    }
    if (q.type === "select" || q.type === "multiselect") {
      const native = await first(byId.locator("xpath=self::select"), byLabel.locator("xpath=self::select"));
      if (native) {
        await native.selectOption({ label: value });
        return true;
      }
      // Radio / checkbox groups and custom dropdowns (react-select): click, type, pick.
      const option = page.getByLabel(value, { exact: true });
      if ((await option.count()) > 0) {
        await option.first().check();
        return true;
      }
      const combo = await first(byId, byLabel);
      if (!combo) return false;
      await combo.click();
      await page.keyboard.type(value);
      await page.keyboard.press("Enter");
      return true;
    }
    const input = await first(byId, byLabel);
    if (!input) return false;
    await input.fill(value);
    return true;
  } catch {
    return false;
  }
}

/** Fills every answered question; returns labels of required questions that are still empty. */
export async function fillForm(page: Page, job: Job, app: Application): Promise<string[]> {
  const resumePdf = path.join(app.resumeDir ?? "", "resume.pdf");
  const missing: string[] = [];
  // Lever and Ashby show the form only after clicking "Apply".
  const applyButton = page.getByRole("button", { name: /^apply( for this job| now)?$/i }).or(page.getByRole("link", { name: /^apply( for this job| now)?$/i }));
  if ((await applyButton.count()) > 0 && (await page.locator("form input").count()) < 3) {
    await applyButton.first().click().catch(() => {});
    await page.waitForLoadState("networkidle").catch(() => {});
  }
  for (const q of job.questions ?? []) {
    const value = app.answers?.[q.id];
    const ok = value != null && (await fillQuestion(page, q, value, resumePdf));
    if (!ok && q.required) missing.push(q.label);
  }
  return missing;
}

/** Fills the form headlessly without submitting, saves a screenshot for the review queue. */
export async function prefill(config: Config, applicationIds?: number[], log: (m: string) => void = console.log) {
  const apps = applicationIds?.length
    ? applicationIds.map((id) => applicationsRepo.get(id)).filter((a): a is Application => !!a)
    : applicationsRepo.byStatus("ready");
  const run = runsRepo.start("prefill");
  const counts = { prefilled: 0, manual: 0 };
  try {
    const browser = await sharedBrowser();
    for (const app of apps) {
      const job = jobsRepo.get(app.jobId)!;
      if (!job.ats || !FILLABLE.has(job.ats) || !job.questions) {
        applicationsRepo.update(app.id, { status: "needs_manual" });
        counts.manual++;
        log(`  ${job.company}: manual (form on ${new URL(formUrl(job)).hostname})`);
        continue;
      }
      if (!fs.existsSync(path.join(app.resumeDir ?? "", "resume.pdf"))) {
        log(`  ${job.company}: no resume.pdf yet - run prepare first`);
        continue;
      }
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      try {
        await page.goto(formUrl(job), { waitUntil: "networkidle", timeout: 60_000 });
        const missing = await fillForm(page, job, app);
        const shot = path.join(ensureDir(paths.screenshots), `${app.id}.png`);
        await page.screenshot({ path: shot, fullPage: true });
        applicationsRepo.update(app.id, { status: "prefilled", missingFields: missing, screenshot: shot, prefilledAt: now() });
        counts.prefilled++;
        log(`  ${job.company}: prefilled${missing.length ? `, missing: ${missing.join("; ")}` : ""}`);
      } catch (e) {
        applicationsRepo.update(app.id, { status: "needs_manual", notes: `Prefill failed: ${(e as Error).message.split("\n")[0]}` });
        counts.manual++;
      } finally {
        await page.close();
      }
    }
    runsRepo.finish(run.id, counts);
    return counts;
  } catch (e) {
    runsRepo.fail(run.id, (e as Error).message);
    throw e;
  } finally {
    await closeSharedBrowser();
  }
}

const CONFIRMATION = /thank you|application (has been )?(received|submitted)|we.ve received|successfully submitted|danke für deine bewerbung/i;
const CAPTCHA = "iframe[src*='recaptcha'], iframe[src*='hcaptcha'], iframe[src*='turnstile'], .g-recaptcha, .h-captcha";

/**
 * Submits ONE application you approved. Opens a visible browser, fills the form again and clicks submit.
 * If a CAPTCHA or an empty required field is present, it stops and waits for you to finish in that window.
 */
export async function submit(config: Config, applicationId: number, log: (m: string) => void = console.log) {
  const app = applicationsRepo.get(applicationId);
  if (!app || app.status !== "approved") throw new Error(`Application ${applicationId} is not approved`);
  const job = jobsRepo.get(app.jobId)!;
  if (applicationsRepo.submittedDuplicates(job.company, job.title, job.id).length) throw new Error("Already submitted for this company and title");

  const run = runsRepo.start("submit");
  const browser = await launch(false);
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(formUrl(job), { waitUntil: "networkidle", timeout: 60_000 });
    const missing = await fillForm(page, job, app);
    const needsHuman = missing.length > 0 || (await page.locator(CAPTCHA).count()) > 0;
    if (needsHuman) {
      log(`Waiting for you to finish in the browser window${missing.length ? ` (missing: ${missing.join("; ")})` : " (CAPTCHA)"}…`);
    } else {
      const button = page.getByRole("button", { name: /submit( application)?|send application|apply/i }).last();
      await button.click();
    }
    const confirmed = await page
      .waitForFunction((re) => new RegExp(re, "i").test(document.body.innerText), CONFIRMATION.source, { timeout: needsHuman ? 10 * 60_000 : 60_000 })
      .then(() => true)
      .catch(() => false);
    const submittedAt = now();
    const followUpAt = new Date(Date.now() + config.tracker.followUpDays * 86_400_000).toISOString();
    applicationsRepo.update(app.id, {
      status: confirmed ? "submitted" : "submit_unconfirmed",
      submittedAt: confirmed ? submittedAt : null,
      followUpAt: confirmed ? followUpAt : null,
    });
    if (confirmed) jobsRepo.setStatus([job.id], "applied");
    runsRepo.finish(run.id, { confirmed });
    log(confirmed ? `Submitted: ${job.company} — ${job.title}` : "No confirmation seen - check the window and mark it in the tracker.");
    return confirmed;
  } catch (e) {
    runsRepo.fail(run.id, (e as Error).message);
    throw e;
  } finally {
    await browser.close();
  }
}
