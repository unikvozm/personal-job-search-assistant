import fs from "node:fs";
import { marked } from "marked";
import { sharedBrowser } from "../apply/browser";

/** Single-column, no tables/columns/icons: parses cleanly in every ATS. */
const CSS = `
  @page { size: A4; margin: 16mm 18mm; }
  body { font-family: "Helvetica Neue", Arial, sans-serif; font-size: 10.5pt; line-height: 1.4; color: #111; }
  h1 { font-size: 20pt; margin: 0 0 2pt; }
  h1 + p { margin: 0 0 10pt; color: #333; }
  h2 { font-size: 12pt; text-transform: uppercase; letter-spacing: .04em; border-bottom: 1px solid #999; padding-bottom: 2pt; margin: 14pt 0 6pt; }
  h3 { font-size: 11pt; margin: 8pt 0 0; }
  h3 + p { margin: 0 0 3pt; color: #444; font-style: italic; }
  ul { margin: 2pt 0 6pt; padding-left: 14pt; }
  li { margin: 1pt 0; }
  p { margin: 3pt 0; }
  a { color: inherit; text-decoration: none; }
`;

export const stripHookMarkers = (md: string) => md.replace(/<!--\s*\/?hook\s*-->/g, "");

export function resumeHtml(markdown: string, title: string): string {
  const body = marked.parse(stripHookMarkers(markdown), { async: false });
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><style>${CSS}</style></head><body>${body}</body></html>`;
}

export async function renderPdf(markdown: string, title: string, outFile: string): Promise<void> {
  const browser = await sharedBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(resumeHtml(markdown, title), { waitUntil: "load" });
    fs.writeFileSync(outFile, await page.pdf({ format: "A4", printBackground: false }));
  } finally {
    await page.close();
  }
}

/** Numbers (45%, 2021, 30+) in the tailored CV that the original doesn't contain → likely invented. */
export function newNumbers(original: string, tailored: string): string[] {
  const nums = (s: string) => new Set(s.match(/\d+(?:[.,]\d+)?\s*%?\+?/g)?.map((n) => n.replace(/\s/g, "")) ?? []);
  const known = nums(original);
  return [...nums(tailored)].filter((n) => !known.has(n));
}

export function hookOf(markdown: string): string | null {
  return markdown.match(/<!--\s*hook\s*-->([\s\S]*?)<!--\s*\/hook\s*-->/)?.[1]?.trim() ?? null;
}
