"use client";

// Voice mode's one wide bar (lib/voice-mode.ts), where the phone look's words field was: "Press Space to talk".
// Space or a click starts listening and the bar pulses with the mic's level; Space or a click again stops, and what was
// said goes out as the message; Esc drops it. A spinner shows while the words are transcribed. The bar is never
// disabled, so it keeps the focus (and the next Space) through a send.
import { forwardRef, type KeyboardEvent } from "react";
import type { useDictation } from "@/lib/use-dictation";
import { voiceKeyAction } from "@/lib/voice-mode";
import { Spinner } from "./Icon";

function clock(total: number) {
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

const VoiceBar = forwardRef<HTMLButtonElement, { recorder: ReturnType<typeof useDictation> }>(function VoiceBar({ recorder }, ref) {
  const { state, level, seconds, opening, error } = recorder;
  const recording = state === "recording";

  function onKeyDown(e: KeyboardEvent) {
    const action = voiceKeyAction(e.nativeEvent, state);
    if (!action) return;
    e.preventDefault();
    e.stopPropagation();
    if (action === "toggle") recorder.toggle();
    else if (action === "cancel") recorder.cancel();
  }

  return (
    <button
      ref={ref}
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => state !== "transcribing" && recorder.toggle()}
      onKeyDown={onKeyDown}
      // A button clicks itself on Space's keyup; the keydown already did the work.
      onKeyUp={(e) => e.key === " " && e.preventDefault()}
      aria-label={recording ? "Stop and send" : "Press Space to talk"}
      aria-pressed={recording}
      aria-busy={state === "transcribing"}
      className={`relative flex h-9 min-w-0 flex-1 items-center justify-center gap-2 overflow-hidden rounded-full px-3 text-[12.5px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-accent ${
        recording ? "bg-danger-soft text-danger" : "bg-sunken text-ink hover:bg-line"
      }`}
    >
      {recording && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-full bg-danger/15 transition-transform duration-75"
          style={{ transform: `scaleX(${0.6 + level * 0.4})` }}
        />
      )}
      <span className="relative flex min-w-0 items-center gap-2 truncate">
        {error ? (
          <span className="truncate text-danger">{error}</span>
        ) : state === "transcribing" ? (
          <>
            <Spinner size={12} /> Sending what you said…
          </>
        ) : recording ? (
          <>
            <span className="size-2 shrink-0 animate-pulse rounded-full bg-danger" />
            <span className="tabular-nums">{opening ? "Opening mic…" : clock(seconds)}</span>
            <span className="truncate">Space to send · Esc to cancel</span>
          </>
        ) : (
          "Press Space to talk"
        )}
      </span>
    </button>
  );
});

export default VoiceBar;
