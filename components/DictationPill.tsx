"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import type { PillDelivery } from "@/lib/client";
import { playDictationChime } from "@/lib/dictation-chimes";
import { useDictation } from "@/lib/use-dictation";
import Icon, { Spinner, type IconName } from "./Icon";

// The floating dictation pill (app/dictate), in its own always-on-top window above every app
// (electron/dictation-helper.cjs). The same red pill as the composer's mic button: a stop square, the time, and a
// pulse with your voice. Main sends "toggle" (the shortcut, the composer's mic) or "cancel" (Esc); the pill records,
// hands the text to main, says where it went for a moment, and asks to be hidden.

const SAID: Record<PillDelivery, { icon: IconName; text: string }> = {
  inserted: { icon: "check", text: "Pasted" },
  pasted: { icon: "check", text: "Pasted" },
  copied: { icon: "copy", text: "Copied" },
  "no-access": { icon: "copy", text: "Copied · allow Accessibility to paste" },
};

// How long the last word stays up before the pill goes away.
export const FLASH_MS = 1100;
export const ERROR_MS = 3500;
// Level updates to main (and so the board's mic button) at most this often.
const LEVEL_MS = 100;

function clock(total: number) {
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export default function DictationPill() {
  const [said, setSaid] = useState<PillDelivery | null>(null);
  // Text handed to main that hasn't come back yet: the pill stays up until it has.
  const [sending, setSending] = useState(false);
  const sounds = useRef(true);
  // Whether this pill has been asked to do anything since it was last hidden; a fresh page stays quiet.
  const [active, setActive] = useState(false);
  const dictation = useDictation((text) => {
    setSending(true);
    // Without the bridge (the page opened on its own) there's nobody to take it, and nothing to say.
    void Promise.resolve(window.weftPill?.text(text) ?? null)
      .then(setSaid)
      .catch(() => setSaid("copied"))
      .finally(() => setSending(false));
  });
  const { state, seconds, level, error } = dictation;

  // The window is transparent: only the pill shows.
  useEffect(() => {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    api
      .dictationSettings()
      .then((v) => (sounds.current = v.prefs.sounds))
      .catch(() => {});
  }, []);

  const commands = useRef(dictation);
  useEffect(() => {
    commands.current = dictation;
  });
  useEffect(
    () =>
      window.weftPill?.onCommand((command) => {
        setActive(true);
        setSaid(null);
        if (command === "cancel") commands.current.cancel();
        else commands.current.toggle();
      }),
    [],
  );

  // A chime as the mic opens and as it stops.
  const was = useRef(state);
  useEffect(() => {
    if (sounds.current && state !== was.current) {
      if (state === "recording") playDictationChime("start");
      else if (was.current === "recording") playDictationChime("stop");
    }
    was.current = state;
  }, [state]);

  // State and time on every change; loudness ten times a second.
  const lastSent = useRef(0);
  const lastKey = useRef("");
  useEffect(() => {
    const key = `${state}:${seconds}`;
    const now = Date.now();
    if (key === lastKey.current && now - lastSent.current < LEVEL_MS) return;
    lastKey.current = key;
    lastSent.current = now;
    window.weftPill?.state({ state, seconds, level });
  }, [state, seconds, level]);

  // Once it's idle with nothing left to say, the pill goes away.
  useEffect(() => {
    if (!active || state !== "idle" || sending) return;
    const wait = error ? ERROR_MS : said ? FLASH_MS : 0;
    const timer = setTimeout(() => {
      setActive(false);
      setSaid(null);
      commands.current.clearError();
      window.weftPill?.hide();
    }, wait);
    return () => clearTimeout(timer);
  }, [active, state, sending, said, error]);

  const recording = state === "recording";
  const busy = state === "transcribing" || sending;
  const done = state === "idle" && !sending && said ? SAID[said] : null;
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-transparent p-2">
      {recording ? (
        <button
          type="button"
          onClick={dictation.toggle}
          aria-label="Stop dictation"
          title="Stop and paste (Esc cancels)"
          className="relative flex items-center gap-2 rounded-full bg-danger px-4 py-2 text-[14px] text-white shadow-lg"
        >
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 rounded-full bg-danger/40 transition-transform duration-75"
            style={{ transform: `scale(${1 + level * 0.45})` }}
          />
          <span className="relative flex items-center gap-2">
            <Icon name="stop" size={14} />
            <span className="font-mono tabular-nums">{clock(seconds)}</span>
          </span>
        </button>
      ) : busy ? (
        <Bubble>
          <Spinner size={13} />
          <span>Transcribing…</span>
        </Bubble>
      ) : error && active ? (
        <Bubble tone="text-danger" title={error}>
          <Icon name="alert" size={14} />
          <span className="truncate">{error}</span>
        </Bubble>
      ) : done ? (
        <Bubble tone="text-ok">
          <Icon name={done.icon} size={14} />
          <span className="truncate">{done.text}</span>
        </Bubble>
      ) : null}
    </div>
  );
}

function Bubble({ children, tone = "text-muted", title }: { children: React.ReactNode; tone?: string; title?: string }) {
  return (
    <div title={title} className={`flex max-w-full items-center gap-2 rounded-full border border-line bg-panel px-4 py-2 text-[13px] shadow-lg ${tone}`}>
      {children}
    </div>
  );
}
