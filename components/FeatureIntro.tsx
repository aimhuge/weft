"use client";

import { INTRO_TITLES } from "@/lib/feature-intros";
import type { FeatureIntroState } from "@/lib/use-feature-intro";

// A feature's intro video (lib/feature-intros.ts), at the top of its rail drawer or dialog: a sandboxed iframe that only
// plays, with 🔊 and ✕ over its corner and Replay over it once it ends. IntroButton is the ▶ beside the title that
// plays it again. Both take the state from lib/use-feature-intro.ts, which the drawer or dialog holds.

const CHIP = "rounded-md bg-black/55 px-1.5 py-0.5 text-[11px] text-white hover:bg-black/75";

export function IntroFrame({ intro, className = "" }: { intro: FeatureIntroState; className?: string }) {
  const { id, open, ended, run, src, attach, muted, toggleMuted, play, hide } = intro;
  if (!open || !id) return null;
  const title = INTRO_TITLES[id];
  return (
    <div className={`relative mx-auto w-full max-w-[300px] shrink-0 overflow-hidden rounded-lg bg-[#0d0f14] ${className}`}>
      <iframe
        key={run}
        ref={attach}
        src={src}
        title={`What ${title} does`}
        sandbox="allow-scripts"
        tabIndex={-1}
        className="pointer-events-none block aspect-[4/5] w-full border-0"
      />
      <div className="absolute right-1.5 top-1.5 flex gap-1">
        <button type="button" onClick={toggleMuted} className={CHIP} aria-label={muted ? "Unmute the voice" : "Mute the voice"}>
          {muted ? "🔇" : "🔊"}
        </button>
        <button type="button" onClick={hide} className={CHIP} aria-label="Hide the intro">
          ✕
        </button>
      </div>
      {ended && (
        <button
          type="button"
          onClick={play}
          className="absolute left-1/2 top-[40%] -translate-x-1/2 rounded-full bg-white/90 px-3 py-1.5 text-[12px] font-medium text-[#111] shadow-lg hover:bg-white"
        >
          ↻ Replay
        </button>
      )}
    </div>
  );
}

export function IntroButton({ intro }: { intro: FeatureIntroState }) {
  if (!intro.id || intro.open) return null;
  return (
    <button
      type="button"
      onClick={intro.play}
      title={`Play the ${INTRO_TITLES[intro.id]} intro`}
      aria-label={`Play the ${INTRO_TITLES[intro.id]} intro`}
      className="rounded px-1 py-0.5 text-[11px] text-muted hover:bg-sunken hover:text-ink"
    >
      ▶
    </button>
  );
}
