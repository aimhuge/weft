"use client";

// The thread transport (lib/thread-transport.ts) for a worker's card on the desktop board: the same ThreadPanel,
// ThreadView and ReplyBox as weft.zip, over this Mac's own server (app/api/worker-board), because the account's
// Supabase session lives there and not in the renderer. It has no Realtime, so an open thread re-reads its newest
// page every couple of seconds. Like the web's, it leaves out what only the machine running the card can do.
import { useEffect, useRef } from "react";
import { apiFetch } from "./api-client";
import { api } from "./client";
import type { HostArgs } from "./host-command";
import { firstNow, otherFirstNow, stopNow, waitNow } from "./optimistic-cards";
import { applyThreadEvent, type ThreadPage } from "./thread-page";
import type { Device } from "./simulator-devices";
import type { PageUpdate, ThreadTransport } from "./thread-transport";
import { skillCache } from "./skills-wire";
import type { ToolResultSource } from "./use-tool-result";
import { actOnWorker, askWorker, postWorkerAction } from "./worker-acts";
import { startThreadPoll } from "./worker-poll";
import { useShownItems } from "./worker-shown";

export { THREAD_POLL_MS } from "./worker-poll";

export const sendWorkerAction = postWorkerAction;
export { actOnWorker };

export interface QaState {
  devices: Device[];
  mac: string;
  approved: string | null;
}

// What the Local Simulator switch shows for a card (lib/qa-switch.ts).
export async function readQa(cardId: string): Promise<QaState> {
  const res = await apiFetch(`/api/worker-board?${new URLSearchParams({ devices: "1", card: cardId }).toString()}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as QaState;
}

async function loadPage(cardId: string, before?: number, after?: number): Promise<ThreadPage | null> {
  const params = new URLSearchParams({ card: cardId });
  if (before !== undefined) params.set("before", String(before));
  // Only the items past this seq (lib/worker-poll.ts); the answer's total still says how long the thread is.
  if (after !== undefined) params.set("after", String(after));
  try {
    const res = await apiFetch(`/api/worker-board?${params.toString()}`);
    return res.ok ? ((await res.json()) as ThreadPage) : null;
  } catch {
    return null;
  }
}

// The newest page laid over what's loaded. A thread that got shorter was rewound on the worker: the page replaces it,
// and so does one that starts past the end of the window (more arrived between polls than a page holds).
export function mergePage(prev: ThreadPage, page: ThreadPage): ThreadPage {
  if (page.total < prev.total || (page.items.length && page.start > prev.start + prev.items.length)) return page;
  return page.items.reduce((next, item, i) => applyThreadEvent(next, { index: page.start + i, item }), prev);
}

function useWorkerLive(cardId: string, onUpdate: (update: PageUpdate) => void) {
  const update = useRef(onUpdate);
  useEffect(() => {
    update.current = onUpdate;
  });
  useEffect(
    () => startThreadPoll({ cardId, fetchPage: (after) => loadPage(cardId, undefined, after), apply: (page) => update.current((prev) => mergePage(prev, page)) }),
    [cardId],
  );
}

// The "/" list of a worker's card, as its worker finds it for the card's checkout (kept a few minutes per card).
const skillLists = skillCache((cardId) => askWorker("skills.list", { id: cardId }));
export const workerSkills = (cardId: string | undefined, now?: number) => skillLists.get(cardId, now);
// For tests: forget the lists.
export const forgetWorkerSkills = () => skillLists.forget();

// What a worker runs from a board, as host verbs (lib/host-api). Left out on purpose: `shell` and `grantFolder`, which
// remoteRefusal (lib/host-command.ts) refuses from the network because they widen what the card can touch (a folder
// grant still rides inside an answer: grantInAnswer), and `listFiles`, which waits for file verbs (project-hosts.md H4).
const pending = (cardId: string, pendingId: string): HostArgs => ({ id: cardId, pendingId });

export const workerTransport: ThreadTransport = {
  loadPage,
  useLive: (cardId, onUpdate) => useWorkerLive(cardId, onUpdate),
  // The items as drawn are the show rail's too: the rail sits outside the thread view (lib/worker-shown.ts).
  useView: useShownItems,
  // The tile and the menu stop a worker card with the same verb (lib/card-handlers-host.ts).
  stop: (cardId) => stopNow(cardId, () => actOnWorker("card.stop", { id: cardId })),
  editLast: (cardId, text) => actOnWorker("card.message.edit", { id: cardId, text }).then(() => {}),
  fresh: (cardId, message) => actOnWorker("card.fresh", { id: cardId, message }).then(() => {}),
  waitPermission: (cardId, pendingId) => waitNow(cardId, pendingId, () => actOnWorker("card.permission.wait", pending(cardId, pendingId))),
  putFirst: (cardId, pendingId) => firstNow(cardId, pendingId, () => actOnWorker("card.permission.first", pending(cardId, pendingId))),
  putHolderFirst: (cardId, pendingId) => otherFirstNow(cardId, pendingId, () => actOnWorker("card.permission.otherFirst", pending(cardId, pendingId))),
  stopTask: (cardId, taskId) => actOnWorker("card.stopTask", { id: cardId, taskId }).then(() => {}),
  listSkills: (cardId) => workerSkills(cardId),
  // The worker holds the timer, so a scheduled message goes even while this Mac sleeps. The text's pasted files
  // travel with it, as a reply's do (lib/worker-board.ts).
  schedule: (cardId, text, at) => actOnWorker("card.schedule", { id: cardId, text, at }),
  unschedule: (cardId, messageId) => actOnWorker("card.unschedule", { id: cardId, messageId }),
  // Saved on this Mac, as for a local card: the file goes up to the worker with the message that pastes it.
  upload: (file, name, onProgress) => api.uploadAttachment(file, name, onProgress),
  grantInAnswer: true,
  cardEdits: true,
  desktop: false,
};

export const workerToolSource: ToolResultSource = (cardId, toolId) =>
  apiFetch(`/api/worker-board?${new URLSearchParams({ card: cardId, tool: toolId }).toString()}`)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
    .then((data: { result: string }) => data.result);
