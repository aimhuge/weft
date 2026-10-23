"use client";

import { useEffect, useState, type RefObject } from "react";
import { beatFrom, stepVoice, voiceFor, type Beat } from "./welcome-loop";
import { readMuted, VoicePlayer, writeMuted } from "./welcome-voice";

// The welcome tour's side of its iframe (components/WelcomeLoop.tsx): which beat the page says is on screen, the
// voiceover that starts with each page (on by default, mutable), and your name sent to the profile beat once you're
// signed in. Messages count only from this iframe's own window.
export function useWelcomeTour(frame: RefObject<HTMLIFrameElement | null>, who: { name: string; avatar: string | null } | null) {
  const [beat, setBeat] = useState<Beat>("intro");
  const [muted, setMuted] = useState(readMuted);
  const [player] = useState(() => new VoicePlayer());

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      const next = beatFrom(e.data);
      if (!next) return;
      setBeat(next);
      const track = voiceFor(next);
      if (track) player.play(track);
    };
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      player.stop();
    };
  }, [frame, player]);

  useEffect(() => {
    player.setMuted(muted);
    writeMuted(muted);
  }, [player, muted]);

  // Each time beats.html loads (its first beat is tools) or you sign in, it gets your name for the profile beat.
  const name = who?.name ?? null;
  const avatar = who?.avatar ?? null;
  useEffect(() => {
    if (!name || (beat !== "tools" && beat !== "profile")) return;
    frame.current?.contentWindow?.postMessage({ weft: "who", name, avatar }, "*");
  }, [frame, beat, name, avatar]);

  return { beat, muted, toggleMuted: () => setMuted((m) => !m) };
}

// The welcome's later steps speak as they open (components/WelcomeDialog.tsx): "Allow Weft to see your projects.",
// "Now start a new thread.", unless you muted the tour.
export function useStepVoice(step: string) {
  const [player] = useState(() => new VoicePlayer());
  useEffect(() => {
    const track = stepVoice(step);
    if (!track || readMuted()) return;
    player.play(track);
    return () => player.stop();
  }, [player, step]);
}
