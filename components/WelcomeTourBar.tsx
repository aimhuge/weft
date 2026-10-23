"use client";

import type { TourNav } from "@/lib/use-welcome-tour";
import { BEAT_TITLES, BEATS, stepBeat, type Beat } from "@/lib/welcome-loop";

// The strip under the welcome's tour (components/WelcomeLoop.tsx) that frames each beat: which one is on screen ("3 of
// 9 · Connect your tools"), a segment per beat to jump to, Back and Next a beat at a time (not the whole tour), and the
// narration's mute. One row, so it costs the welcome no height to speak of.

const ARROW = "rounded-md px-2 py-0.5 text-[12px] text-ink hover:bg-sunken disabled:opacity-30 disabled:hover:bg-transparent";

export function WelcomeTourBar({ beat, go, muted, toggleMuted }: { beat: Beat; go: (to: Beat, action?: TourNav) => void; muted: boolean; toggleMuted: () => void }) {
  const at = BEATS.indexOf(beat);
  const back = stepBeat(beat, -1);
  const next = stepBeat(beat, 1);
  return (
    <div className="flex items-center gap-2 border-t border-line bg-panel px-2 py-1.5">
      <button type="button" onClick={() => back && go(back, "back")} disabled={!back} aria-label="Back a beat" className={ARROW}>
        ‹ Back
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-baseline gap-1.5 text-[12px]">
          <span className="shrink-0 tabular-nums text-muted">
            {at + 1} of {BEATS.length}
          </span>
          <b className="truncate font-medium text-ink" aria-live="polite">
            {BEAT_TITLES[beat]}
          </b>
        </div>
        <div className="flex gap-0.5">
          {BEATS.map((b, i) => (
            <button
              key={b}
              type="button"
              onClick={() => go(b)}
              aria-label={BEAT_TITLES[b]}
              aria-current={b === beat ? "step" : undefined}
              className={`h-1 flex-1 rounded-full ${i < at ? "bg-accent/50" : i === at ? "bg-accent" : "bg-line-strong"} hover:opacity-70`}
            />
          ))}
        </div>
      </div>
      <button type="button" onClick={() => next && go(next, "next")} disabled={!next} aria-label="Next beat" className={ARROW}>
        Next ›
      </button>
      <button type="button" onClick={toggleMuted} aria-label={muted ? "Turn narration on" : "Mute narration"} className="rounded-md px-1.5 py-0.5 text-[12px] hover:bg-sunken">
        {muted ? "🔇" : "🔊"}
      </button>
    </div>
  );
}
