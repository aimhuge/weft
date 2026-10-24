"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { removeNow } from "@/lib/optimistic-cards";
import { modelLabel } from "@/lib/new-thread";
import { rememberPage } from "@/lib/settings-nav";
import type { Card } from "@/lib/types";
import { firstMessageFailed } from "@/lib/first-message-failed";
import type { ThreadItem } from "@/lib/types";
import Icon from "./Icon";

// The error banner on the open thread, but only when the *first* message of the card came
// back with an error (lib/first-message-failed.ts). A rerun on a different model would
// burn the same tokens and probably hit the same wall; the banner offers two real
// escapes instead: delete the failed card, or rerun it on the backup model set under
// Settings → Models. We read the backup model from the settings endpoint here so the
// banner is self-contained — only when the predicate is true does the fetch run, so a
// healthy thread never hits /api/settings from the banner.
//
// The "Pick a backup model" button calls openSettings — the board-level opener from
// components/Board.tsx — only when the parent supplies it. Without it (the read-only web
// board) the banner stays put and the user has to open Settings themselves.

const STYLE_BANNER =
  "flex flex-wrap items-center gap-2 rounded-md bg-danger-soft px-3 py-2 font-mono text-[12px] text-danger";
const STYLE_PRIMARY =
  "rounded-md bg-accent px-2.5 py-1 text-[12px] font-medium text-on-accent hover:opacity-90 disabled:opacity-50";
const STYLE_DESTRUCTIVE =
  "rounded-md border border-line-strong px-2.5 py-1 text-[12px] text-danger hover:bg-danger-soft disabled:opacity-50";

export default function FirstMessageErrorBanner({
  card,
  items,
  openSettings,
  onDeleted,
}: {
  card: Card;
  items: readonly (ThreadItem | null | undefined)[];
  // Board-side: opens Settings → Models when the user has no backup configured.
  // The web board leaves this undefined; the rerun button hides the "Pick a backup model" path.
  openSettings?: () => void;
  // After Delete, the board's open card needs to clear its selection. Optional
  // (the board passes one when it knows what's open; the banner still deletes).
  onDeleted?: () => void;
}) {
  const [backupModel, setBackupModel] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "rerun" | "delete">(null);
  const [error, setError] = useState<string | null>(null);
  // Only fetch the settings when this banner is going to render. The predicate is
  // re-evaluated each render, so the effect skips cleanly on a healthy thread.
  const visible = firstMessageFailed(card, items);
  useEffect(() => {
    if (!visible || backupModel !== null) return;
    let ignore = false;
    api
      .settings()
      .then((s) => {
        if (!ignore) setBackupModel(s.backupModel);
      })
      .catch(() => {
        if (!ignore) setBackupModel("");
      });
    return () => {
      ignore = true;
    };
  }, [visible, backupModel]);
  if (!visible) return null;

  const rerun = async () => {
    if (!backupModel) {
      // "Off" — open Settings → Models on the backup row, then the user picks one and we rerun.
      rememberPage("models");
      openSettings?.();
      return;
    }
    setBusy("rerun");
    setError(null);
    try {
      await api.rerunModel(card.id, backupModel);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const del = async () => {
    setBusy("delete");
    setError(null);
    try {
      await removeNow(card.id);
      onDeleted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(null);
    }
  };

  const label = backupModel ? `Rerun on ${modelLabel(backupModel)}` : "Pick a backup model";

  return (
    <div className={STYLE_BANNER} data-testid="first-message-error-banner">
      <Icon name="alert" size={12} className="shrink-0" />
      <span className="min-w-0 flex-1 break-words">{card.error}</span>
      <div className="flex shrink-0 items-center gap-1.5">
        <button onClick={() => void rerun()} disabled={busy !== null} className={STYLE_PRIMARY}>
          {label}
        </button>
        <button onClick={() => void del()} disabled={busy !== null} aria-label="Delete this card" className={STYLE_DESTRUCTIVE}>
          <Icon name="trash" size={12} />
        </button>
      </div>
      {error && <span className="basis-full text-[11.5px] text-danger">{error}</span>}
    </div>
  );
}

