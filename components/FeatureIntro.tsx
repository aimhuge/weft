"use client";

import { hasVideo, INTRO_TITLES, type IntroId } from "@/lib/feature-intros";
import type { FeatureIntroState } from "@/lib/use-feature-intro";

// A feature's intro video (lib/feature-intros.ts) for its rail drawer or dialog: a sandboxed iframe that only plays. It
// opens big, in a modal three quarters of the window; closing that (✕, Esc or the backdrop) leaves it playing on at the
// top of the drawer or dialog, the width of it, where ⤢ blows it up again and ✕ hides it. A click on the video pauses
// it and plays it on, and Replay shows over it once it ends. IntroButton is the ▶ beside the title that plays it again.
// Both take the state from lib/use-feature-intro.ts, which the drawer or dialog holds.

const CHIP = "rounded-md bg-black/55 px-1.5 py-0.5 text-[11px] text-white hover:bg-black/75";
// The one box the iframe lives in, in either place: only its styles change, so the iframe is never moved or reloaded
// and the video plays on through the switch. Fixed works from inside the drawer and the dialogs because nothing above
// them makes a containing block (no transform or filter; rail-drawer.css slides the drawer in by its margin).
const BIG = "fixed left-1/2 top-1/2 z-[71] -translate-x-1/2 -translate-y-1/2 rounded-xl shadow-2xl";
const BIG_SIZE = { width: "min(75vw, calc(75vh * 16 / 9))" };
const DOCKED = "relative w-full rounded-lg";

export function IntroFrame({ intro, className = "" }: { intro: FeatureIntroState; className?: string }) {
  const { id, open, ended, expanded, run, src, attach, play, setExpanded } = intro;
  if (!open || !id || !hasVideo(id)) return null;
  const title = INTRO_TITLES[id];
  return (
    <div className={`shrink-0 ${expanded ? "" : className}`}>
      {expanded && (
        <div
          className="fixed inset-0 z-[70] bg-black/70"
          aria-hidden
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(false);
          }}
        />
      )}
      <div
        role={expanded ? "dialog" : undefined}
        aria-modal={expanded || undefined}
        aria-label={expanded ? `What ${title} does` : undefined}
        className={`overflow-hidden bg-[#0d0f14] ${expanded ? BIG : DOCKED}`}
        style={expanded ? BIG_SIZE : undefined}
      >
        <iframe
          key={run}
          ref={attach}
          src={src}
          title={`What ${title} does`}
          sandbox="allow-scripts"
          tabIndex={-1}
          className="pointer-events-none block aspect-video w-full border-0"
        />
        <ClickToPause intro={intro} />
        <CornerChips intro={intro} />
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
    </div>
  );
}

// The whole video is the pause button; ▶ shows over it while it's paused. Once it has ended, a click plays it again.
function ClickToPause({ intro: { paused, ended, expanded, togglePlaying } }: { intro: FeatureIntroState }) {
  return (
    <button
      type="button"
      onClick={togglePlaying}
      aria-label={paused || ended ? "Play the intro" : "Pause the intro"}
      className="absolute inset-0 flex cursor-pointer items-center justify-center"
    >
      {paused && !ended && (
        <span className={`rounded-full bg-black/60 text-white ${expanded ? "px-6 py-4 text-[32px]" : "px-3 py-2 text-[16px]"}`} aria-hidden>
          ▶
        </span>
      )}
    </button>
  );
}

// 🔊 and ✕ over the corner, and ⤢ in the drawer. In the modal ✕ shrinks it back into the drawer; there it hides it.
function CornerChips({ intro: { expanded, muted, toggleMuted, setExpanded, hide } }: { intro: FeatureIntroState }) {
  return (
    <div className="absolute right-1.5 top-1.5 flex gap-1">
      {!expanded && (
        <button type="button" onClick={() => setExpanded(true)} className={CHIP} aria-label="Play it big">
          ⤢
        </button>
      )}
      <button type="button" onClick={toggleMuted} className={CHIP} aria-label={muted ? "Unmute the voice" : "Mute the voice"}>
        {muted ? "🔇" : "🔊"}
      </button>
      <button
        type="button"
        onClick={expanded ? () => setExpanded(false) : hide}
        className={CHIP}
        aria-label={expanded ? "Shrink it back" : "Hide the intro"}
      >
        ✕
      </button>
    </div>
  );
}

export function IntroButton({ intro }: { intro: FeatureIntroState }) {
  if (!intro.id || intro.open || !hasVideo(intro.id)) return null;
  return <PlayIntroButton id={intro.id} onPlay={intro.play} />;
}

// The ▶ itself, for an intro that plays somewhere else too (lib/pane-intro.ts plays one in the browser pane).
export function PlayIntroButton({ id, onPlay }: { id: IntroId; onPlay: () => void }) {
  if (!hasVideo(id)) return null;
  return (
    <button
      type="button"
      onClick={onPlay}
      title={`Play the ${INTRO_TITLES[id]} intro`}
      aria-label={`Play the ${INTRO_TITLES[id]} intro`}
      className="rounded px-1 py-0.5 text-[11px] text-muted hover:bg-sunken hover:text-ink"
    >
      ▶
    </button>
  );
}
