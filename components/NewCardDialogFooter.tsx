"use client";

// The New thread dialog's footer: the busy-folder / error / started status line, the
// Add-to-backlog button, and the Start button. Extracted from NewCardDialog.tsx so the dialog
// body can stay focused on its own state.

import { startButton } from "@/lib/new-thread";
import type { Card } from "@/lib/types";
import { formatAt } from "@/lib/schedule";
import { alsoHereLine } from "@/lib/overlap";
import Icon, { Spinner } from "./Icon";

export function NewCardDialogFooter({
  error,
  alsoHere,
  started,
  busy,
  startBtn,
  // When this thread can't start yet: the reset it waits for (lib/start-gate.ts).
  waitsUntil,
  waitsFor,
  onSubmit,
}: {
  error: string | null;
  alsoHere: Card[];
  started: string | null;
  busy: false | "start" | "backlog";
  startBtn: ReturnType<typeof startButton>;
  // The reset time (unix ms) this thread waits for, and why it waits.
  waitsUntil?: number;
  waitsFor?: string;
  onSubmit: (start: boolean) => void;
}) {
  // The button names what it does: start now, or start when the window opens.
  const label = waitsUntil ? `Start at ${formatAt(waitsUntil)}` : startBtn.label;
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-end gap-x-3 gap-y-2 px-5 pb-4 pt-3">
      <p className="min-w-0 flex-1 basis-24 truncate text-[12px]">
        {error ? (
          <span className="text-danger">{error}</span>
        ) : waitsUntil ? (
          <span className="text-warn" title="This thread waits for the window to open, then runs on its own.">
            {waitsFor ?? "At its limit"} · starts at {formatAt(waitsUntil)}
          </span>
        ) : alsoHere.length > 0 ? (
          <span
            className="flex min-w-0 items-center gap-1.5 text-warn"
            title={`These threads share this folder's working tree:\n${alsoHere.map((c) => c.title).join("\n")}`}
          >
            <Icon name="alert" size={12} className="shrink-0" />
            <span className="truncate">{alsoHereLine(alsoHere)}</span>
          </span>
        ) : started ? (
          <span className="text-muted">
            Started &ldquo;{started}&rdquo; · write the next one
          </span>
        ) : (
          <span className="text-faint">
            <kbd className="font-sans">⌘↵</kbd> starts it ·{" "}
            <kbd className="font-sans">⌃↵</kbd> starts it and stays open
          </span>
        )}
      </p>
      <button
        onClick={() => onSubmit(false)}
        disabled={!!busy}
        className="flex shrink-0 items-center gap-1.5 rounded-md border border-line-strong px-3 py-1.5 text-[13px] text-ink hover:bg-sunken disabled:cursor-wait disabled:opacity-40 disabled:hover:bg-transparent"
      >
        {busy === "backlog" && <Spinner size={12} />}
        {busy === "backlog" ? "Adding…" : "Add to backlog"}
        {busy !== "backlog" && (
          <kbd aria-hidden="true" className="font-sans opacity-60">
            ⌘B
          </kbd>
        )}
      </button>
      <button
        onClick={() => onSubmit(true)}
        disabled={!!busy}
        className="flex shrink-0 items-center gap-1.5 rounded-md bg-accent px-3.5 py-1.5 text-[13px] font-medium text-on-accent hover:opacity-90 disabled:cursor-wait disabled:opacity-40 disabled:saturate-0"
      >
        {busy === "start" ? (
          <>
            <Spinner size={12} />
            Starting…
          </>
        ) : (
          <>
            {label}
            <kbd aria-hidden="true" className="font-sans font-normal opacity-60">
              {startBtn.key}
            </kbd>
          </>
        )}
      </button>
    </div>
  );
}
