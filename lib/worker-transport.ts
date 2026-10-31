"use client";

// The thread transport (lib/thread-transport.ts) for a worker's card on the desktop board: the same ThreadPanel,
// ThreadView and ReplyBox as weft.zip, over this Mac's own server (app/api/worker-board), because the account's
// Supabase session lives there and not in the renderer. It has no Realtime, so an open thread re-reads its newest
// page every couple of seconds. Like the web's, it leaves out what only the machine running the card can do.
import { useEffect, useRef } from "react";
import { apiFetch } from "./api-client";
import { applyThreadEvent, type ThreadPage } from "./thread-page";
import type { PageUpdate, ThreadTransport } from "./thread-transport";
import type { ThreadItem } from "./types";
import type { ToolResultSource } from "./use-tool-result";
import type { WorkerAction } from "./worker-board";

export const THREAD_POLL_MS = 2_500;

async function action(body: WorkerAction): Promise<void> {
  const res = await apiFetch("/api/worker-board", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (res.ok) return;
  const failed = (await res.json().catch(() => ({}))) as { error?: string };
  throw new Error(failed.error || `HTTP ${res.status}`);
}

export const sendWorkerAction = action;

async function loadPage(cardId: string, before?: number): Promise<ThreadPage | null> {
  const params = new URLSearchParams({ card: cardId });
  if (before !== undefined) params.set("before", String(before));
  try {
    const res = await apiFetch(`/api/worker-board?${params.toString()}`);
    return res.ok ? ((await res.json()) as ThreadPage) : null;
  } catch {
    return null;
  }
}

// The newest page laid over what's loaded. A thread that got shorter was rewound on the worker: the page replaces it.
export function mergePage(prev: ThreadPage, page: ThreadPage): ThreadPage {
  if (page.total < prev.total) return page;
  return page.items.reduce((next, item, i) => applyThreadEvent(next, { index: page.start + i, item }), prev);
}

function useWorkerLive(cardId: string, onUpdate: (update: PageUpdate) => void) {
  const update = useRef(onUpdate);
  useEffect(() => {
    update.current = onUpdate;
  });
  useEffect(() => {
    let inFlight = false;
    const timer = setInterval(() => {
      if (inFlight) return;
      inFlight = true;
      void loadPage(cardId)
        .then((page) => {
          if (page) update.current((prev) => mergePage(prev, page));
        })
        .finally(() => (inFlight = false));
    }, THREAD_POLL_MS);
    return () => clearInterval(timer);
  }, [cardId]);
}

const same = (items: ThreadItem[]) => items;

export const workerTransport: ThreadTransport = {
  loadPage,
  useLive: (cardId, onUpdate) => useWorkerLive(cardId, onUpdate),
  useView: same,
  stop: (cardId) => action({ action: "stop", cardId }),
  grantInAnswer: true,
  desktop: false,
};

export const workerToolSource: ToolResultSource = (cardId, toolId) =>
  apiFetch(`/api/worker-board?${new URLSearchParams({ card: cardId, tool: toolId }).toString()}`)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
    .then((data: { result: string }) => data.result);
