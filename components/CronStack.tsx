"use client";

import { useState, type ReactNode } from "react";
import type { Card } from "@/lib/types";
import "./crons.css";

// A card with a cron's runs folded under it (lib/cron-stacks.ts): drawn as a stack of cards. The first click fans the
// runs out below it, each a card of its own to click; once open, the card opens its thread as usual, and the
// "runs" chip folds them back. Buttons on the card (star, menu) work either way.
export default function CronStack({ holder, runs, renderCard }: { holder: Card; runs: Card[]; renderCard: (card: Card) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const label = `${runs.length} run${runs.length === 1 ? "" : "s"}`;

  return (
    <div className="cron-stack" data-open={open || undefined} data-cron-stack={holder.id}>
      <div
        className="relative"
        onClickCapture={(e) => {
          if (open || (e.target as HTMLElement).closest("button, a, input, textarea, select")) return;
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
      >
        {renderCard(holder)}
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          title={open ? "Fold the runs back" : "Show this cron's runs"}
          className="absolute -bottom-1.5 right-3 z-10 rounded-full bg-[var(--cron)] px-1.5 text-[10.5px] font-semibold leading-4 text-white shadow-sm"
        >
          ⏰ {label} {open ? "▴" : "▾"}
        </button>
      </div>
      {open && (
        <div className="cron-fan flex flex-col gap-2" aria-label={`Runs of ${holder.title}`}>
          {runs.map((run) => (
            <div key={run.id}>{renderCard(run)}</div>
          ))}
        </div>
      )}
    </div>
  );
}
