import fs from "node:fs";
import { marked } from "marked";
import { sharedBrowser } from "../apply/browser";

/**
 * Resume template: gold + dark grey, single column (parses cleanly in every ATS), one page.
 *
 * Markdown contract (CV.md and every tailored resume):
 *   # Name
 *   **Headline**\            ← gold line under the name
 *   contact · contact · …\   ← grey
 *   **Work authorization** · relocation
 *   ## Summary               ← beige box; <!-- hook -->…<!-- /hook --> renders bold
 *   ## Skills                ← "- **Label:** values" rows, label in gold
 *   ## Experience
 *   ### Company — Role | Dates · Location     ← role in gold, dates right-aligned
 *   *Product / scope line*
 *   - **Outcome phrase:** how, with numbers
 *   ## Education             ← beige box
 */
const CSS = `
  :root { --gold: #c38b2c; --ink: #2b2b2b; --muted: #6f6f6f; --band: #f6f2ea; --scale: 1; }
  @page { margin: 11mm 13mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; color: var(--ink);
         font-size: calc(9.6pt * var(--scale)); line-height: 1.32; }
  h1 { font-size: calc(23pt * var(--scale)); letter-spacing: .01em; text-transform: uppercase; margin: 0; line-height: 1.1; }
  h1::after { content: ""; display: block; width: 46px; height: 3px; background: var(--gold); margin: 3px 0 4px; }
  .header { margin: 0 0 6px; line-height: 1.4; }
  .header strong:first-child { color: var(--gold); font-size: 1.12em; }
  .header .contact { color: var(--muted); font-size: .9em; }
  h2 { background: var(--band); font-size: .98em; text-transform: uppercase; letter-spacing: .12em; font-weight: 700;
       margin: 8px 0 5px; padding: 3px 8px; display: flex; align-items: center; gap: 7px; }
  h2::before { content: ""; width: 7px; height: 7px; background: var(--gold); display: inline-block; }
  p { margin: 2px 0; }
  ul { margin: 2px 0 4px; padding-left: 13px; }
  li { margin: 1px 0; }
  li::marker { color: var(--gold); }
  a { color: inherit; text-decoration: none; }
  .sec-summary .body, .sec-education .body { background: var(--band); padding: 5px 9px; }
  .sec-summary strong.hook { font-weight: 700; }
  .sec-skills ul { list-style: none; padding: 0; }
  .sec-skills li { display: grid; grid-template-columns: 168px 1fr; gap: 8px; margin: 0; }
  .sec-skills li strong { color: var(--gold); }
  .role { display: flex; align-items: baseline; gap: 6px; margin: 6px 0 0; font-weight: 700; }
  .role .title { color: var(--gold); }
  .role .when { margin-left: auto; font-weight: 400; font-style: italic; color: var(--muted); font-size: .9em; white-space: nowrap; }
  .role + p em, .role + p { color: var(--muted); font-style: italic; font-size: .92em; margin: 0; }
`;

const SECTION_CLASS: [RegExp, string][] = [
  [/summary|profile|about/i, "summary"],
  [/skill/i, "skills"],
  [/experience|employment/i, "experience"],
  [/education|certif/i, "education"],
];

/** Markdown → styled HTML body following the contract above. */
export function resumeBody(markdown: string): string {
  // The first hook renders bold; extra variants (only present in the master CV.md) are dropped.
  let seen = false;
  const md = markdown.replace(HOOK, (_, _variant, hook: string) => {
    if (seen) return "";
    seen = true;
    return `<strong class="hook">${hook.trim()}</strong>`;
  });
  let html = marked.parse(md, { async: false });

  // Header: the paragraph right after the name; its second line is the contact line.
  html = html.replace(/(<\/h1>\s*)<p>([\s\S]*?)<\/p>/, (_, h1End: string, inner: string) => {
    const lines = inner.split(/<br\s*\/?>\s*/);
    if (lines.length > 1) lines[1] = `<span class="contact">${lines[1]}</span>`;
    return `${h1End}<div class="header">${lines.join("<br>")}</div>`;
  });

  // Roles: "Company — Role | Dates" → company, gold role, right-aligned dates.
  html = html.replace(/<h3>([\s\S]*?)<\/h3>/g, (_, inner: string) => {
    const [left, when = ""] = inner.split(/\s+\|\s+/);
    const [org, ...title] = left!.split(/\s+—\s+/);
    return `<div class="role"><span class="org">${org}</span>${title.length ? ` — <span class="title">${title.join(" — ")}</span>` : ""}<span class="when">${when}</span></div>`;
  });

  // Wrap each "## Section" so sections can be styled by kind.
  const parts = html.split(/(?=<h2>)/);
  return parts
    .map((part) => {
      const heading = part.match(/^<h2>([\s\S]*?)<\/h2>/);
      if (!heading) return part;
      const kind = SECTION_CLASS.find(([re]) => re.test(heading[1]!))?.[1] ?? "other";
      let body = part.slice(heading[0].length);
      if (kind === "skills") body = body.replace(/<strong>([^<]*?):<\/strong>/g, "<strong>$1</strong>");
      return `<section class="sec-${kind}">${heading[0]}<div class="body">${body}</div></section>`;
    })
    .join("");
}

export function resumeHtml(markdown: string, title: string, scale = 1): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><style>${CSS}</style></head><body style="--scale:${scale}">${resumeBody(markdown)}</body></html>`;
}

export type Paper = "Letter" | "A4";

const PAPER_MM = { Letter: { w: 215.9, h: 279.4 }, A4: { w: 210, h: 297 } };
const MARGIN_MM = { x: 13, y: 11 };
const PX_PER_MM = 96 / 25.4;

export interface RenderResult {
  pages: number;
  scale: number;
}

/**
 * Renders a one-page PDF: measures the content at print width and shrinks the type in small
 * steps (down to 85%) until it fits. Returns the page count so callers can warn when it doesn't.
 */
export async function renderPdf(markdown: string, title: string, outFile: string, paper: Paper = "Letter"): Promise<RenderResult> {
  const browser = await sharedBrowser();
  const size = PAPER_MM[paper];
  const widthPx = (size.w - 2 * MARGIN_MM.x) * PX_PER_MM;
  const heightPx = (size.h - 2 * MARGIN_MM.y) * PX_PER_MM;
  const page = await browser.newPage({ viewport: { width: Math.round(widthPx), height: Math.round(heightPx) } });
  try {
    await page.emulateMedia({ media: "print" });
    let scale = 1;
    let contentHeight = 0;
    for (const s of [1, 0.96, 0.92, 0.89, 0.85]) {
      scale = s;
      await page.setContent(resumeHtml(markdown, title, s), { waitUntil: "load" });
      contentHeight = await page.evaluate(() => document.body.scrollHeight);
      if (contentHeight <= heightPx) break;
    }
    fs.writeFileSync(outFile, await page.pdf({ format: paper, printBackground: true, margin: { top: `${MARGIN_MM.y}mm`, bottom: `${MARGIN_MM.y}mm`, left: `${MARGIN_MM.x}mm`, right: `${MARGIN_MM.x}mm` } }));
    return { pages: Math.max(1, Math.ceil(contentHeight / heightPx)), scale };
  } finally {
    await page.close();
  }
}

/** Letter for US jobs, A4 everywhere else. */
export const paperFor = (countries: string[]): Paper => (countries.includes("US") || countries.length === 0 ? "Letter" : "A4");

/** Numbers (45%, 2021, 30+) in the tailored CV that the original doesn't contain → likely invented. */
export function newNumbers(original: string, tailored: string): string[] {
  const nums = (s: string) => new Set(s.match(/\d+(?:[.,]\d+)?\s*%?\+?/g)?.map((n) => n.replace(/\s/g, "")) ?? []);
  const known = nums(original);
  return [...nums(tailored)].filter((n) => !known.has(n));
}

const HOOK = /<!--\s*hook(?::([\w-]+))?\s*-->([\s\S]*?)<!--\s*\/hook\s*-->/g;

/**
 * Hook sentences in CV.md. One plain `<!-- hook -->…<!-- /hook -->`, or several variants
 * `<!-- hook:devex -->…<!-- /hook -->` that tailoring chooses between (always verbatim).
 */
export function hooksOf(markdown: string): { variant: string | null; text: string }[] {
  return [...markdown.matchAll(HOOK)].map((m) => ({ variant: m[1] ?? null, text: m[2]!.trim() }));
}

export function hookOf(markdown: string): string | null {
  return hooksOf(markdown)[0]?.text ?? null;
}
