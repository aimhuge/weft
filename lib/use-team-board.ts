"use client";

// Your teammates' cards for the projects you've checked out here (lib/team-board.ts), read through this Mac's server:
// every few seconds while the board is on screen and there are some, once a minute otherwise. A changed-cards read
// (since=) lays over the last one, with a whole read every few minutes as a safety net, as the worker board does
// (lib/use-worker-board.ts). They stay in this hook's state, never in the board's cards or the local store.
import { useEffect, useState } from "react";
import { apiFetch } from "./api-client";
import { EMPTY_TEAM_BOARD, mergeTeamBoard, type TeamBoard } from "./team-board-types";
import { FULL_READ_EVERY_MS } from "./worker-board-merge";

export const TEAM_POLL_MS = 5_000;
export const TEAM_IDLE_POLL_MS = 60_000;

// What the hook hands back: the last good read, plus why the latest one failed (cleared by the next good one), so a
// 401 or a 500 says so instead of teammates' cards just never showing up.
export type TeamBoardState = TeamBoard & { error?: string };

// A read's answer, or why it failed: the server's own `error` when it sent one, else the status or the thrown message.
export async function loadTeamBoard(since?: string): Promise<{ board: TeamBoard } | { error: string }> {
  try {
    const res = await apiFetch(since ? `/api/team-board?${new URLSearchParams({ since }).toString()}` : "/api/team-board");
    if (res.ok) return { board: (await res.json()) as TeamBoard };
    const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
    const why = typeof body?.error === "string" && body.error ? body.error : res.statusText || "failed";
    return { error: `${res.status} ${why}` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// How long until the next read: fast while there's something to watch and the board is on screen.
export const teamPollDelay = (board: TeamBoard, hidden: boolean) => (board.cards.length && !hidden ? TEAM_POLL_MS : TEAM_IDLE_POLL_MS);

export function useTeamBoard(): TeamBoardState {
  const [board, setBoard] = useState<TeamBoardState>(EMPTY_TEAM_BOARD);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let raw: TeamBoard = EMPTY_TEAM_BOARD;
    let wholeAt = 0;
    const tick = async () => {
      clearTimeout(timer);
      const since = raw.asOf && Date.now() - wholeAt < FULL_READ_EVERY_MS ? raw.asOf : undefined;
      const next = await loadTeamBoard(since);
      if (!alive) return;
      // A failed read keeps what's drawn, so a blip doesn't empty the project, and says why (unchanged: no re-render).
      if ("board" in next) {
        if (!next.board.delta) wholeAt = Date.now();
        raw = mergeTeamBoard(raw, next.board);
        setBoard(raw);
      } else {
        const error = next.error;
        setBoard((b) => (b.error === error ? b : { ...raw, error }));
      }
      timer = setTimeout(() => void tick(), teamPollDelay(raw, document.hidden));
    };
    // Back on screen: read now rather than wait out the idle minute.
    const onVisible = () => {
      if (!document.hidden) void tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    void tick();
    return () => {
      alive = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return board;
}
