"use client";

import type { Card } from "@/lib/types";
import { guarded } from "./guarded";

// Each badge loads in its own CrashGuard (components/guarded.tsx): one that breaks, even as its module loads,
// is a small chip and the others keep counting.
const QualityBadge = guarded(() => import("./QualityBadge"), { inline: true, what: "quality badge" });
const PileBadge = guarded(() => import("./PileBadge"), { inline: true, what: "pile badge" });
const BacklogBadge = guarded(() => import("./BacklogBadge"), { inline: true, what: "backlog badge" });
const GameBadge = guarded(() => import("./GameBadge"), { inline: true, what: "streak badge" });
const LeagueBadge = guarded(() => import("./LeagueBadge"), { inline: true, what: "league badge" });
const WelcomeDialog = guarded(() => import("./WelcomeDialog"), { inline: true, what: "welcome" });
const SyncPromptDialog = guarded(() => import("./SyncPromptDialog"), { inline: true, what: "sync prompt" });
const ReleaseSplash = guarded(() => import("./ReleaseSplash"), { inline: true, what: "what's new" });

// The header's badges for the project in view: code quality, the uncommitted pile, the Backlog, your streak
// and level, your league, first launch's welcome beside the streak it introduces, the ask to sync the project in view, and the "What's new" splash after an update. They refresh whenever a turn ends or a card ships somewhere, so they follow the threads' work.
// `start` begins a card (an improvement, a commit walk, a "Set it up"); it rejects when that fails.
export default function HeaderBadges({
  cwd,
  cards,
  start,
  notify,
  toast,
}: {
  cwd?: string | null;
  cards: Card[];
  start: (cwd: string, prompt: string, title: string) => Promise<string | undefined>;
  notify: (err: unknown) => void;
  toast: (text: string) => void;
}) {
  const running = cards.filter((c) => c.column === "running" && !c.archived).length;
  const turnTick = `${running}:${cards.reduce((n, c) => n + (c.turns ?? 0), 0)}`;
  const done = cards.filter((c) => c.column === "done").length;
  const waiting = cards.filter((c) => c.column === "backlog" && !c.archived).length;
  const begin = (cwd: string, prompt: string, title: string) => void start(cwd, prompt, title).catch(notify);
  return (
    <>
      <QualityBadge cwd={cwd} onImprove={begin} />
      <PileBadge cwd={cwd} refresh={turnTick} onStart={start} onError={notify} />
      <BacklogBadge cwd={cwd} refresh={`${turnTick}:${waiting}`} onStart={start} onError={notify} />
      <GameBadge cwd={cwd} refresh={`${turnTick}:${done}`} onStart={begin} />
      <LeagueBadge refresh={done} />
      <WelcomeDialog onError={notify} />
      <SyncPromptDialog cwd={cwd} cards={cards} toast={toast} />
      <ReleaseSplash />
    </>
  );
}
