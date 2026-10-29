"use client";

// Where an open thread's data comes from and where its actions go, so the desktop and weft.zip draw the same
// ThreadPanel, ThreadView and ReplyBox. The desktop's is the default: the local server's thread route, its live event
// stream and its card routes. The web board provides one over Supabase (components/web-board/useCloudTransport.ts):
// synced rows, Realtime and commands the Mac runs. An action a transport leaves out is one its views don't offer
// (a "!" command, ↑ edit, folder grants, Wait), the way ToolResultSourceContext swaps where a long tool output comes from.
import { createContext, useContext } from "react";
import { apiFetch } from "./api-client";
import { api } from "./client";
import { firstNow, otherFirstNow, stopNow, waitNow } from "./optimistic-cards";
import { filesApi } from "./client-files";
import { THREAD_PAGE_SIZE } from "./cloud-sync-types";
import { applyThreadEvent, type ThreadPage } from "./thread-page";
import type { BoardEvent, ThreadItem } from "./types";
import { useBoardEvents } from "./use-events";

// A change to the loaded window, applied to whatever it holds when it lands.
export type PageUpdate = (prev: ThreadPage) => ThreadPage;

export interface ThreadTransport {
  // One page of the thread: the newest (before omitted) or the one ending at index `before`. Null when it can't be read.
  loadPage(cardId: string, before?: number): Promise<ThreadPage | null>;
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
  // Send later, the review panel and the copilot's starters: the desktop board's own.
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

function useLocalLive(cardId: string, onUpdate: (update: PageUpdate) => void, onReconnect: () => void) {
  useBoardEvents((event: BoardEvent) => {
    if (event.type === "thread_cleared" && event.cardId === cardId) onUpdate(() => ({ items: [], start: 0, total: 0 }));
    if (event.type === "thread" && event.cardId === cardId) onUpdate((prev) => applyThreadEvent(prev, event));
  }, onReconnect);
}

const same = (items: ThreadItem[]) => items;

export const localTransport: ThreadTransport = {
  loadPage: localPage,
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
  desktop: true,
};

export const ThreadTransportContext = createContext<ThreadTransport>(localTransport);

export const useThreadTransport = () => useContext(ThreadTransportContext);
