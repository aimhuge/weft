"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { apiFetch } from "@/lib/api-client";
import type { GameState } from "@/lib/game-server";
import { openNewThread } from "@/lib/onboarding-events";
import type { Card } from "@/lib/types";
import { useOnboardingTips } from "@/lib/use-onboarding-tips";
import CoachTip from "./CoachTip";
import CrashGuard from "./CrashGuard";
import EmptyBoardStart from "./EmptyBoardStart";

const LoomDialog = dynamic(() => import("./LoomDialog"), { ssr: false });

// The board's onboarding after the welcome: the empty board's start panel and one coach tip at a time
// (lib/use-onboarding-tips.ts). The profile tip's button opens the Wefter Profile the way GameBadge does.
export default function OnboardingTips({ cards, loaded, filtering }: { cards: readonly Card[]; loaded: boolean; filtering: boolean }) {
  const { tip, empty, dismiss } = useOnboardingTips(cards, loaded, filtering);
  const [game, setGame] = useState<GameState | null>(null);
  const openProfile = () => {
    apiFetch("/api/game")
      .then((r) => r.json() as Promise<{ game?: GameState }>)
      .then((d) => d.game && setGame(d.game))
      .catch(() => {});
  };
  return (
    <>
      {empty && (
        <CrashGuard what="start panel" inline>
          <EmptyBoardStart />
        </CrashGuard>
      )}
      {tip && (
        <CoachTip
          id={tip}
          onDismiss={dismiss}
          onAction={(id) => {
            dismiss(id);
            openProfile();
          }}
        />
      )}
      {game && <LoomDialog cwd={null} initial={game} onClose={() => setGame(null)} onStart={(cwd, prompt) => openNewThread({ cwd, prompt })} />}
    </>
  );
}
