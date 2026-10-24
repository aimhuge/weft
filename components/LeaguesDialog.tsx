"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { useFeatureIntro } from "@/lib/use-feature-intro";
import { leagueName, type LeagueView, type TierView } from "@/lib/league";
import { LeagueHead, LeagueTable, Ladder } from "./LeagueTable";
import { IntroButton, IntroFrame } from "./FeatureIntro";
import LimitBoardPanel from "./LimitBoardPanel";
import Modal from "./Modal";

// Every league, not just yours: the six tiers as tabs (opens on yours), and under the one picked each of its
// leagues this week with who's in it (/api/league?tier=N, lib/league-sync.ts tierView). Opened from the header's
// 🏆 chip (components/LeagueBadge.tsx) and the profile's League tab. "Limit records" swaps in the all-time limit
// leaderboards (components/LimitBoardPanel.tsx).

const SIGN_IN =
  "Sign in to Weft (top bar) to join a league: about 30 builders ranked by the XP they earn Monday to Sunday. The top 7 move up and the bottom 5 move down. Only your week's XP, cards shipped, streak, level and badges are shared, never prompts or code.";

function TierLeagues({ view }: { view: TierView | undefined }) {
  if (!view) return <p className="text-[12.5px] text-muted">Reading the leagues…</p>;
  if (view.state === "signed-out") return <p className="text-[12.5px] text-muted">{SIGN_IN}</p>;
  if (view.state === "error") return <p className="text-[12.5px] text-muted">{view.error}</p>;
  if (!view.leagues.length) return <p className="text-[12.5px] text-muted">Nobody is in {view.league} this week yet.</p>;
  const many = view.leagues.length > 1;
  return (
    <>
      {view.leagues.map((l, i) => (
        <div key={l.cohort} className="flex flex-col gap-1.5">
          <LeagueHead
            league={view.league}
            week={view.week}
            size={l.rows.length}
            up={l.up}
            down={l.down}
            title={many ? `${view.league} League ${i + 1}${l.rows.some((r) => r.isMe) ? " (yours)" : ""}` : undefined}
          />
          <LeagueTable rows={l.rows} tier={view.tier} />
        </div>
      ))}
    </>
  );
}

export default function LeaguesDialog({ mine, onClose }: { mine: LeagueView | null; onClose: () => void }) {
  const myTier = mine?.state === "ready" ? mine.tier : null;
  const [picked, setPicked] = useState(myTier ?? 0);
  const [views, setViews] = useState<Record<number, TierView>>({});
  const [limits, setLimits] = useState(false);
  const intro = useFeatureIntro("leagues");

  useEffect(() => {
    if (limits || views[picked]) return;
    let live = true;
    apiFetch(`/api/league?tier=${picked}`)
      .then((r) => r.json() as Promise<{ tier?: TierView; error?: string }>)
      .then((d) => live && setViews((v) => ({ ...v, [picked]: d.tier ?? { state: "error", error: d.error ?? "Couldn't read the leagues." } })))
      .catch(() => live && setViews((v) => ({ ...v, [picked]: { state: "error", error: "Couldn't reach Weft's server." } })));
    return () => {
      live = false;
    };
  }, [picked, views, limits]);

  return (
    <Modal
      title={
        <span className="flex items-center gap-1.5">
          {limits ? "⏱️ Limit records" : `🏆 Leagues · ${leagueName(picked)}`}
          <IntroButton intro={intro} />
        </span>
      }
      label="Leagues"
      onClose={onClose} className="max-h-[86vh] w-full max-w-[760px]">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        <IntroFrame intro={intro} />
        <div className="flex gap-1 self-start rounded-md border border-line p-0.5 text-[12px]">
          {[["🏆 Leagues", false], ["⏱️ Limit records", true]].map(([label, on]) => (
            <button
              key={String(on)}
              onClick={() => setLimits(on as boolean)}
              aria-pressed={limits === on}
              className={`rounded px-2.5 py-0.5 ${limits === on ? "bg-accent-soft font-semibold text-accent" : "text-ink hover:bg-sunken"}`}
            >
              {label}
            </button>
          ))}
        </div>
        {limits ? (
          <LimitBoardPanel />
        ) : (
          <>
            <Ladder tier={myTier} picked={picked} onPick={setPicked} />
            <TierLeagues view={views[picked]} />
          </>
        )}
      </div>
    </Modal>
  );
}
