"use client";

import { openNewThread } from "@/lib/onboarding-events";
import type { Card } from "@/lib/types";
import { useAnchorRect } from "@/lib/use-anchor-rect";
import { STARTERS } from "./WelcomeFirst";

// The board is new, not just filtered empty: loaded, no filter, and no cards but the copilot and archived ones.
export const isEmptyBoard = (cards: readonly Card[], loaded: boolean, filtering: boolean) =>
  loaded && !filtering && !cards.some((c) => !c.archived && c.role !== "copilot");

// The empty board's start panel: once the board has loaded with no cards (copilot and archived aside) and no
// filter, a panel centered over the columns offers New thread and the welcome's four starters. A starter opens
// New thread with its prompt written in (lib/onboarding-events.ts).
export default function EmptyBoardStart({ cards, loaded, filtering }: { cards: readonly Card[]; loaded: boolean; filtering: boolean }) {
  const empty = isEmptyBoard(cards, loaded, filtering);
  const rect = useAnchorRect(empty ? ".board-sheet" : null);
  if (!empty || !rect) return null;
  return (
    <div
      data-empty-board
      style={{ top: rect.top + rect.height / 2, left: rect.left + rect.width / 2 }}
      className="fixed z-10 w-[min(380px,90vw)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-line bg-panel p-5 text-center shadow-xl"
    >
      <h2 className="text-[16px] font-semibold text-ink">Start your first thread</h2>
      <p className="mt-1 text-[12.5px] text-muted">Each card is a thread. It lands in Running and the browser pane shows its work.</p>
      <button
        type="button"
        onClick={() => openNewThread({})}
        className="mt-3 rounded-md bg-accent px-4 py-1.5 text-[12.5px] font-semibold text-on-accent ring-2 ring-accent/30"
      >
        New thread ⌘N
      </button>
      <div className="mt-3 flex flex-wrap justify-center gap-1.5">
        {STARTERS.map((s) => (
          <button
            key={s.icon}
            type="button"
            onClick={() => openNewThread({ prompt: s.text })}
            className="rounded-full border border-line px-2.5 py-0.5 text-[11.5px] text-muted hover:bg-sunken hover:text-ink"
          >
            {s.icon} {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}
