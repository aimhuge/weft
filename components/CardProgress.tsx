"use client";

import { STAGES, stageStep } from "@/lib/format";
import { COLUMN_TONE } from "@/lib/column-tone";
import { type Card } from "@/lib/types";

// Whether the card has a progress line: a stage or what's left, and in Done only what's left.
export function showsCardProgress(card: Card) {
  // In Done, "Done" says nothing the column doesn't.
  if (card.column === "done" && (stageStep(card.stage) === STAGES.length || !card.remaining)) return false;
  return Boolean(card.stage || card.remaining);
}

// How far along the card is (the BOARD STATUS stage) and what's left, on one line; marks (the issue
// and tags) go at its end, so they don't crowd the footer.
export default function CardProgress({ card, marks }: { card: Card; marks: React.ReactNode }) {
  const step = stageStep(card.stage);
  const tone = COLUMN_TONE[card.column];
  return (
    <div className="mt-2 flex min-w-0 items-center gap-1.5 overflow-hidden text-[11px]">
      {step > 0 && (
        <span className="flex shrink-0 gap-[2px]" title={`${card.stage}: step ${step} of ${STAGES.length}`} aria-hidden>
          {STAGES.map((s, i) => (
            <span key={s} className={`h-[5px] w-[5px] rounded-full ${i < step ? tone.bar : "bg-line-strong"}`} />
          ))}
        </span>
      )}
      {card.stage && <span className={`max-w-[50%] shrink-0 truncate font-medium ${tone.text}`}>{card.stage}</span>}
      {card.remaining && card.remaining !== "none" && (
        <span className="min-w-0 shrink-[10] truncate text-faint" title={`Left: ${card.remaining}`}>· {card.remaining}</span>
      )}
      <span className="ml-auto flex shrink-0">{marks}</span>
    </div>
  );
}
