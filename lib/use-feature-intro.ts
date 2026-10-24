"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { introEvent, introSrc, loadSeenIntros, markIntroSeen, muteMessage, REPLAY_MESSAGE, type IntroId } from "./feature-intros";
import { readMuted, writeMuted } from "./welcome-voice";

// When a feature intro shows (lib/feature-intros.ts): the first time its drawer or dialog opens, unless you've seen it
// or asked for reduced motion; again whenever you press ▶. It's seen once it plays to the end or you hide it. The page
// plays its own voiceover (public/intros/player.js), so a busy board can't start it late; this only hands it the
// welcome tour's 🔊 setting, in its address when it loads and as a message when you flip it. Messages count only from
// this intro's own iframe.

export const prefersStill = () => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

// `muted` is the 🔊 setting as this showing loaded, kept so a flip messages the page instead of reloading it.
type Showing = { id: IntroId | null; open: boolean; ended: boolean; run: number; muted: boolean };

export function useFeatureIntro(id: IntroId | null) {
  const [muted, setMuted] = useState(readMuted);
  const [showing, setShowing] = useState<Showing>({ id: null, open: false, ended: false, run: 0, muted });
  // A new drawer or dialog: its intro opens on its own the first time.
  if (showing.id !== id) setShowing({ id, open: !!id && !loadSeenIntros().has(id) && !prefersStill(), ended: false, run: 0, muted });

  const frame = useRef<HTMLIFrameElement>(null);
  // The iframe's ref is handed over through attach() rather than returned, so no consumer reads a ref while it
  // renders (which the react-hooks/refs rule rightly refuses).
  const attach = useCallback((node: HTMLIFrameElement | null) => {
    frame.current = node;
  }, []);

  useEffect(() => {
    if (!id || !showing.open) return;
    const onMessage = (e: MessageEvent) => {
      const own = frame.current?.contentWindow;
      if (!own || e.source !== own) return;
      const event = introEvent(e.data);
      if (event === "start") {
        setShowing((s) => ({ ...s, ended: false }));
      } else if (event === "done") {
        markIntroSeen(id);
        setShowing((s) => ({ ...s, ended: true }));
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [id, showing.open]);

  const toggleMuted = () => {
    setMuted(!muted);
    writeMuted(!muted);
    frame.current?.contentWindow?.postMessage(muteMessage(!muted), "*");
  };

  // ▶ opens it again (a fresh iframe plays from the top); Replay on an open one asks the page to start over.
  const play = () => {
    if (showing.open) frame.current?.contentWindow?.postMessage(REPLAY_MESSAGE, "*");
    else setShowing((s) => ({ ...s, open: true, ended: false, run: s.run + 1, muted }));
  };
  // Hiding unmounts the frame, which stops its voice with it.
  const hide = () => {
    if (id) markIntroSeen(id);
    setShowing((s) => ({ ...s, open: false }));
  };
  const src = id ? introSrc(id, showing.muted) : "";
  return { id, open: showing.open, ended: showing.ended, run: showing.run, src, attach, muted, toggleMuted, play, hide };
}

export type FeatureIntroState = ReturnType<typeof useFeatureIntro>;
