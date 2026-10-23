"use client";

import type { RefObject } from "react";

// The welcome's footer (components/WelcomeDialog.tsx): a one-line note on the left, the step's buttons on the right,
// the primary holding the ref ↵ presses.

export type WelcomeStep = "ready" | "projects" | "first";

export function welcomeNote(step: WelcomeStep, cliReady: boolean | null, cwd: string): string {
  if (step === "ready") return cliReady === false ? "You can log in later from Settings → Accounts." : "Replay this any time from your avatar's menu or the command palette.";
  if (step === "projects") return "Start empty leaves your old sessions off the board. Bring them in later from Settings.";
  return cwd ? "The board explains each column the first time a card reaches it." : "Pick the folder in the next dialog.";
}

const button = "rounded-md border border-line px-3 py-1.5 text-[12.5px] text-ink hover:bg-sunken disabled:opacity-40";
const primary = "rounded-md bg-accent px-4 py-1.5 text-[12.5px] font-semibold text-on-accent ring-2 ring-accent/30 disabled:opacity-40";

export function WelcomeFooter({
  step,
  note,
  busy,
  okRef,
  bringing,
  cwd,
  canStart,
  onNext,
  onAnswer,
  onSkip,
  onStart,
}: {
  step: WelcomeStep;
  note: string;
  busy: boolean;
  okRef: RefObject<HTMLButtonElement | null>;
  // How many projects come in on the projects screen's primary.
  bringing: number;
  cwd: string;
  canStart: boolean;
  onNext: () => void;
  onAnswer: (fresh: boolean) => void;
  onSkip: () => void;
  onStart: () => void;
}) {
  return (
    <div className="flex items-center gap-3 border-t border-line px-5 py-3">
      <span className="flex-1 text-[11.5px] text-muted">{note}</span>
      <span className="flex shrink-0 gap-2">
        {step === "ready" && (
          <button type="button" ref={okRef} className={primary} disabled={busy} onClick={onNext}>
            Next ↵
          </button>
        )}
        {step === "projects" && (
          <>
            <button type="button" className={button} disabled={busy} onClick={() => onAnswer(true)}>
              Start empty
            </button>
            <button type="button" ref={okRef} className={primary} disabled={busy} onClick={() => onAnswer(false)}>
              Bring in {bringing} ↵
            </button>
          </>
        )}
        {step === "first" && (
          <>
            <button type="button" className={button} disabled={busy} onClick={onSkip}>
              Skip
            </button>
            <button type="button" ref={okRef} className={primary} disabled={busy || !canStart} onClick={onStart}>
              {cwd ? "Start thread ⌘↵" : "Choose a folder ⌘↵"}
            </button>
          </>
        )}
      </span>
    </div>
  );
}
