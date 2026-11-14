const UA = "personal-job-search-assistant/0.1 (+https://github.com/unikvozm/personal-job-search-assistant)";

export class HttpError extends Error {
  constructor(public status: number, url: string) {
    super(`HTTP ${status} for ${url}`);
  }
}

export async function fetchJson<T>(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "User-Agent": UA, Accept: "application/json", ...init.headers },
    signal: AbortSignal.timeout(init.timeoutMs ?? 20_000),
  });
  if (!res.ok) throw new HttpError(res.status, url);
  return (await res.json()) as T;
}

export async function fetchText(url: string, timeoutMs = 15_000): Promise<{ status: number; url: string; text: string }> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html,*/*" },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { status: res.status, url: res.url, text: await res.text() };
}

/** Runs `fn` over `items` with at most `limit` in flight. */
export async function pMap<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
