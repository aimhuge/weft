"use client";

// The Composer's bottom row in the phone look (docs/architecture/simple-mode.md, piece 1), as the phone's composer
// draws it (~/dev/weft-mobile src/components/Composer.tsx): ＋ on the left opens the file picker, then on the right
// the mic (dictates into the field, as everywhere), 〰 for voice mode and the caller's round Send / Stop. In voice
// mode the middle is the wide VoiceBar and ⌨ stands where the mic and 〰 were.
import { useRef, type ReactNode, type RefObject } from "react";
import type { useDictation } from "@/lib/use-dictation";
import type { VoiceComposer } from "@/lib/use-voice-mode";
import ComposerMicButton from "./ComposerMicButton";
import Icon from "./Icon";
import Tip from "./Tip";
import VoiceBar from "./VoiceBar";

const ROUND = "flex size-8 shrink-0 items-center justify-center rounded-full text-muted hover:bg-sunken hover:text-ink";

// Voice mode, drawn as ChatGPT and the phone draw it: a few bars of a sound wave.
function WaveIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" aria-hidden="true">
      <path d="M2.5 7v2M5 5v6M8 3v10M11 5.5v5M13.5 7.2v1.6" />
    </svg>
  );
}

function KeyboardIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" aria-hidden="true">
      <rect x={1.5} y={4} width={13} height={8.5} rx={2} />
      <path d="M4.5 7h.01M7 7h.01M9.5 7h.01M12 7h.01M5.5 10h5" />
    </svg>
  );
}

function RoundButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <Tip text={label} className="inline-flex">
      <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onClick} aria-label={label} className={ROUND}>
        {children}
      </button>
    </Tip>
  );
}

export default function ComposerPhoneRow({
  dictation,
  voice,
  fileInput,
  focusText,
  actions,
}: {
  dictation: ReturnType<typeof useDictation>;
  voice: VoiceComposer;
  fileInput: RefObject<HTMLInputElement | null>;
  // Puts the caret back in the words field, after ⌨.
  focusText: () => void;
  actions?: ReactNode;
}) {
  const bar = useRef<HTMLButtonElement>(null);
  function switchTo(on: boolean) {
    voice.setOn(on);
    // The next Space talks (or types) without a click first.
    requestAnimationFrame(() => (on ? bar.current?.focus() : focusText()));
  }
  return (
    <div className="flex shrink-0 items-center gap-1 px-2 pb-2 pt-0.5">
      <RoundButton label="Attach images, videos, or files" onClick={() => fileInput.current?.click()}>
        <Icon name="plus" size={16} />
      </RoundButton>
      {voice.on ? (
        <>
          <VoiceBar ref={bar} recorder={voice.recorder} />
          <RoundButton label="Type instead" onClick={() => switchTo(false)}>
            <KeyboardIcon />
          </RoundButton>
        </>
      ) : (
        <>
          <span className="min-w-0 flex-1 truncate px-1.5 text-[11.5px]">
            {dictation.error && (
              <button type="button" onClick={dictation.clearError} className="text-danger" title="Dismiss">
                {dictation.error}
              </button>
            )}
          </span>
          <ComposerMicButton dictation={dictation} />
          <RoundButton label="Voice mode: Space to talk, Space to send" onClick={() => switchTo(true)}>
            <WaveIcon />
          </RoundButton>
        </>
      )}
      {actions}
    </div>
  );
}
