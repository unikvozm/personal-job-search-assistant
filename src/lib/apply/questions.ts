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
  // tsx/esbuild wraps named functions in a __name() helper that doesn't exist inside the page.
  await page.evaluate("window.__name = (f) => f");
  return page.evaluate(() => {
    const out: { id: string; label: string; required: boolean; type: string; options?: string[] }[] = [];
    const seen = new Set<string>();
    const seenGroups = new Set<Element>();
    // Question wrappers used by Lever, Ashby and generic forms - looked up before plain <li>,
    // because radio options often sit in their own <li> inside the question.
    const QUESTION = ".application-question, fieldset, [role=radiogroup], [role=group], [class*=question], [class*=fieldEntry], [class*=field-entry]";
    const HEADING = "legend, .application-label, [class*=label]:not(input):not(label), [class*=title]";
    const firstLine = (s: string | null | undefined) => (s ?? "").split("\n").map((l) => l.trim()).find(Boolean) ?? "";
    const clean = (s: string) => s.replace(/[✱*]/g, "").replace(/\s+/g, " ").trim();
    const isRequired = (el: Element, raw: string) =>
      (el as HTMLInputElement).required || el.getAttribute("aria-required") === "true" || /[✱*]/.test(raw);

    const controls = document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
      "input:not([type=hidden]):not([type=submit]):not([type=button]), textarea, select",
    );
    controls.forEach((el, i) => {
      const container = el.closest(QUESTION) ?? el.closest("li, [class*=field]");
      const heading = firstLine((container?.querySelector(HEADING) as HTMLElement | null)?.innerText);

      if (el.type === "radio" || el.type === "checkbox") {
        // One entry per group: by container when it holds several options (Ashby gives each
        // checkbox its own name), otherwise by the shared name.
        const siblings = container ? [...container.querySelectorAll<HTMLInputElement>(`input[type=${el.type}]`)] : [];
        const group = siblings.length > 1 ? container : null;
        if ((group && seenGroups.has(group)) || (!group && el.name && seen.has(el.name))) return;
        if (group) seenGroups.add(group);
        if (el.name) seen.add(el.name);
        const members = group
          ? siblings
          : el.name
            ? [...document.querySelectorAll<HTMLInputElement>(`input[name="${CSS.escape(el.name)}"]`)]
            : [el];
        const raw = heading || firstLine(el.labels?.[0]?.innerText);
        if (!raw) return;
        out.push({
          id: el.name || el.id || `group-${i}`,
          label: clean(raw),
          required: members.some((m) => m.required) || isRequired(container ?? el, heading),
          type: el.type === "radio" ? "select" : "multiselect",
          options: members.map((o) => clean(firstLine(o.labels?.[0]?.innerText) || o.value)),
        });
        return;
      }

      const raw = firstLine(el.labels?.[0]?.innerText) || el.getAttribute("aria-label") || heading || el.getAttribute("placeholder") || "";
      const label = clean(raw);
      const key = el.name || el.id || `${label}-${i}`;
      if (!label || seen.has(key)) return;
      seen.add(key);
      const type = el.tagName === "TEXTAREA" ? "textarea" : el.tagName === "SELECT" ? "select" : el.type === "file" ? "file" : "text";
      const options = el.tagName === "SELECT" ? [...(el as HTMLSelectElement).options].map((o) => o.text.trim()).filter(Boolean) : undefined;
      out.push({ id: key, label, required: isRequired(el, raw), type, options });
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
