"use client";

import dynamic from "next/dynamic";
import { useEffect, useState, useSyncExternalStore } from "react";
import { readLastAchievement, REPLAY_ACHIEVEMENT_EVENT, saveLastAchievement } from "@/lib/achievement-replay";
import { apiFetch } from "@/lib/api-client";
import { showProgress, subscribeBoardPrefs } from "@/lib/board-prefs";
import { toAnnounce, type Announced } from "@/lib/game-badges";
import type { GameState } from "@/lib/game-server";
import type { Achievement } from "./AchievementPopup";
import type { LoomTab } from "./LoomDialog";
import Tip from "./Tip";

const LoomDialog = dynamic(() => import("./LoomDialog"), { ssr: false });
const AchievementPopup = dynamic(() => import("./AchievementPopup"), { ssr: false });

const ANNOUNCED = "weft-game-announced";

function readAnnounced(): Announced | null {
  try {
    return JSON.parse(localStorage.getItem(ANNOUNCED) ?? "null") as Announced | null;
  } catch {
    return null;
  }
}

// "🔥 25 · Lv 15" in the header: your streak and level. Click for your "Wefter Profile" (components/LoomDialog.tsx).
// `refresh` changes when a turn ends somewhere, so the streak follows your work; new badges and
// level-ups open a popup with confetti (components/AchievementPopup.tsx), and the avatar menu's "Replay last
// achievement" opens the last one again (lib/achievement-replay.ts). Settings > Show progress turns it off.
export default function GameBadge({
  cwd,
  refresh,
  onStart,
}: {
  cwd?: string | null;
  refresh?: unknown;
  onStart: (cwd: string, prompt: string, title: string) => void;
}) {
  const enabled = useSyncExternalStore(subscribeBoardPrefs, showProgress, () => true);
  const [game, setGame] = useState<GameState | null>(null);
  const [open, setOpen] = useState<LoomTab | null>(null);
  const [achievement, setAchievement] = useState<Achievement | null>(null);

  useEffect(() => {
    if (!enabled || open) return;
    let live = true;
    const load = () => {
      apiFetch(`/api/game${cwd ? `?cwd=${encodeURIComponent(cwd)}` : ""}`)
        .then((r) => r.json() as Promise<{ game?: GameState }>)
        .then((d) => {
          if (live && d.game) setGame(d.game);
        })
        .catch(() => {});
    };
    load();
    window.addEventListener("focus", load);
    return () => {
      live = false;
      window.removeEventListener("focus", load);
    };
  }, [cwd, refresh, enabled, open]);

  useEffect(() => {
    if (!game) return;
    const { next, fresh, levelUp } = toAnnounce(readAnnounced(), game.badges, game.level.level);
    localStorage.setItem(ANNOUNCED, JSON.stringify(next));
    if (!fresh.length && !levelUp) return;
    const shown = { fresh, level: levelUp ? game.level : null };
    saveLastAchievement(shown);
    setAchievement(shown); // eslint-disable-line react-hooks/set-state-in-effect
  }, [game]);

  useEffect(() => {
    if (!enabled || !game) return;
    const replay = () => setAchievement(readLastAchievement(game.level));
    window.addEventListener(REPLAY_ACHIEVEMENT_EVENT, replay);
    return () => window.removeEventListener(REPLAY_ACHIEVEMENT_EVENT, replay);
  }, [enabled, game]);

  if (!enabled || !game) return null;
  const { streak, level } = game;
  const tip = (
    <span className="flex w-[220px] flex-col gap-1">
      <b>
        {streak.current}-day streak{streak.atRisk ? ": ship something today to keep it" : ""}
      </b>
      <span>
        Best {streak.best} · {streak.freezes} streak freeze{streak.freezes === 1 ? "" : "s"}
      </span>
      <span>
        Lv {level.level} {level.title} · {(level.next - game.xp).toLocaleString()} XP to the next level
      </span>
      <span>
        Today: {game.today.cards} started, {game.today.done} shipped, {game.today.xp} XP
      </span>
      <span className="text-muted">Click for your wefter card, badges and projects.</span>
    </span>
  );
  return (
    <>
      <Tip text={tip}>
        <button
          onClick={() => setOpen("you")}
          aria-label={`Wefter Profile: ${streak.current}-day streak, level ${level.level}`}
          className="flex items-center gap-1 rounded-md px-1 py-0.5 text-[11.5px] text-muted hover:bg-hover"
        >
          <span className={streak.atRisk || streak.current === 0 ? "opacity-40 grayscale" : ""}>🔥</span>
          <span className={`tabular-nums ${streak.current ? "text-warn" : ""}`}>{streak.current}</span>
          <span>·</span>
          <span className="tabular-nums">Lv {level.level}</span>
        </button>
      </Tip>
      {open && <LoomDialog cwd={cwd ?? null} initial={game} startTab={open} onClose={() => setOpen(null)} onStart={onStart} />}
      {achievement && (
        <AchievementPopup
          achievement={achievement}
          onClose={() => setAchievement(null)}
          onProfile={() => {
            setAchievement(null);
            setOpen(achievement.fresh.length ? "badges" : "you");
          }}
        />
      )}
    </>
  );
}
