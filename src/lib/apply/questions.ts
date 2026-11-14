import type { Page } from "playwright";
import { fetchJson } from "../sources/http";
import type { ApplicationQuestion, Job } from "../jobs/types";
import { sharedBrowser } from "./browser";
import { matchStandard } from "./fields";

interface GhField { name: string; type: string; values: { label: string; value: number | string }[] }
interface GhQuestion { label: string; required: boolean; fields: GhField[] }

const GH_TYPES: Record<string, ApplicationQuestion["type"]> = {
  input_text: "text",
  textarea: "textarea",
  input_file: "file",
  multi_value_single_select: "select",
  multi_value_multi_select: "multiselect",
  input_hidden: "unknown",
};

async function greenhouseQuestions(job: Job): Promise<ApplicationQuestion[]> {
  const { board, jobId } = job.atsRef ?? {};
  const d = await fetchJson<{ questions: GhQuestion[]; location_questions?: GhQuestion[]; demographic_questions?: { questions?: GhQuestion[] } }>(
    `https://boards-api.greenhouse.io/v1/boards/${board}/jobs/${jobId}?questions=true`,
  );
  const all = [...d.questions, ...(d.location_questions ?? []), ...(d.demographic_questions?.questions ?? [])];
  return all.flatMap((q) => {
    const field = q.fields[0];
    if (!field || field.type === "input_hidden") return [];
    return [{
      id: field.name,
      label: q.label.replace(/\s+/g, " ").trim(),
      required: q.required,
      type: GH_TYPES[field.type] ?? "unknown",
      options: field.values.map((v) => v.label),
    }];
  });
}

/** Generic form scan for ATSs without a questions API. Runs in the page, returns labelled controls. */
async function scanForm(page: Page): Promise<ApplicationQuestion[]> {
  return page.evaluate(() => {
    const out: { id: string; label: string; required: boolean; type: string; options?: string[] }[] = [];
    const seen = new Set<string>();
    const controls = document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
      "input:not([type=hidden]):not([type=submit]):not([type=button]), textarea, select",
    );
    controls.forEach((el, i) => {
      const labelEl = (el as HTMLInputElement).labels?.[0];
      const container = el.closest("li, fieldset, .application-question, [class*=field], [class*=question]");
      const label = (
        labelEl?.innerText ||
        el.getAttribute("aria-label") ||
        container?.querySelector("label, legend, .application-label, [class*=label]")?.textContent ||
        el.getAttribute("placeholder") ||
        ""
      ).replace(/\s+/g, " ").replace(/\*$/, "").trim();
      const key = el.name || el.id || `${label}-${i}`;
      if (!label || seen.has(key)) return;
      if (el.type === "radio" || el.type === "checkbox") {
        const groupLabel = container?.querySelector("legend, label, [class*=label]")?.textContent?.trim() ?? label;
        if (seen.has(el.name)) return;
        seen.add(el.name);
        const opts = [...document.querySelectorAll<HTMLInputElement>(`input[name="${CSS.escape(el.name)}"]`)].map(
          (o) => o.labels?.[0]?.innerText.trim() ?? o.value,
        );
        out.push({ id: el.name, label: groupLabel, required: el.required, type: el.type === "radio" ? "select" : "multiselect", options: opts });
        return;
      }
      seen.add(key);
      const type = el.tagName === "TEXTAREA" ? "textarea" : el.tagName === "SELECT" ? "select" : el.type === "file" ? "file" : "text";
      const options = el.tagName === "SELECT" ? [...(el as HTMLSelectElement).options].map((o) => o.text.trim()).filter(Boolean) : undefined;
      out.push({
        id: key,
        label,
        required: el.required || el.getAttribute("aria-required") === "true" || /\*\s*$/.test(labelEl?.innerText ?? ""),
        type,
        options,
      });
    });
    return out;
  }) as Promise<ApplicationQuestion[]>;
}

async function pageQuestions(job: Job): Promise<ApplicationQuestion[]> {
  const browser = await sharedBrowser();
  const page = await browser.newPage();
  try {
    await page.goto(job.applyUrl ?? job.url, { waitUntil: "networkidle", timeout: 45_000 });
    return await scanForm(page);
  } finally {
    await page.close();
  }
}

/**
 * Application questions for a job, each tagged with a standardKey when configs.md can answer it.
 * Returns null when the form can't be read (unknown ATS, login wall) - the job then counts as "needs input".
 */
export async function fetchQuestions(job: Job): Promise<ApplicationQuestion[] | null> {
  let questions: ApplicationQuestion[];
  if (job.ats === "greenhouse") questions = await greenhouseQuestions(job);
  else if (job.ats) questions = await pageQuestions(job);
  else return null; // aggregator listing: the real form lives on another site
  if (!questions.length) return null;
  return questions.map((q) => ({ ...q, standardKey: matchStandard(q.label) ?? undefined }));
}
