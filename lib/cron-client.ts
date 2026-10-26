import { apiFetch } from "./api-client";
import type { Card } from "./types";
import type { Cron, CronInput, CronPatch } from "./cron-types";

// The board's calls to /api/crons (docs/architecture/crons.md), each throwing the route's error for the UI to show.

async function call<T>(url: string, method = "GET", body?: unknown): Promise<T> {
  const res = await apiFetch(url, {
    method,
    ...(body !== undefined ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? res.statusText);
  return data;
}

export const cronApi = {
  list: () => call<{ crons: Cron[] }>("/api/crons").then((d) => d.crons),
  create: (input: CronInput) => call<{ cron: Cron }>("/api/crons", "POST", input).then((d) => d.cron),
  update: (id: string, patch: CronPatch) => call<{ cron: Cron }>(`/api/crons/${id}`, "PATCH", patch).then((d) => d.cron),
  remove: (id: string) => call<{ ok: true }>(`/api/crons/${id}`, "DELETE").then(() => undefined),
  run: (id: string) => call<{ card: Card }>(`/api/crons/${id}/run`, "POST").then((d) => d.card),
};
