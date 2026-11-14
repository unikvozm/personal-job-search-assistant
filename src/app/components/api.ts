"use client";

/** POST helper for the app's own API; throws with the server's error message. */
export async function post<T = { ok: true }>(url: string, body: unknown = {}): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

export const fileUrl = (absolutePath: string) => `/api/files?path=${encodeURIComponent(absolutePath)}`;
