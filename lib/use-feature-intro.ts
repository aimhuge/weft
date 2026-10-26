"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "./api-client";
import { introEvent, introSrc, markIntroSeen, muteMessage, PAUSE_MESSAGE, REPLAY_MESSAGE, TOGGLE_MESSAGE, type IntroId } from "./feature-intros";
import { onIntroCovered } from "./intro-cover";
import { setIntroModal } from "./intro-modal";
import { useEscape } from "./use-escape";
import { readMuted, writeMuted } from "./welcome-voice";

// When a feature intro shows (lib/feature-intros.ts): only when you press ▶ beside its title. It never opens on its own,
// because a video whose voice starts unasked as a drawer opens is unwelcome; the New thread splash's tips point at them
// instead (lib/new-thread-tips.ts). It's seen once it plays to the end or you hide it. The page
// plays its own voiceover (public/intros/player.js), so a busy board can't start it late; this only hands it the
// welcome tour's 🔊 setting, in its address when it loads and as a message when you flip it. Messages count only from
// this intro's own iframe.
//
// It plays big first, in a modal three quarters of the window (expanded); closing that leaves it playing on in the
// drawer or dialog, the width of it, and ⤢ blows it up again. A click on the video pauses it and plays it on, and so
// does something coming over it (an achievement, the New thread dialog: lib/intro-cover.ts), until you click it.

// `muted` is the 🔊 setting as this showing loaded, kept so a flip messages the page instead of reloading it.
type Showing = { id: IntroId | null; open: boolean; ended: boolean; paused: boolean; expanded: boolean; run: number; muted: boolean };

export function useFeatureIntro(id: IntroId | null) {
  const [muted, setMuted] = useState(readMuted);
  const [showing, setShowing] = useState<Showing>({ id: null, open: false, ended: false, paused: false, expanded: false, run: 0, muted });
  // A new drawer or dialog starts with its intro shut; ▶ opens it. One with no video yet shows no ▶ beside its title.
  if (showing.id !== id) setShowing({ id, open: false, ended: false, paused: false, expanded: false, run: 0, muted });

  const frame = useRef<HTMLIFrameElement>(null);
  // The iframe's ref is handed over through attach() rather than returned, so no consumer reads a ref while it
  // renders (which the react-hooks/refs rule rightly refuses).
  const attach = useCallback((node: HTMLIFrameElement | null) => {
    frame.current = node;
  }, []);

  useEffect(() => {
    if (!id || !showing.open) return;
    // Whether the page says it is playing: only then does something coming over it pause it. The dialog it plays in
    // tells the intros it opened before the page has started, so that one never pauses it.
    let playing = false;
    const onMessage = (e: MessageEvent) => {
      const own = frame.current?.contentWindow;
      if (!own || e.source !== own) return;
      const event = introEvent(e.data);
      if (event) playing = event === "start" || event === "play";
      if (event === "start" || event === "play") {
        setShowing((s) => ({ ...s, ended: false, paused: false }));
      } else if (event === "pause") {
        setShowing((s) => ({ ...s, paused: true }));
      } else if (event === "done") {
        markIntroSeen(id);
        // Watched to the end: the Cinephile badge counts it (app/api/game POST). Best effort.
        void apiFetch("/api/game", { method: "POST", body: JSON.stringify({ intro: id }) }).catch(() => {});
        setShowing((s) => ({ ...s, ended: true }));
      }
    };
    window.addEventListener("message", onMessage);
    const offCover = onIntroCovered(() => {
      if (playing) frame.current?.contentWindow?.postMessage(PAUSE_MESSAGE, "*");
    });
    return () => {
      window.removeEventListener("message", onMessage);
      offCover();
    };
  }, [id, showing.open]);

  // The modal hides the native browser pane while it is up (lib/intro-modal.ts).
  const big = showing.open && showing.expanded;
  useEffect(() => {
    if (!big) return;
    setIntroModal(true);
    return () => setIntroModal(false);
  }, [big]);

  // Esc shrinks the modal back into its drawer or dialog: it is the newest layer, so the one under it stays open.
  useEscape(big, () => setShowing((s) => ({ ...s, expanded: false })));

  const toggleMuted = () => {
    setMuted(!muted);
    writeMuted(!muted);
    frame.current?.contentWindow?.postMessage(muteMessage(!muted), "*");
  };

  // ▶ opens it again, big (a fresh iframe plays from the top); Replay on an open one asks the page to start over.
  const play = () => {
    if (showing.open) frame.current?.contentWindow?.postMessage(REPLAY_MESSAGE, "*");
    else setShowing((s) => ({ ...s, open: true, ended: false, paused: false, expanded: true, run: s.run + 1, muted }));
  };
  // A click on the video: the page pauses or plays on, and says which back.
  const togglePlaying = () => frame.current?.contentWindow?.postMessage(TOGGLE_MESSAGE, "*");
  // The same iframe moves between the modal and the drawer by its styles alone, so it never reloads and plays on.
  const setExpanded = (expanded: boolean) => setShowing((s) => ({ ...s, expanded }));
  // Hiding unmounts the frame, which stops its voice with it.
  const hide = () => {
    if (id) markIntroSeen(id);
    setShowing((s) => ({ ...s, open: false }));
  };
  const src = id ? introSrc(id, showing.muted) : "";
  const { open, ended, paused, expanded, run } = showing;
  return { id, open, ended, paused, expanded, run, src, attach, muted, toggleMuted, play, togglePlaying, setExpanded, hide };
}

export type FeatureIntroState = ReturnType<typeof useFeatureIntro>;
