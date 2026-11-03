"use client";

// The thread transport (lib/thread-transport.ts) for a worker's card on the desktop board: the same ThreadPanel,
// ThreadView and ReplyBox as weft.zip, over this Mac's own server (app/api/worker-board), because the account's
// Supabase session lives there and not in the renderer. It has no Realtime, so an open thread re-reads its newest
// page every couple of seconds. Like the web's, it leaves out what only the machine running the card can do.
import { useEffect, useRef } from "react";
import { mergePage, SHELL_ELSEWHERE } from "@weft/client";
import { apiFetch } from "./api-client";
import { api } from "./client";
import type { HostArgs } from "./host-command";
import { firstNow, otherFirstNow, stopNow, waitNow } from "./optimistic-cards";
import type { ThreadPage } from "./thread-page";
import type { Device } from "./simulator-devices";
import type { PageUpdate, ThreadTransport } from "./thread-transport";
import { skillCache } from "./skills-wire";
import { canSignWiden } from "./widen-signer";
import type { ToolResultSource } from "./use-tool-result";
import { actOnWorker, askWorker, postWorkerAction } from "./worker-acts";
import { workerFiles } from "./worker-files";
import { startThreadPoll } from "./worker-poll";
import { useWorkerView } from "./worker-blob-view";
import type { FindMatch } from "./thread-find";

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

// The newest page laid over what's loaded lives in @weft/client, with the transport's shape.
export { mergePage };

// ⌘F over the card's whole thread, the rows read and matched on this Mac's server (lib/worker-thread-reads.ts).
export async function searchWorkerThread(cardId: string, query: string): Promise<FindMatch[] | null> {
  try {
    const res = await apiFetch(`/api/worker-board?${new URLSearchParams({ card: cardId, q: query }).toString()}`);
    return res.ok ? ((await res.json()) as { matches: FindMatch[] }).matches : null;
  } catch {
    return null;
  }
}

// Polls the open thread (lib/worker-poll.ts); poll false stops it while a session line pushes the items (lib/line-host.ts).
export function useWorkerLive(cardId: string, onUpdate: (update: PageUpdate) => void, poll = true) {
  const update = useRef(onUpdate);
  useEffect(() => {
    update.current = onUpdate;
  });
  // Off while a session line pushes the items instead (lib/line-host.ts).
  useEffect(
    () => (poll ? startThreadPoll({ cardId, fetchPage: (after) => loadPage(cardId, undefined, after), apply: (page) => update.current((prev) => mergePage(prev, page)) }) : undefined),
    [cardId, poll],
  );
}

// The "/" list of a worker's card, as its worker finds it for the card's checkout (kept a few minutes per card).
const skillLists = skillCache((cardId) => askWorker("skills.list", { id: cardId }));
export const workerSkills = (cardId: string | undefined, now?: number) => skillLists.get(cardId, now);
// For tests: forget the lists.
export const forgetWorkerSkills = () => skillLists.forget();

// What a worker runs from a board, as host verbs (lib/host-api). `shell` and `grantFolder` widen what the card can
// touch, so a worker runs them only with a signed approval: offered where this Mac can sign one (the desktop app,
// lib/widen-signer.ts), and the act asks Touch ID first. A grant reaches only this card (Always is this Mac's own list);
// one still rides inside an answer (grantInAnswer). `listFiles` is the files.list verb (H4), so file names in the
// thread link to the editor.
const pending = (cardId: string, pendingId: string): HostArgs => ({ id: cardId, pendingId });

const signedVerbs = (act: typeof actOnWorker): Pick<ThreadTransport, "shell" | "grantFolder"> => ({
  shell: (cardId, command) => act("card.shell", { id: cardId, command }).then(() => {}),
  grantFolder: (cardId, directory) => act("card.update", { id: cardId, body: { readScope: directory } }).then(() => {}),
});

// Where the board can't sign, a "!" says so in the box instead of reaching the agent (@weft/client).
export { SHELL_ELSEWHERE };

// A worker's transport over a route: the relay's commands and poll (workerTransport), or a session line that falls
// back to them (lib/line-host.ts).
export function workerTransportVia(act: typeof actOnWorker, useLive: ThreadTransport["useLive"], files = workerFiles): ThreadTransport {
  return {
    loadPage,
    searchThread: searchWorkerThread,
    useLive,
    // Pictures drawn from their signed URLs (lib/worker-blob-view.ts); the items as they came are the show rail's too,
    // since the rail sits outside the thread view (lib/worker-shown.ts).
    useView: useWorkerView,
    // The tile and the menu stop a worker card with the same verb (lib/card-handlers-host.ts).
    stop: (cardId) => stopNow(cardId, () => act("card.stop", { id: cardId })),
    editLast: (cardId, text) => act("card.message.edit", { id: cardId, text }).then(() => {}),
    fresh: (cardId, message) => act("card.fresh", { id: cardId, message }).then(() => {}),
    waitPermission: (cardId, pendingId) => waitNow(cardId, pendingId, () => act("card.permission.wait", pending(cardId, pendingId))),
    putFirst: (cardId, pendingId) => firstNow(cardId, pendingId, () => act("card.permission.first", pending(cardId, pendingId))),
    putHolderFirst: (cardId, pendingId) => otherFirstNow(cardId, pendingId, () => act("card.permission.otherFirst", pending(cardId, pendingId))),
    stopTask: (cardId, taskId) => act("card.stopTask", { id: cardId, taskId }).then(() => {}),
    listSkills: (cardId) => workerSkills(cardId),
    // The worker holds the timer, so a scheduled message goes even while this Mac sleeps. The text's pasted files
    // travel with it, as a reply's do (lib/worker-board.ts).
    schedule: (cardId, text, at) => act("card.schedule", { id: cardId, text, at }),
    unschedule: (cardId, messageId) => act("card.unschedule", { id: cardId, messageId }),
    // Saved on this Mac, as for a local card: the file goes up to the worker with the message that pastes it.
    upload: (file, name, onProgress) => api.uploadAttachment(file, name, onProgress),
    // files.list (H4), so file names in the thread link to the editor.
    listFiles: (cardId) => files.list(cardId),
    // A "!" and a folder grant run with a signed approval where the board can sign one (lib/widen-signer.ts); elsewhere
    // remoteRefusal refuses card.shell from the network, so a "!" says so in the box instead of reaching the agent.
    ...(canSignWiden() ? signedVerbs(act) : {}),
    signsSkip: canSignWiden(),
    shellRefusal: SHELL_ELSEWHERE,
    grantInAnswer: true,
    cardEdits: true,
    desktop: false,
  };
}

export const workerTransport: ThreadTransport = workerTransportVia(actOnWorker, (cardId, onUpdate) => useWorkerLive(cardId, onUpdate));

export const workerToolSource: ToolResultSource = (cardId, toolId) =>
  apiFetch(`/api/worker-board?${new URLSearchParams({ card: cardId, tool: toolId }).toString()}`)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
    .then((data: { result: string }) => data.result);
