"use client";

import { useEffect, useState, type RefObject } from "react";
import { trackOnboarding } from "./telemetry-client";
import { beatMessage, goMessage, pageVoice, stepVoice, voiceFor, type Beat } from "./welcome-loop";
import { readMuted, VoicePlayer, writeMuted } from "./welcome-voice";

// The welcome tour's side of its iframe (components/WelcomeLoop.tsx): which beat the page says is on screen, the
// voiceover that starts with each page and follows a jump (on by default, mutable), going to a beat, and your name
// sent to the profile beat once you're signed in. Messages count only from this iframe's own window.
// How the tour bar moved you: Back, Next, or a tap on a beat's segment.
export type TourNav = "back" | "next" | "jump";

export function useWelcomeTour(frame: RefObject<HTMLIFrameElement | null>, who: { name: string; avatar: string | null } | null) {
  const [beat, setBeat] = useState<Beat>("intro");
  const [muted, setMuted] = useState(readMuted);
  const [player] = useState(() => new VoicePlayer());
  // Each beat counts once per showing, with the seconds since the tour began (anonymous stats, lib/telemetry.ts).
  const [seen] = useState(() => ({ current: { at: Date.now(), beats: new Set<Beat>() } }));

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      const message = beatMessage(e.data);
      if (!message) return;
      const next = message.beat;
      setBeat(next);
      if (!seen.current.beats.has(next)) {
        seen.current.beats.add(next);
        trackOnboarding("onboarding_tour_beat", { beat: next, seconds: Math.round((Date.now() - seen.current.at) / 1000), jumped: message.jumped });
      }
      // A jump picks the page's voiceover up where the page now is; playing on starts each page's track as it opens.
      if (message.jumped) player.play(pageVoice(next), message.t);
      else {
        const track = voiceFor(next);
        if (track) player.play(track);
      }
    };
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      player.stop();
    };
  }, [frame, player, seen]);

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

  const toggleMuted = () => {
    trackOnboarding("onboarding_narration_muted", { muted: !muted, beat });
    setMuted(!muted);
  };
  // Back, Next or a tap on the tour bar: the page seeks there, or loads the beat's page (public/welcome/live.js). The bar
  // moves at once, so a second click steps on from there even while a page is still loading; the page then confirms.
  const go = (to: Beat, action: TourNav = "jump") => {
    trackOnboarding("onboarding_tour_nav", { action, from: beat, to });
    setBeat(to);
    frame.current?.contentWindow?.postMessage(goMessage(to), "*");
  };
  return { beat, muted, toggleMuted, go };
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
