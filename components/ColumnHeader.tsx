"use client";

import { useState, type ReactNode } from "react";
import type { Column } from "@/lib/types";
import BacklogActions, { type BacklogLane } from "./BacklogActions";
import { FoldButton } from "./FoldedColumn";
import Icon from "./Icon";
import ReviewFilterChips, { type ReviewChips } from "./ReviewFilterChips";
import SprintsMenu from "./SprintsMenu";
import { SwitchAllButton } from "./switch-all-button";
import Tip from "./Tip";

// A column's name and count. Running and Needs you get "Switch all" to move their threads to the other CLI, once a thread hit its plan limit. Review gets the Errors and Restart filter chips (ReviewFilterChips), "Review all", which starts the commit walk-through card (lib/pile-review.ts), and "▶ Resume N" when turns there were cut off or failed (lib/card-resume.ts). Done also gets "Show N archived" and an archive-all button (Shift+E) for the cards it shows. Backlog's title drops its saved sprints, and it gets Save as sprint and an archive-all that asks first (BacklogActions).
export default function ColumnHeader({
  column,
  count,
  needsYou,
  archivedCount,
  showArchived,
  onToggleArchived,
  toArchive,
  archiveTip,
  onArchiveAll,
  resumeAll,
  onSwitchAll,
  onReviewAll,
  backlog,
  reviewFilter,
  onFold,
}: {
  column: { id: Column; label: string };
  count: number | null;
  needsYou: boolean;
  archivedCount: number;
  showArchived: boolean;
  onToggleArchived: () => void;
  toArchive: number;
  archiveTip: string;
  onArchiveAll: () => void;
  resumeAll?: { count: number; run: () => void };
  onSwitchAll?: () => void | Promise<void>;
  onReviewAll?: () => Promise<void>;
  backlog?: BacklogLane;
  reviewFilter?: ReviewChips;
  // Folds the column to a strip (components/FoldedColumn.tsx).
  onFold?: () => void;
}) {
  const done = column.id === "done";
  return (
    <div className="relative flex items-center justify-between px-3 pb-1.5 pt-2.5">
      <ColumnTitle label={column.label} needsYou={needsYou} backlog={backlog} />
      <span className="flex shrink-0 items-center gap-2 text-[11.5px] text-faint">
        {/* A narrow column (five columns on a small screen) keeps its actions as icons; one squeezed beside the
            open copilot lane keeps only its count and Archive all. */}
        <span className="flex items-center gap-2 @max-[150px]:hidden">
          {reviewFilter && <ReviewFilterChips chips={reviewFilter} />}
          {onSwitchAll && count ? <SwitchAllButton onClick={() => void onSwitchAll()} /> : null}
          {onReviewAll && count ? <ReviewAllButton onReviewAll={onReviewAll} /> : null}
          {resumeAll && (
            <Tip text={`Carry on the ${resumeAll.count} turn${resumeAll.count > 1 ? "s" : ""} here that a restart cut off or that failed`} className="inline-flex">
              <button onClick={resumeAll.run} aria-label={`Resume ${resumeAll.count}`} className="flex items-center gap-1 font-medium text-accent hover:opacity-80">
                <Icon name="play" size={10} />
                <Label>Resume</Label>
                {resumeAll.count}
              </button>
            </Tip>
          )}
          {done && archivedCount > 0 && (
            <button onClick={onToggleArchived} className="hover:text-ink @max-[230px]:hidden" aria-pressed={showArchived}>
              {showArchived ? "Hide" : "Show"} {archivedCount} archived
            </button>
          )}
        </span>
        {done && toArchive > 0 && (
          <Tip text={archiveTip} className="inline-flex">
            <button onClick={onArchiveAll} className="rounded p-0.5 text-muted hover:bg-hover hover:text-ink" aria-label={`Archive all ${toArchive} in Done`}>
              <Icon name="archive" size={13} />
            </button>
          </Tip>
        )}
        {backlog && <BacklogActions lane={backlog} />}
        {onFold && <FoldButton label={column.label} onFold={onFold} />}
        {count}
      </span>
    </div>
  );
}

// Review's "Review all": starts the commit walk-through card, held as "Starting…" until it has.
function ReviewAllButton({ onReviewAll }: { onReviewAll: () => Promise<void> }) {
  const [reviewing, setReviewing] = useState(false);
  async function reviewAll() {
    if (reviewing) return;
    setReviewing(true);
    try {
      await onReviewAll();
    } finally {
      setReviewing(false);
    }
  }
  return (
    <Tip text="Walk through the Review cards one at a time: what each changed, its checks, then commit it" className="inline-flex">
      <button
        onClick={() => void reviewAll()}
        disabled={reviewing}
        aria-label={reviewing ? "Starting…" : "Review all"}
        className="flex items-center gap-1 font-medium text-accent hover:opacity-80 disabled:opacity-50"
      >
        <Icon name="check" size={11} />
        <Label>{reviewing ? "Starting…" : "Review all"}</Label>
      </button>
    </Tip>
  );
}

// A header button's words, dropped on a narrow column so its icon (and count) still fit.
function Label({ children }: { children: ReactNode }) {
  return <span className="@max-[230px]:hidden">{children}</span>;
}

// The column's name; Backlog's is a button that drops its saved sprints.
function ColumnTitle({ label, needsYou, backlog }: { label: string; needsYou: boolean; backlog?: BacklogLane }) {
  if (backlog) return <SprintsMenu label={label} lane={backlog} />;
  return <h2 className={`truncate text-[12.5px] font-medium ${needsYou ? "text-warn" : "text-ink"}`}>{label}</h2>;
}
