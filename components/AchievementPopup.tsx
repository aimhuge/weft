"use client";

import type { Badge } from "@/lib/game-badges";
import type { GameState } from "@/lib/game-server";
import { loreFor, type Lore } from "@/lib/level-lore";
import { readMuted, VoicePlayer, writeMuted } from "@/lib/welcome-voice";
import Confetti from "./Confetti";
import Modal from "./Modal";
import { useEffect, useState } from "react";

// What GameBadge hands the popup: the badges just earned and, if the level went up, the new one.
export interface Achievement {
  fresh: Badge[];
  level: GameState["level"] | null;
}

// The popup a new badge or level-up opens, with a burst of confetti behind it. A level-up opens on its rank's
// picture, as big as a cinema frame, with the episode and a line of story crawling over it while a narrator reads the
// line (lib/level-lore.ts). One badge gets the stage
// (big icon, name, what earned it); several share it as a list. "See your profile" opens the Wefter Profile.
export default function AchievementPopup({ achievement, onProfile, onClose }: { achievement: Achievement; onProfile: () => void; onClose: () => void }) {
  const [confetti, setConfetti] = useState(true);
  const { fresh, level } = achievement;
  const heading = fresh.length === 0 ? "Level up!" : fresh.length === 1 ? "Achievement unlocked!" : `${fresh.length} achievements unlocked!`;
  const lore = level ? loreFor(level.level, level.title) : null;

  return (
    <>
      <Modal label={heading} onClose={onClose} layer="front" className={`w-full overflow-hidden ${lore ? "max-w-[min(760px,92vw)]" : "max-w-[360px]"}`}>
        {lore && <LevelHero lore={lore} />}
        <div className={`flex flex-col items-center gap-3 px-6 pb-5 text-center ${lore ? "pt-4" : "pt-7"}`}>
          {(fresh.length > 0 || !lore) && <BadgeIcon fresh={fresh} />}
          <p className="text-[11px] font-medium uppercase tracking-wide text-accent">{heading}</p>
          <FreshBadges fresh={fresh} />
          {level && (
            <p className={fresh.length ? "text-[12px] text-muted" : "text-[20px] font-semibold text-ink"}>
              Level {level.level} · {level.title}
            </p>
          )}
          <div className="mt-1 flex gap-2">
            <button onClick={onProfile} className="rounded-md border border-line-strong px-3 py-1.5 text-[12px] text-ink hover:bg-sunken">
              See your profile
            </button>
            <button autoFocus onClick={onClose} className="rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-on-accent">
              Nice!
            </button>
          </div>
        </div>
      </Modal>
      {confetti && <Confetti onDone={() => setConfetti(false)} />}
    </>
  );
}

// The rank's picture with the episode and its line crawling up over the bottom, the way an opening crawl does, read
// aloud by the narrator unless you muted Weft's voice (the same 🔊 as the welcome and the feature intros). A
// picture that fails to load leaves the words on the dark backdrop; a clip that fails just stays silent.
function LevelHero({ lore }: { lore: Lore }) {
  const [art, setArt] = useState(true);
  const [muted, setMuted] = useState(readMuted);
  const [player] = useState(() => new VoicePlayer());
  useEffect(() => {
    if (!readMuted()) player.play(lore.voice);
    return () => player.stop();
  }, [player, lore.voice]);
  const toggleMuted = () => {
    writeMuted(!muted);
    player.setMuted(!muted);
    setMuted(!muted);
  };
  return (
    <div className="relative aspect-video max-h-[60vh] w-full shrink-0 overflow-hidden bg-[#0b0a12]">
      {art && (
        <img src={lore.art} alt="" onError={() => setArt(false)} className="level-hero-art absolute inset-0 h-full w-full object-cover" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />
      <button
        type="button"
        onClick={toggleMuted}
        aria-label={muted ? "Unmute the voice" : "Mute the voice"}
        className="absolute right-2.5 top-2.5 rounded-md bg-black/55 px-1.5 py-0.5 text-[12px] text-white hover:bg-black/75"
      >
        {muted ? "🔇" : "🔊"}
      </button>
      <div className="level-crawl absolute inset-x-10 bottom-5 text-center">
        <p className="text-[13px] font-semibold uppercase tracking-[0.35em] text-[#ffd76a]">{lore.episode}</p>
        <p className="mt-2 text-[19px] font-medium leading-snug text-[#ffeab0]">{lore.line}</p>
      </div>
    </div>
  );
}

// The big icon over the heading: the one badge's own, a medal for several, an arrow for a level-up with no picture.
function BadgeIcon({ fresh }: { fresh: Badge[] }) {
  const [only] = fresh;
  const icon = fresh.length === 1 && only ? only.icon : fresh.length ? "🏅" : "⬆️";
  return (
    <span className="achievement-pop flex h-20 w-20 items-center justify-center rounded-full bg-accent-soft text-[44px] leading-none">
      {icon}
    </span>
  );
}

// One badge gets its name and what earned it; several share a list of five, then "and N more".
function FreshBadges({ fresh }: { fresh: Badge[] }) {
  const [only] = fresh;
  if (!only) return null;
  if (fresh.length === 1)
    return (
      <div className="flex flex-col gap-1">
        <h2 className="text-[17px] font-semibold text-ink">{only.name}</h2>
        <p className="text-[12.5px] text-muted">{only.desc}</p>
      </div>
    );
  return (
    <ul className="flex w-full flex-col gap-1.5 text-left">
      {fresh.slice(0, 5).map((b) => (
        <li key={b.id} className="flex items-center gap-2.5 rounded-lg border border-line px-2.5 py-1.5">
          <span className="text-[20px] leading-none">{b.icon}</span>
          <span className="flex min-w-0 flex-col">
            <span className="text-[12.5px] font-medium text-ink">{b.name}</span>
            <span className="truncate text-[11px] text-muted">{b.desc}</span>
          </span>
        </li>
      ))}
      {fresh.length > 5 && <li className="text-center text-[11.5px] text-muted">and {fresh.length - 5} more</li>}
    </ul>
  );
}
