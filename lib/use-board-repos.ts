"use client";

import { useEffect, useState } from "react";
import { api } from "./client";
import { cardsPerRepo } from "./team-view";

// The GitHub repos of the board's projects (GET /api/settings for the folders, then GET /api/github for each
// folder's remote), for the team's "Add project" picker, and how many of the board's cards each one has
// (GET /api/cards, counted by folder), for a team project's row. Folders with no GitHub remote are left out; a
// failure is an empty list, since the picker also takes a typed owner/name. The last answer is kept for the next
// open, which shows it at once and checks again behind it.
export type BoardProjects = { repos: string[]; cards: Record<string, number> };

let last: BoardProjects = { repos: [], cards: {} };
const EMPTY: BoardProjects = { repos: [], cards: {} };

export function useBoardProjects(active: boolean): BoardProjects {
  const [found, setFound] = useState<BoardProjects>(last);
  useEffect(() => {
    if (!active) return;
    const live = { on: true };
    void (async () => {
      try {
        const settings = await api.settings();
        const [status, list] = await Promise.all([
          api.github(settings.projects.map((p) => p.path)),
          api.list().catch(() => ({ cards: [] })),
        ]);
        const repos = status.folders.map((f) => f.repo).filter((r): r is string => !!r);
        last = { repos: [...new Set(repos)], cards: cardsPerRepo(list.cards, status.folders) };
        if (live.on) setFound(last);
      } catch {
        if (live.on) setFound(EMPTY);
      }
    })();
    return () => {
      live.on = false;
    };
  }, [active]);
  return found;
}

export function useBoardRepos(active: boolean): string[] {
  return useBoardProjects(active).repos;
}
