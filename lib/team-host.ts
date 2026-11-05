"use client";

// The host of a teammate's card on your desktop board (lib/team-board.ts): read-only, on purpose. A teammate's Mac runs
// only the commands its own account makes (cloud_commands RLS: private.owns_device; the inbox: created_by === uid), so
// nothing on this board may act on their card. The thread pages in from the team's cloud rows through this Mac's server
// (/api/team-board), polled like a worker card's; every verb refuses; the menu only opens it. lib/project-host.ts
// hostOf gives a card marked Card.team this host, so no call site asks whose card it is.
import type { ThreadPage } from "@weft/client";
import { mergePage } from "@weft/client";
import { useEffect, useRef } from "react";
import { apiFetch } from "./api-client";
import type { ProjectHost } from "./project-host";
import type { PageUpdate, ThreadTransport } from "./thread-transport";
import type { TeamMark } from "./types";
import { teamMacLabel } from "./team-board-types";
import { startThreadPoll } from "./worker-poll";
import { useWorkerView } from "./worker-blob-view";
import type { FilesSource } from "./files-source";
import type { ToolResultSource } from "./use-tool-result";

// What a refused act says.
export const READ_ONLY = "That's a teammate's thread: it runs on their Mac, and only they can act on it.";
const refuse = () => Promise.reject(new Error(READ_ONLY));

const query = (org: string, cardId: string, extra: Record<string, string> = {}) => new URLSearchParams({ org, card: cardId, ...extra }).toString();

export async function loadTeamPage(org: string, cardId: string, before?: number, after?: number): Promise<ThreadPage | null> {
  const extra: Record<string, string> = {};
  if (before !== undefined) extra.before = String(before);
  if (after !== undefined) extra.after = String(after);
  try {
    const res = await apiFetch(`/api/team-board?${query(org, cardId, extra)}`);
    return res.ok ? ((await res.json()) as ThreadPage) : null;
  } catch {
    return null;
  }
}

// The open thread's newest items, every couple of seconds while its card runs (lib/worker-poll.ts).
function useTeamLive(org: string, cardId: string, onUpdate: (update: PageUpdate) => void) {
  const update = useRef(onUpdate);
  useEffect(() => {
    update.current = onUpdate;
  });
  useEffect(() => startThreadPoll({ cardId, fetchPage: (after) => loadTeamPage(org, cardId, undefined, after), apply: (page) => update.current((prev) => mergePage(prev, page)) }), [org, cardId]);
}

export function teamTransport(org: string): ThreadTransport {
  return {
    loadPage: (cardId, before) => loadTeamPage(org, cardId, before),
    useLive: (cardId, onUpdate) => useTeamLive(org, cardId, onUpdate),
    // The show rail reads what the view drew (lib/worker-shown.ts), as for a worker's card.
    useView: useWorkerView,
    stop: refuse,
    desktop: false,
  };
}

export const teamToolSource = (org: string): ToolResultSource => (cardId, toolId) =>
  apiFetch(`/api/team-board?${query(org, cardId, { tool: toolId })}`)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
    .then((data: { result: string }) => data.result);

// The editor never opens a teammate's files (can("files") is false); a stray read refuses rather than reach this Mac's.
const NO_FILES: FilesSource = { read: refuse, stat: refuse, head: refuse, list: refuse, write: refuse, live: false };

const hosts = new Map<string, ProjectHost>();

// One host per team workspace, so an open card's transport stays the same object across board reads.
export function teamHostOf(mark: Pick<TeamMark, "org">): ProjectHost {
  let host = hosts.get(mark.org);
  if (!host) {
    host = {
      kind: "cloud",
      thread: teamTransport(mark.org),
      tools: teamToolSource(mark.org),
      can: () => false,
      read: () => Promise.resolve(null),
      files: NO_FILES,
      act: refuse,
      menu: (items) => items.filter((item) => "id" in item && item.id === "open"),
      warm: () => {},
    };
    hosts.set(mark.org, host);
  }
  return host;
}

// Where the tile says a teammate's card runs: "Zulker's Mac".
export const teamPlace = (mark: TeamMark) => teamMacLabel(mark);
