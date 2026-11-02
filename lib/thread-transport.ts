"use client";

// Where an open thread's data comes from and where its actions go, so the desktop and weft.zip draw the same
// ThreadPanel, ThreadView and ReplyBox. The desktop's is the default: the local server's thread route, its live event
// stream and its card routes. The web board provides one over Supabase (components/web-board/useCloudTransport.ts):
// synced rows, Realtime and commands the Mac runs. An action a transport leaves out is one its views don't offer
// (a "!" command, ↑ edit, folder grants, Wait), the way ToolResultSourceContext swaps where a long tool output comes from.
import { createContext, useContext } from "react";
import { apiFetch } from "./api-client";
import { api, type UploadedAttachment } from "./client";
import { firstNow, otherFirstNow, stopNow, waitNow } from "./optimistic-cards";
import { filesApi } from "./client-files";
import { THREAD_PAGE_SIZE } from "./cloud-sync-types";
import type { FindMatch } from "./thread-find";
import { applyThreadEvent, type ThreadPage } from "./thread-page";
import type { BoardEvent, SkillInfo, ThreadItem } from "./types";
import { useBoardEvents } from "./use-events";

// A change to the loaded window, applied to whatever it holds when it lands.
export type PageUpdate = (prev: ThreadPage) => ThreadPage;

export interface ThreadTransport {
  // One page of the thread: the newest (before omitted) or the one ending at index `before`. Null when it can't be read.
  loadPage(cardId: string, before?: number): Promise<ThreadPage | null>;
  // Find over the whole thread, loaded or not (lib/thread-find.ts). Left out, find covers the loaded window.
  searchThread?: (cardId: string, query: string) => Promise<FindMatch[] | null>;
  // A hook: live changes to this card's thread, and a reconnect (when the caller re-reads the newest page).
  useLive(cardId: string, onUpdate: (update: PageUpdate) => void, onReconnect: () => void): void;
  // A hook: the items as they are drawn (the web's blob refs become signed URLs).
  useView(items: ThreadItem[]): ThreadItem[];
  // Interrupt the running turn.
  stop(cardId: string): Promise<void>;
  // Only where the Mac itself runs the card:
  shell?: (cardId: string, command: string) => Promise<void>;
  editLast?: (cardId: string, text: string) => Promise<void>;
  // A cold card's next message in a new session of the same card, started from a brief of the thread.
  fresh?: (cardId: string, message: string) => Promise<void>;
  // An outside-folder prompt's "This card" (and the question form's "Read from"); "always" adds it to every card.
  grantFolder?: (cardId: string, directory: string, scope: "card" | "always") => Promise<void>;
  waitPermission?: (cardId: string, pendingId: string) => Promise<void>;
  // This first on a held edit: it goes ahead and the card holding the code yields the file (lib/precedence.ts).
  putFirst?: (cardId: string, pendingId: string) => Promise<void>;
  // Others first: the card holding the code goes ahead, and this card waits for it (lib/precedence.ts).
  putHolderFirst?: (cardId: string, pendingId: string) => Promise<void>;
  stopTask?: (cardId: string, taskId: string) => Promise<void>;
  // The card folder's files, so file names in the thread link to the editor column (lib/use-file-index.ts).
  listFiles?: (cardId: string) => Promise<string[]>;
  // The composer's "/" list: the skills of the card's folder on the machine that runs it (the skills.list verb). Off
  // a card (the New thread dialog) there's no cardId, and cwd names the folder. Left out, "/" offers nothing.
  listSkills?: (cardId: string | undefined, cwd: string | undefined) => Promise<SkillInfo[]>;
  // Send later: the machine that runs the card holds the message until its time (card.schedule, card.unschedule).
  schedule?: (cardId: string, text: string, at: number) => Promise<unknown>;
  unschedule?: (cardId: string, messageId: string) => Promise<unknown>;
  // A file pasted or dropped in the composer, saved where the message's text can point at it. Left out, the
  // composer says files can't be attached here.
  upload?: (file: Blob, name: string, onProgress?: (fraction: number) => void) => Promise<UploadedAttachment>;
  // A card on another machine: This card and Always go inside the answer, as one command, and that machine works out
  // the folder from its own pending request. "Read from" on a question has no such command, so it isn't offered.
  grantInAnswer?: boolean;
  // The card's own controls in the thread's header reach its host: rename, tags, star, archive and the model picker
  // (lib/project-host.ts). The desktop's always do; a worker card's do too (lib/worker-transport.ts); weft.zip's don't.
  cardEdits?: boolean;
  // The review panel, the skills chip and the copilot's starters: the desktop board's own.
  desktop: boolean;
}

async function localPage(cardId: string, before?: number): Promise<ThreadPage | null> {
  const params = new URLSearchParams();
  if (before !== undefined) params.set("before", String(before));
  params.set("limit", String(THREAD_PAGE_SIZE));
  try {
    // apiFetch carries x-weft-token: without it lib/guard.ts refuses the read with a 403, and this returns
    // null — an open thread that looks empty rather than one that failed.
    const res = await apiFetch(`/api/cards/${cardId}/thread?${params.toString()}`);
    // A non-JSON body (a restarting dev server's error page) throws at json(); the caller keeps what it has.
    return res.ok ? ((await res.json()) as ThreadPage) : null;
  } catch {
    return null;
  }
}

async function localSearch(cardId: string, query: string): Promise<FindMatch[] | null> {
  try {
    const res = await apiFetch(`/api/cards/${cardId}/thread/search?q=${encodeURIComponent(query)}`);
    return res.ok ? ((await res.json()) as { matches: FindMatch[] }).matches : null;
  } catch {
    return null;
  }
}

function useLocalLive(cardId: string, onUpdate: (update: PageUpdate) => void, onReconnect: () => void) {
  useBoardEvents((event: BoardEvent) => {
    if (event.type === "thread_cleared" && event.cardId === cardId) onUpdate(() => ({ items: [], start: 0, total: 0 }));
    if (event.type === "thread" && event.cardId === cardId) onUpdate((prev) => applyThreadEvent(prev, event));
  }, onReconnect);
}

const same = (items: ThreadItem[]) => items;

export const localTransport: ThreadTransport = {
  loadPage: localPage,
  searchThread: localSearch,
  useLive: useLocalLive,
  useView: same,
  stop: (cardId) => stopNow(cardId),
  shell: (cardId, command) => api.shell(cardId, command).then(() => {}),
  editLast: (cardId, text) => api.editLast(cardId, text).then(() => {}),
  fresh: (cardId, message) => api.fresh(cardId, message).then(() => {}),
  grantFolder: (cardId, directory, scope) => (scope === "always" ? api.allowFolder(directory) : api.setReadScope(cardId, directory)).then(() => {}),
  waitPermission: waitNow,
  putFirst: firstNow,
  putHolderFirst: otherFirstNow,
  stopTask: (cardId, taskId) => api.stopTask(cardId, taskId).then(() => {}),
  listFiles: (cardId) => filesApi.list(cardId),
  // The same /api/skills?cwd= read the composer always made, so a local card's "/" list is unchanged.
  listSkills: (_cardId, cwd) => api.skills(cwd).then((r) => r.skills),
  schedule: (cardId, text, at) => api.schedule(cardId, text, at),
  unschedule: (cardId, messageId) => api.unschedule(cardId, messageId),
  upload: (file, name, onProgress) => api.uploadAttachment(file, name, onProgress),
  cardEdits: true,
  desktop: true,
};

export const ThreadTransportContext = createContext<ThreadTransport>(localTransport);

export const useThreadTransport = () => useContext(ThreadTransportContext);
