"use client";

import dynamic from "next/dynamic";
import { useEffect, useState, useSyncExternalStore } from "react";
import { apiFetch } from "@/lib/api-client";
import { showProgress, subscribeBoardPrefs } from "@/lib/board-prefs";
import type { LeagueView } from "@/lib/league";
import Tip from "./Tip";

const LeaguesDialog = dynamic(() => import("./LeaguesDialog"), { ssr: false });

// "🏆 Linen #1" in the header, beside the streak: your league and rank this week (/api/league). Click for every
// league (components/LeaguesDialog.tsx). Signed out it reads "🏆 Leagues", so leagues are there to find.
// `refresh` changes when a card ships, as GameBadge's does; Settings > Show progress hides it with the streak.
export default function LeagueBadge({ refresh }: { refresh?: unknown }) {
  const enabled = useSyncExternalStore(subscribeBoardPrefs, showProgress, () => true);
  const [view, setView] = useState<LeagueView | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!enabled || open) return;
    let live = true;
    apiFetch("/api/league")
      .then((r) => r.json() as Promise<{ league?: LeagueView }>)
      .then((d) => live && d.league && setView(d.league))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [refresh, enabled, open]);

  if (!enabled || !view) return null;
  const me = view.state === "ready" ? view.rows.find((r) => r.isMe) : undefined;
  const label = view.state === "ready" ? `${view.league}${me ? ` #${me.rank}` : ""}` : "Leagues";
  const tip =
    view.state === "ready" ? (
      <span className="flex w-[220px] flex-col gap-1">
        <b>
          {view.league} League{me ? `: #${me.rank} of ${view.rows.length}` : ""}
        </b>
        {me && <span>{me.xp.toLocaleString()} XP this week</span>}
        <span className="text-muted">Click to see every league and who&apos;s in it.</span>
      </span>
    ) : (
      <span className="w-[220px]">Weekly leagues: builders ranked by the XP they earn Monday to Sunday. Click to look around.</span>
    );
  return (
    <>
      <Tip text={tip}>
        <button
          onClick={() => setOpen(true)}
          aria-label={`Leagues: ${label}`}
          className="flex items-center gap-1 rounded-md px-1 py-0.5 text-[11.5px] text-muted hover:bg-hover"
        >
          <span>🏆</span>
          <span className="tabular-nums">{label}</span>
        </button>
      </Tip>
      {open && <LeaguesDialog mine={view} onClose={() => setOpen(false)} />}
    </>
  );
}
