"use client";

// Where an open thread's data comes from and where its actions go, so the desktop and weft.zip draw the same
// ThreadPanel, ThreadView and ReplyBox. The desktop's is the default: the local server's thread route, its live event
// stream and its card routes. The web board provides one over Supabase (components/web-board/useCloudTransport.ts):
// synced rows, Realtime and commands the Mac runs. An action a transport leaves out is one its views don't offer
// (a "!" command, ↑ edit, folder grants, Wait), the way ToolResultSourceContext swaps where a long tool output comes from.
import { createContext, useContext } from "react";
import { apiFetch } from "./api-client";
import type { PageUpdate, ThreadTransport } from "@weft/client";
import { api } from "./client";
import { firstNow, otherFirstNow, stopNow, waitNow } from "./optimistic-cards";
import { filesApi } from "./client-files";
import { THREAD_PAGE_SIZE } from "./cloud-sync-types";
import type { FindMatch } from "./thread-find";
import { applyThreadEvent, type ThreadPage } from "./thread-page";
import type { BoardEvent, ThreadItem } from "./types";
import { useBoardEvents } from "./use-events";

// The transport's shape lives in @weft/client (packages/weft-client/src/transport.ts); this is the desktop's own.
export type { PageUpdate, ThreadTransport };

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
