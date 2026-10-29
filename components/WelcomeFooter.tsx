"use client";

import type { RefObject } from "react";
import Icon from "./Icon";

// The welcome's footer (components/WelcomeDialog.tsx): a one-line note on the left, the step's buttons on the right,
// the primary holding the ref ↵ presses. The bar above it says which step is on screen; a replay has no steps to count,
// so it says what it saves and offers the ✕ any dialog has.

export type WelcomeStep = "ready" | "account" | "projects" | "first";

// The steps in order: sign-in only when it's needed (components/WelcomeAccount.tsx), the projects only with history.
export const welcomeSteps = (signIn: boolean, history: boolean): WelcomeStep[] => [
  "ready",
  ...(signIn ? (["account"] as const) : []),
  ...(history ? (["projects"] as const) : []),
  "first",
];

export function welcomeNote(step: WelcomeStep, cliReady: boolean | null, cwd: string): string {
  if (step === "ready") return cliReady === false ? "You can log in later from Settings → Accounts." : "Replay this any time from your avatar's menu or the command palette.";
  if (step === "account") return "Sign in opens GitHub in your browser, then brings you back here. You can skip it for now.";
  if (step === "projects") return "Start empty leaves your old sessions off the board. Bring them in later from Settings.";
  return cwd ? "It lands in Running and the browser pane shows its work." : "Pick the folder in the next dialog.";
}

const button = "rounded-md border border-line px-3 py-1.5 text-[12.5px] text-ink hover:bg-sunken disabled:opacity-40";
const primary = "rounded-md bg-accent px-4 py-1.5 text-[12.5px] font-semibold text-on-accent ring-2 ring-accent/30 disabled:opacity-40";

// The bar above the steps: "Step 2 of 3" with a dot per step, or the replay's "saves nothing" and its ✕. A first launch
// gets no ✕ — nothing is remembered if you drift off it — but a replay does, since you opened it and can just shut it.
export function WelcomeStepBar({ steps, step, replay, onDismiss }: { steps: WelcomeStep[]; step: WelcomeStep; replay: boolean; onDismiss: () => void }) {
  const at = `Step ${steps.indexOf(step) + 1} of ${steps.length}`;
  return (
    <div className="flex items-center justify-between border-b border-line px-5 py-2.5 text-[12px] text-muted">
      <span>{replay ? "Replay · saves nothing" : at}</span>
      <span className="flex items-center gap-2.5">
        <span className="flex gap-1.5" aria-label={at}>
          {steps.map((s) => (
            <span key={s} className={`h-1.5 rounded-full transition-all ${step === s ? "w-4 bg-accent" : "w-1.5 bg-line"}`} />
          ))}
        </span>
        {replay && (
          <button type="button" onClick={onDismiss} aria-label="Close" className="rounded-md p-0.5 text-muted hover:bg-sunken hover:text-ink">
            <Icon name="x" size={14} />
          </button>
        )}
      </span>
    </div>
  );
}

export function WelcomeFooter({
  step,
  note,
  busy,
  okRef,
  bringing,
  cwd,
  canStart,
  canNext = true,
  signedIn = false,
  onNext,
  onAnswer,
  onSkip,
  onStart,
  onDefer,
}: {
  step: WelcomeStep;
  note: string;
  busy: boolean;
  okRef: RefObject<HTMLButtonElement | null>;
  // How many projects come in on the projects screen's primary.
  bringing: number;
  cwd: string;
  canStart: boolean;
  // The sign-in screen's Next waits for you to be signed in.
  canNext?: boolean;
  // Whether the Weft account is signed in: the sign-in screen offers "Not now" only while it isn't.
  signedIn?: boolean;
  onNext: () => void;
  onAnswer: (fresh: boolean) => void;
  onSkip: () => void;
  onStart: () => void;
  // The sign-in screen's "Not now": past the step without an account.
  onDefer?: () => void;
}) {
  // The sign-in screen never blocks: "Not now" moves past it without an account.
  const deferrable = step === "account" && !signedIn && Boolean(onDefer);
  return (
    <div className="flex items-center gap-3 border-t border-line px-5 py-3">
      <span className="flex-1 text-[11.5px] text-muted">{note}</span>
      <span className="flex shrink-0 gap-2">
        {(step === "ready" || step === "account") && (
          <button type="button" ref={okRef} className={primary} disabled={busy || !canNext} onClick={onNext}>
            Next ↵
          </button>
        )}
        {deferrable && (
          <button type="button" className={button} disabled={busy} onClick={onDefer}>
            Not now
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
