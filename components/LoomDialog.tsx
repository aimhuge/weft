"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import type { GameState } from "@/lib/game-server";
import { showPage } from "@/lib/board-helpers";
import { setupPrompt, type CheckDef, type ProjectReport } from "@/lib/project-badges";
import LoomApps from "./LoomApps";
import CrashGuard from "./CrashGuard";
import LeagueTab from "./LeagueTab";
import { BadgesTab, ProjectsTab } from "./LoomBadges";
import { Bar, Cloth, Radar } from "./LoomCharts";
import LoomProfile from "./LoomProfile";
import UsageChart from "./LoomUsage";
import Modal from "./Modal";

export type LoomTab = "you" | "badges" | "projects" | "league";
const TABS: { id: LoomTab; label: string }[] = [
  { id: "you", label: "You" },
  { id: "badges", label: "Badges" },
  { id: "projects", label: "Projects" },
  { id: "league", label: "League" },
];

function duration(ms: number) {
  const min = Math.round(ms / 60_000);
  return min < 60 ? `${min} min` : `${(min / 60).toFixed(1)} h`;
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="flex flex-col rounded-lg border border-line px-3 py-2">
      <span className="text-[11px] text-muted">{label}</span>
      <span className="text-[16px] font-semibold tabular-nums text-ink">{value}</span>
      {sub && <span className="text-[11px] text-muted">{sub}</span>}
    </div>
  );
}

function YouTab({ game, onOpenApp }: { game: GameState; onOpenApp: (url: string) => void }) {
  const { level, streak, records: r } = game;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-4">
        <div className="flex flex-1 flex-col gap-3">
          <LoomProfile name={game.name} className={game.className} github={game.github} />
          <Bar value={game.xp - level.floor} max={level.next - level.floor} left={`Lv ${level.level} ${level.title}`} right={`${game.xp.toLocaleString()} / ${level.next.toLocaleString()} XP`} />
          <div className="grid grid-cols-3 gap-2">
            <Stat
              label="Wefting streak"
              value={`🔥 ${streak.current} ${streak.current === 1 ? "day" : "days"}`}
              sub={streak.atRisk ? "Ship something today" : `Straight · best ${streak.best}`}
            />
            <Stat label="Freezes" value={`🧊 ${streak.freezes}`} sub="One per 7 days in a row" />
            <Stat label="Today" value={`${game.today.xp} XP`} sub={`${game.today.cards} started · ${game.today.done} shipped`} />
          </div>
          <div className="flex flex-col gap-1">
            {game.attributes.map((a) => (
              <div key={a.id} className="flex items-center gap-2 text-[12px]">
                <span className="w-4">{a.icon}</span>
                <span className="w-[96px] text-ink">{a.label}</span>
                <div className="h-1.5 w-[70px] overflow-hidden rounded-full bg-sunken">
                  <div className="h-full bg-warn" style={{ width: `${a.value}%` }} />
                </div>
                <span className="w-6 text-right tabular-nums text-muted">{a.value}</span>
                <span className="min-w-0 flex-1 truncate text-[11px] text-muted">{a.hint}</span>
              </div>
            ))}
          </div>
        </div>
        <Radar attrs={game.attributes} />
      </div>
      <CrashGuard what="mini apps">
        <LoomApps onOpen={onOpenApp} />
      </CrashGuard>
      {game.skills.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {game.skills.map((s) => (
            <span key={s.tech} className="rounded-md border border-line px-2 py-0.5 text-[11.5px] text-ink">
              {s.tech} <span className="text-warn">Lv {s.level}</span>
            </span>
          ))}
        </div>
      )}
      <Cloth stitches={game.cloth} />
      <UsageChart days={game.usage} hits={game.limitHits} />
      <div className="grid grid-cols-4 gap-2">
        <Stat label="Biggest day" value={r.biggestDay?.cards ?? 0} sub={r.biggestDay ? `cards on ${r.biggestDay.day}` : "cards started"} />
        <Stat label="Most shipped" value={r.mostShipped?.done ?? 0} sub={r.mostShipped ? `on ${r.mostShipped.day}` : "in a day"} />
        <Stat label="Fastest ship" value={r.fastest ? duration(r.fastest) : "–"} sub="idea to Done" />
        <Stat label="Most at once" value={r.maxRunning} sub="cards running" />
      </div>
    </div>
  );
}

// "Wefter Profile": your wefter card (with your GitHub profile and your mini apps), badges, each project's production-ready tree and your league (every league is the header's 🏆, components/LeaguesDialog.tsx).
// Opens with the header chip's light state and measures your projects in the background.
export default function LoomDialog({
  cwd,
  initial,
  startTab = "you",
  onClose,
  onStart,
}: {
  cwd: string | null;
  initial: GameState;
  // The tab it opens on: the achievement popup opens it on Badges.
  startTab?: LoomTab;
  onClose: () => void;
  onStart: (cwd: string, prompt: string, title: string) => void;
}) {
  const [game, setGame] = useState(initial);
  const [measuring, setMeasuring] = useState(true);
  const [tab, setTab] = useState<LoomTab>(startTab);

  useEffect(() => {
    let live = true;
    apiFetch(`/api/game?full=1${cwd ? `&cwd=${encodeURIComponent(cwd)}` : ""}`)
      .then((r) => r.json() as Promise<{ game?: GameState }>)
      .then((d) => {
        if (live && d.game) setGame(d.game);
      })
      .catch(() => {})
      .finally(() => live && setMeasuring(false));
    return () => {
      live = false;
    };
  }, [cwd]);

  const inView = game.projects.find((p) => p.root === game.inView) ?? null;
  const setup = (project: ProjectReport, check: CheckDef) => {
    onStart(project.root, setupPrompt(check, project), `${check.label} for ${project.name}`);
    onClose();
  };
  const unlocked = game.badges.filter((b) => b.unlocked).length;

  return (
    <Modal title="Wefter Profile" onClose={onClose} className="max-h-[86vh] w-full max-w-[760px]">
      <div className="flex shrink-0 items-center gap-1 border-b border-line px-4 py-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-md px-2.5 py-1 text-[12.5px] ${tab === t.id ? "bg-accent-soft text-accent" : "text-muted hover:bg-sunken hover:text-ink"}`}
          >
            {t.label}
            {t.id === "badges" && <span className="ml-1 tabular-nums">{unlocked}/{game.badges.length}</span>}
          </button>
        ))}
        {measuring && <span className="ml-auto text-[11.5px] text-muted">Measuring your projects…</span>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {tab === "you" && (
          <YouTab
            game={game}
            onOpenApp={(url) => {
              onClose();
              showPage(url);
            }}
          />
        )}
        {tab === "badges" && <BadgesTab badges={game.badges} project={inView} onSetup={setup} />}
        {tab === "projects" && <ProjectsTab projects={game.projects} inView={game.inView} onSetup={setup} />}
        {tab === "league" && <LeagueTab weekXp={game.weekXp} />}
      </div>
    </Modal>
  );
}
