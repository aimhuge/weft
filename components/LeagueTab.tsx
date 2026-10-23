"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import type { LeagueView } from "@/lib/league";
import { LeagueHead, LeagueTable } from "./LeagueTable";
import LeaguesDialog from "./LeaguesDialog";

// The Loom's League tab: your own league this week (lib/league-sync.ts via /api/league). Every other league,
// and the ladder, live in the Leagues dialog (components/LeaguesDialog.tsx), which "All leagues" opens.

export default function LeagueTab({ weekXp }: { weekXp: number }) {
  const [view, setView] = useState<LeagueView | null>(null);
  const [browsing, setBrowsing] = useState(false);

  useEffect(() => {
    let live = true;
    apiFetch("/api/league")
      .then((r) => r.json() as Promise<{ league?: LeagueView; error?: string }>)
      .then((d) => live && setView(d.league ?? { state: "error", error: d.error ?? "Couldn't read your league." }))
      .catch(() => live && setView({ state: "error", error: "Couldn't reach Weft's server." }));
    return () => {
      live = false;
    };
  }, []);

  const all = (
    <button onClick={() => setBrowsing(true)} className="self-start rounded-md border border-line px-2.5 py-1 text-[12px] text-ink hover:bg-sunken">
      🏆 All leagues →
    </button>
  );
  const dialog = browsing && <LeaguesDialog mine={view} onClose={() => setBrowsing(false)} />;
  if (!view) return <p className="text-[12.5px] text-muted">Reading your league…</p>;
  if (view.state !== "ready") {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-[12.5px] text-muted">
          {view.state === "signed-out"
            ? "Sign in to Weft (top bar) to join a league: about 30 builders ranked by the XP they earn Monday to Sunday. The top 7 move up and the bottom 5 move down. Only your week's XP, cards shipped, streak, level and badges are shared, never prompts or code."
            : view.error}
        </p>
        <p className="text-[12.5px] text-muted">This week: {weekXp.toLocaleString()} XP</p>
        {all}
        {dialog}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <LeagueHead league={view.league} week={view.week} size={view.rows.length} up={view.up} down={view.down} />
      <LeagueTable rows={view.rows} tier={view.tier} />
      {all}
      {dialog}
    </div>
  );
}
