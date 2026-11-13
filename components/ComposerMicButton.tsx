// The Composer's mic button: a pulse while recording, a spinner while transcribing, and the
// elapsed time in monospace so it doesn't shift the rest of the bar. In the desktop app it starts the floating pill
// (lib/use-desktop-dictation.ts), which also listens for the same key in every other app.
import type { useDictation } from "@/lib/use-dictation";
import { currentBinding, formatBinding } from "@/lib/shortcuts";
import Icon, { Spinner } from "./Icon";
import Tip from "./Tip";

function seconds(total: number) {
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export default function ComposerMicButton({ dictation }: { dictation: ReturnType<typeof useDictation> }) {
  const { state, level, seconds: elapsed, opening } = dictation;
  const recording = state === "recording";
  const tip = recording
    ? "Stop and insert the text (Esc cancels)"
    : `Dictate (${formatBinding(currentBinding("dictation"))})${typeof window !== "undefined" && window.weft?.dictation ? " · works in any app" : ""}`;
  return (
    <Tip text={tip} className="inline-flex">
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={dictation.toggle}
        disabled={state === "transcribing"}
        aria-label={recording ? "Stop dictation" : "Dictate"}
        aria-pressed={recording}
        className={`relative flex items-center gap-1.5 rounded-full px-2 py-1.5 text-[12px] ${
          recording ? "bg-danger text-white" : "text-muted hover:bg-sunken hover:text-ink"
        } disabled:opacity-60`}
      >
        {recording && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 rounded-full bg-danger/40 transition-transform duration-75"
            style={{ transform: `scale(${1 + level * 0.45})` }}
          />
        )}
        <span className="relative flex items-center gap-1.5">
          {state === "transcribing" ? <Spinner size={12} /> : <Icon name={recording ? "stop" : "mic"} size={14} />}
          {recording && <span className="tabular-nums">{opening ? "Opening mic…" : seconds(elapsed)}</span>}
          {state === "transcribing" && <span>Transcribing…</span>}
        </span>
      </button>
    </Tip>
  );
}
