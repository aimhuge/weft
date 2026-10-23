"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { introEvent, introVoice, loadSeenIntros, markIntroSeen, REPLAY_MESSAGE, type IntroId } from "./feature-intros";
import { readMuted, VoicePlayer, writeMuted } from "./welcome-voice";

// When a feature intro shows (lib/feature-intros.ts): the first time its drawer or dialog opens, unless you've seen it
// or asked for reduced motion; again whenever you press ▶. It's seen once it plays to the end or you hide it. Its
// voiceover starts as the page says it started, muted with the welcome tour's 🔊 setting. Messages count only from
// this intro's own iframe.

const prefersStill = () => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

type Showing = { id: IntroId | null; open: boolean; ended: boolean; run: number };

export function useFeatureIntro(id: IntroId | null) {
  const [showing, setShowing] = useState<Showing>({ id: null, open: false, ended: false, run: 0 });
  // A new drawer or dialog: its intro opens on its own the first time.
  if (showing.id !== id) setShowing({ id, open: !!id && !loadSeenIntros().has(id) && !prefersStill(), ended: false, run: 0 });

  const frame = useRef<HTMLIFrameElement>(null);
  const [player] = useState(() => new VoicePlayer());
  const [muted, setMuted] = useState(readMuted);
  // The iframe's ref is handed over through attach() rather than returned, so no consumer reads a ref while it
  // renders (which the react-hooks/refs rule rightly refuses).
  const attach = useCallback((node: HTMLIFrameElement | null) => {
    frame.current = node;
  }, []);

  useEffect(() => {
    if (!id || !showing.open) return;
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      const event = introEvent(e.data);
      if (event === "start") {
        player.play(introVoice(id));
        setShowing((s) => ({ ...s, ended: false }));
      } else if (event === "done") {
        markIntroSeen(id);
        setShowing((s) => ({ ...s, ended: true }));
      }
    };
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      player.stop();
    };
  }, [id, showing.open, player]);

  useEffect(() => {
    player.setMuted(muted);
    writeMuted(muted);
  }, [player, muted]);

  // ▶ opens it again (a fresh iframe plays from the top); Replay on an open one asks the page to start over.
  const play = () => {
    if (showing.open) frame.current?.contentWindow?.postMessage(REPLAY_MESSAGE, "*");
    else setShowing((s) => ({ ...s, open: true, ended: false, run: s.run + 1 }));
  };
  const hide = () => {
    if (id) markIntroSeen(id);
    player.stop();
    setShowing((s) => ({ ...s, open: false }));
  };
  return { id, open: showing.open, ended: showing.ended, run: showing.run, attach, muted, toggleMuted: () => setMuted(!muted), play, hide };
}

export type FeatureIntroState = ReturnType<typeof useFeatureIntro>;
