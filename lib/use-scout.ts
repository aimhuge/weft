"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "./api-client";
import type { ScoutState } from "./scout-view";

// While the scout runs, how often the badge looks for its findings.
export const POLL_MS = 20_000;

const HEADERS = { "content-type": "application/json", "x-weft-token": "1" };

async function scoutOf(res: Promise<Response>) {
  const d = (await (await res).json()) as { scout?: ScoutState | null };
  return d.scout ?? null;
}

const read = (cwd: string) => scoutOf(apiFetch(`/api/scout?cwd=${encodeURIComponent(cwd)}`));

// The refactor scout for a folder (app/api/scout): read on mount and on focus, polled while it runs.
// rescout() starts a fresh run; started(id) marks a finding as handed to a card.
export function useScout(cwd: string | null | undefined) {
  // Keyed by folder, so switching projects never shows the last one's findings.
  const [loaded, setLoaded] = useState<{ cwd: string; scout: ScoutState | null } | null>(null);
  const scout = cwd && loaded?.cwd === cwd ? loaded.scout : null;
  const running = !!scout?.running;

  useEffect(() => {
    if (!cwd) return;
    let live = true;
    const load = () => {
      read(cwd)
        .then((s) => {
          if (live) setLoaded({ cwd, scout: s });
        })
        .catch(() => {});
    };
    load();
    window.addEventListener("focus", load);
    // Polled only while a run is going.
    const timer = running ? setInterval(load, POLL_MS) : undefined;
    return () => {
      live = false;
      window.removeEventListener("focus", load);
      clearInterval(timer);
    };
  }, [cwd, running]);

  function post(body: Record<string, string>) {
    if (!cwd) return;
    scoutOf(fetch("/api/scout", { method: "POST", headers: HEADERS, body: JSON.stringify({ cwd, ...body }) }))
      .then((s) => {
        setLoaded({ cwd, scout: s });
      })
      .catch(() => {});
  }

  return {
    scout,
    rescout: () => {
      post({});
    },
    started: (id: string) => {
      post({ started: id });
    },
  };
}
