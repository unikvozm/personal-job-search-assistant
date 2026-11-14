import type { Browser } from "playwright";

let shared: Browser | null = null;

/** Launches Chromium, with a clear message when the browser binary isn't installed yet. */
export async function launch(headless = true): Promise<Browser> {
  const { chromium } = await import("playwright");
  try {
    return await chromium.launch({ headless });
  } catch (e) {
    if (/Executable doesn't exist|playwright install/i.test((e as Error).message)) {
      throw new Error("Playwright's Chromium is not installed. Run: pnpm exec playwright install chromium");
    }
    throw e;
  }
}

/** One headless browser reused across a run (question scans, PDF rendering). */
export async function sharedBrowser(): Promise<Browser> {
  if (!shared || !shared.isConnected()) shared = await launch(true);
  return shared;
}

export async function closeSharedBrowser(): Promise<void> {
  await shared?.close();
  shared = null;
}
