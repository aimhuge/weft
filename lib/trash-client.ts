import { apiFetch } from "./api-client";
import type { Card } from "./types";

// The board's calls to /api/trash (docs/architecture/card-trash.md): the Done column's Recently deleted list and its
// Restore buttons. Type-only for the server side, so a browser chunk never resolves lib/card-trash.ts (node:fs).

/** One deleted card as the list shows it. */
export interface TrashItem {
  id: string;
  title: string;
  cwd: string;
  deletedAt: number;
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(url, init);
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `${url} answered ${res.status}`);
  return data;
}

export const trashApi = {
  list: () => call<{ items: TrashItem[] }>("/api/trash").then((d) => d.items),
  restore: (id: string) => call<{ card: Card }>(`/api/trash/${encodeURIComponent(id)}`, { method: "POST" }).then((d) => d.card),
};
