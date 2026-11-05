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

async function load(since?: string): Promise<TeamBoard | null> {
  try {
    const res = await apiFetch(since ? `/api/team-board?${new URLSearchParams({ since }).toString()}` : "/api/team-board");
    return res.ok ? ((await res.json()) as TeamBoard) : null;
  } catch {
    return null;
  }
}

// How long until the next read: fast while there's something to watch and the board is on screen.
export const teamPollDelay = (board: TeamBoard, hidden: boolean) => (board.cards.length && !hidden ? TEAM_POLL_MS : TEAM_IDLE_POLL_MS);

export function useTeamBoard(): TeamBoard {
  const [board, setBoard] = useState<TeamBoard>(EMPTY_TEAM_BOARD);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let raw: TeamBoard = EMPTY_TEAM_BOARD;
    let wholeAt = 0;
    const tick = async () => {
      clearTimeout(timer);
      const since = raw.asOf && Date.now() - wholeAt < FULL_READ_EVERY_MS ? raw.asOf : undefined;
      const next = await load(since);
      if (!alive) return;
      // A failed read keeps what's drawn, so a blip doesn't empty the project.
      if (next) {
        if (!next.delta) wholeAt = Date.now();
        raw = mergeTeamBoard(raw, next);
        setBoard(raw);
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
