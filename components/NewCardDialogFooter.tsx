"use client";

// The New thread dialog's footer: the busy-folder / error / started status line, the
// Add-to-backlog button, and the Start button. Extracted from NewCardDialog.tsx so the dialog
// body can stay focused on its own state.

import { useUiText } from "@/lib/ui-language";
import { startButton } from "@/lib/new-thread";
import type { Card } from "@/lib/types";
import { formatAt } from "@/lib/schedule";
import { alsoHereLine } from "@/lib/overlap";
import type { Backend } from "@/lib/types";
import type { NewCardTransport } from "@/lib/new-card-transport";
import Icon, { Spinner } from "./Icon";
import StatusStrip from "./StatusStrip";

export function NewCardDialogFooter({
  error,
  alsoHere,
  started,
  busy,
  startBtn,
  // When this thread can't start yet: the reset it waits for (lib/start-gate.ts).
  waitsUntil,
  waitsFor,
  canBacklog = true,
  minimal = false,
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
  // false where the place can't hold a card in Backlog (a worker's start when they're made).
  canBacklog?: boolean;
  // Simple mode's one-box dialog: just the error (or the wait) and Start; no Backlog, no hints.
  minimal?: boolean;
  onSubmit: (start: boolean) => void;
}) {
  const t = useUiText();
  // The button names what it does: start now, or start when the window opens.
  const label = waitsUntil ? `${t("Start at")} ${formatAt(waitsUntil)}` : t(startBtn.label);
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-end gap-x-3 gap-y-2 px-5 pb-4 pt-3">
      <p className="min-w-0 flex-1 basis-24 truncate text-[12px]">
        {error ? (
          <span className="text-danger">{error}</span>
        ) : waitsUntil ? (
          <span className="text-warn" title="This thread waits for the window to open, then runs on its own.">
            {waitsFor ?? "At its limit"} · starts at {formatAt(waitsUntil)}
          </span>
        ) : minimal ? null : alsoHere.length > 0 ? (
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
      <BacklogButton shown={!minimal} busy={busy} canBacklog={canBacklog} onAdd={() => onSubmit(false)} />
      <button
        onClick={() => onSubmit(true)}
        disabled={!!busy}
        className="flex shrink-0 items-center gap-1.5 rounded-md bg-accent px-3.5 py-1.5 text-[13px] font-medium text-on-accent hover:opacity-90 disabled:cursor-wait disabled:opacity-40 disabled:saturate-0"
      >
        {busy === "start" ? (
          <>
            <Spinner size={12} />
            {t("Starting…")}
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

// Under the footer: the board's footer sits under this dialog, so its folder and plan limits show here instead (or,
// on weft.zip, its note). Left out in simple mode's one-box dialog (shown false).
export function DialogStatus({ shown, host, cwd, backend }: { shown: boolean; host: NewCardTransport; cwd: string; backend: Backend }) {
  if (!shown) return null;
  return host.local ? (
    <StatusStrip cwd={cwd} backend={backend} className="shrink-0 border-t border-line px-5 py-1.5" />
  ) : (
    <p className="shrink-0 border-t border-line px-5 py-1.5 text-[11.5px] text-faint">{host.note}</p>
  );
}

// Add to backlog (⌘B), left out of simple mode's one-box dialog, where ⌘B still does it.
function BacklogButton({ shown, busy, canBacklog, onAdd }: { shown: boolean; busy: false | "start" | "backlog"; canBacklog: boolean; onAdd: () => void }) {
  const t = useUiText();
  if (!shown) return null;
  return (
    <button
      onClick={onAdd}
      disabled={!!busy || !canBacklog}
      title={canBacklog ? undefined : t("A worker has no Backlog yet: its threads start when they're made.")}
      className="flex shrink-0 items-center gap-1.5 rounded-md border border-line-strong px-3 py-1.5 text-[13px] text-ink hover:bg-sunken disabled:cursor-wait disabled:opacity-40 disabled:hover:bg-transparent"
    >
      {busy === "backlog" && <Spinner size={12} />}
      {busy === "backlog" ? t("Adding…") : t("Add to backlog")}
      {busy !== "backlog" && (
        <kbd aria-hidden="true" className="font-sans opacity-60">
          ⌘B
        </kbd>
      )}
    </button>
  );
}
