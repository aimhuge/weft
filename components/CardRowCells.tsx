"use client";

// The cells of a list-view row (components/CardRow.tsx): the title with its fold toggle, the stage, the
// tags, the age and the card's own buttons. The status and the folder, which open menus, have files of
// their own (components/RowStatusCell.tsx, components/RowFolderCell.tsx).
import { stageStep, timeAgo, STAGES, isLive } from "@/lib/format";
import type { Card, Column } from "@/lib/types";
import type { ResumeHow } from "@/lib/card-resume";
import type { CronBadge } from "@/lib/list-crons";
import { api } from "@/lib/client";
import CardMarks from "./CardMarks";
import Icon from "./Icon";
import { ContinueButton } from "./CardResume";
import StarButton from "./StarButton";
import ArchiveButton from "./ArchiveButton";

// The column's colour, the same map the card's progress line uses (components/CardProgress.tsx).
export const TONE: Record<Column, { text: string; bar: string }> = {
  running: { text: "text-accent", bar: "bg-accent" },
  needs_you: { text: "text-warn", bar: "bg-warn" },
  review: { text: "text-ok", bar: "bg-ok" },
  backlog: { text: "text-muted", bar: "bg-muted" },
  done: { text: "text-faint", bar: "bg-faint" },
};

// Where a row sits in the sheet's tree (lib/list-tree.ts): how deep, how much folds under it, and its toggle.
export interface RowNest {
  depth: number;
  kids: number;
  expanded: boolean;
  onToggle: () => void;
  // Its ⏰ badge: which run of a cron it is, or when the next run of the crons folded under it is.
  cron?: CronBadge | null;
}

// The fold toggle's chevron, pointing right when shut and down when open.
export function Chevron({ open }: { open: boolean }) {
  return (
    <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden className={`shrink-0 transition-transform ${open ? "rotate-90" : ""}`}>
      <path d="M3 1.5 7 5 3 8.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// The title: the cell that says what the card is, indented to its depth, with a toggle when anything
// folds under it. The title underlines under the pointer, since a click opens the thread.
export function TitleCell({ card, unseen, nest }: { card: Card; unseen: boolean; nest?: RowNest }) {
  const depth = nest?.depth ?? 0;
  return (
    <span className="flex min-w-0 items-center gap-1.5" style={{ paddingLeft: depth * 18 }}>
      {nest && nest.kids > 0 ? (
        <button
          aria-label={nest.expanded ? "Fold what's under this card" : "Show what's under this card"}
          aria-expanded={nest.expanded}
          title={`${nest.kids} under this card`}
          onClick={(e) => {
            e.stopPropagation();
            nest.onToggle();
          }}
          className={`sheet-fold ${nest.expanded ? "text-accent" : ""}`}
        >
          <Chevron open={nest.expanded} />
          <span className="text-[10px] tabular-nums">{nest.kids}</span>
        </button>
      ) : (
        <span className={depth > 0 ? "sheet-branch" : "sheet-fold-space"} aria-hidden />
      )}
      {unseen && <span title="New since you last looked" className="size-1.5 shrink-0 rounded-full bg-accent" />}
      <span className={`sheet-title min-w-0 truncate text-[13px] font-medium ${card.column === "done" ? "text-muted" : "text-ink"}`} title={card.title}>
        {card.title}
      </span>
      {nest?.cron && (
        <span className={`sheet-cron ${nest.cron.off ? "sheet-cron-off" : ""}`} title={nest.cron.tip}>
          ⏰ {nest.cron.text}
        </span>
      )}
    </span>
  );
}

// The stage it has reached, and what is left of it.
export function StageCell({ card, column }: { card: Card; column: Column }) {
  const tone = TONE[column];
  const step = card.stage ? stageStep(card.stage) : 0;
  const left = card.remaining && card.remaining !== "none";
  if (!card.stage && !left) return <span className="min-w-0 truncate text-[11px]" />;
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-[11px]">
      {step > 0 && (
        <span className="list-stage-dots flex shrink-0 gap-[2px]" title={`${card.stage}: step ${step} of ${STAGES.length}`} aria-hidden>
          {STAGES.map((s, i) => (
            <span key={s} className={`h-[4px] w-[4px] rounded-full ${i < step ? tone.bar : "bg-line-strong"}`} />
          ))}
        </span>
      )}
      {card.stage && <span className={`shrink-0 font-medium ${tone.text}`} title={left ? `Left: ${card.remaining}` : undefined}>{card.stage}</span>}
      {left && (
        <span className="list-stage-left truncate text-faint" title={`Left: ${card.remaining}`}>· {card.remaining}</span>
      )}
    </span>
  );
}

// Its tags, its issue and the rest of its marks.
export function TagsCell({ card, onTag }: { card: Card; onTag?: (tag: string) => void }) {
  return (
    <span className="flex min-w-0 items-center overflow-hidden">
      <CardMarks card={card} onTag={onTag} onDismissBreak={() => void api.clearBreak(card.id).catch(() => {})} />
    </span>
  );
}

// How long since it last moved.
export function AgeCell({ at, now }: { at: number; now: number }) {
  return <span className="justify-end text-[11px] tabular-nums text-faint">{timeAgo(at, now).replace(" ago", "")}</span>;
}

// The card's own actions.
export function ActionsCell({
  card,
  onStop,
  onResume,
  onStar,
  onArchive,
}: {
  card: Card;
  onStop?: () => void;
  onResume?: (how: ResumeHow) => void;
  onStar?: () => void;
  onArchive?: () => void;
}) {
  const fileable = card.column === "done" || card.column === "backlog" || card.archived;
  return (
    <span className="flex items-center justify-end gap-0.5">
      <ContinueButton card={card} onResume={onResume} />
      <StarButton variant="card" starred={Boolean(card.starred)} onClick={onStar} />
      {fileable && <ArchiveButton archived={Boolean(card.archived)} onClick={onArchive} />}
      {isLive(card) && <StopButton onClick={onStop} />}
    </span>
  );
}

// The row's stop button: the card's, for a thread that's still running.
function StopButton({ onClick }: { onClick?: () => void }) {
  if (!onClick) return null;
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title="Stop this thread"
      aria-label="Stop this thread"
      className="rounded p-1 text-muted hover:bg-sunken hover:text-danger"
    >
      <Icon name="stop" size={12} />
    </button>
  );
}
