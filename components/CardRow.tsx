"use client";

// One card in the list view: a row of the sheet, with a cell per column — its title, what it is
// doing, its stage, its tags, its folder and its age — so the columns line up down the list.
import { folderName, stageStep, timeAgo, STAGES } from "@/lib/format";
import { isLive } from "@/lib/format";
import type { Card, Column } from "@/lib/types";
import type { ResumeHow } from "@/lib/card-resume";
import { api } from "@/lib/client";
import CardMarks from "./CardMarks";
import Icon, { Spinner } from "./Icon";
import { ContinueButton } from "./CardResume";
import StarButton from "./StarButton";
import ArchiveButton from "./ArchiveButton";
import { LIST_GRID } from "./list-grid";

// The column's colour, the same map the card's progress line uses (components/CardProgress.tsx).
const TONE: Record<Column, { text: string; bar: string }> = {
  running: { text: "text-accent", bar: "bg-accent" },
  needs_you: { text: "text-warn", bar: "bg-warn" },
  review: { text: "text-ok", bar: "bg-ok" },
  backlog: { text: "text-muted", bar: "bg-muted" },
  done: { text: "text-faint", bar: "bg-faint" },
};

export default function CardRow({
  card,
  column,
  now,
  selected,
  lastOpen = false,
  unseen = false,
  onOpen,
  onStop,
  onResume,
  onContextMenu,
  onStar,
  onTag,
  onArchive,
  alsoHere = [],
}: {
  card: Card;
  // Where the card sits, which can differ from the card's own column while it wraps up.
  column: Column;
  now: number;
  selected: boolean;
  lastOpen?: boolean;
  unseen?: boolean;
  onOpen: () => void;
  onStop?: () => void;
  onResume?: (how: ResumeHow) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  onStar?: () => void;
  onTag?: (tag: string) => void;
  onArchive?: () => void;
  alsoHere?: Card[];
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      data-card-id={card.id}
      data-list-row
      onClick={onOpen}
      onContextMenu={onContextMenu}
      className={`group relative flex items-stretch transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent ${rowTint(selected, lastOpen, unseen)}`}
    >
      {/* The selected cell's edge, like the selection in a grid. */}
      {selected && <span className="absolute inset-y-0 left-0 w-[2px] bg-accent shadow-[0_0_8px_var(--color-accent)]" aria-hidden />}

      <div className={`${LIST_GRID} w-full px-3 py-2`}>
        <TitleCell card={card} unseen={unseen} />
        <StatusCell card={card} column={column} />
        <StageCell card={card} column={column} />
        <TagsCell card={card} onTag={onTag} />
        <FolderCell card={card} alsoHere={alsoHere} />
        <AgeCell card={card} now={now} />
        <ActionsCell card={card} onStop={onStop} onResume={onResume} onStar={onStar} onArchive={onArchive} />
      </div>
    </div>
  );
}

// The row's background: the card you picked is lit, the one you opened last is dimmed, a new one
// glows a little, and the rest light up under the pointer.
function rowTint(selected: boolean, lastOpen: boolean, unseen: boolean) {
  if (selected) return "bg-accent-soft";
  if (lastOpen) return "bg-sunken";
  if (unseen) return "bg-accent-soft/40";
  return "hover:bg-sunken";
}

// The title: the cell that says what the card is.
function TitleCell({ card, unseen }: { card: Card; unseen: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      {unseen && <span title="New since you last looked" className="size-1.5 shrink-0 rounded-full bg-accent" />}
      <span className={`min-w-0 truncate text-[13px] font-medium ${card.column === "done" ? "text-muted" : "text-ink"}`} title={card.title}>
        {card.title}
      </span>
    </span>
  );
}

// What the thread is doing right now: an error, a wait, a prompt for you, or a running turn.
function StatusCell({ card, column }: { card: Card; column: Column }) {
  const status = statusOf(card);
  return (
    <span className="min-w-0 truncate text-[11px]">
      {status && (
        <span className={`flex items-center gap-1.5 ${status.tone ?? TONE[column].text}`} title={status.tip}>
          {status.spinner ? <Spinner size={10} /> : <Icon name={status.icon} size={11} />}
          <span className="truncate">{status.word}</span>
        </span>
      )}
    </span>
  );
}

// The stage it has reached, and what is left of it.
function StageCell({ card, column }: { card: Card; column: Column }) {
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
      {card.stage && <span className={`truncate font-medium ${tone.text}`}>{card.stage}</span>}
      {left && (
        <span className="truncate text-faint" title={`Left: ${card.remaining}`}>· {card.remaining}</span>
      )}
    </span>
  );
}

// Its tags, its issue and the rest of its marks.
function TagsCell({ card, onTag }: { card: Card; onTag?: (tag: string) => void }) {
  return (
    <span className="flex min-w-0 items-center overflow-hidden">
      <CardMarks card={card} onTag={onTag} onDismissBreak={() => void api.clearBreak(card.id).catch(() => {})} />
    </span>
  );
}

// The folder it runs in, and how many other cards are in it with it.
function FolderCell({ card, alsoHere }: { card: Card; alsoHere: Card[] }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-[11px]">
      <span className="min-w-0 truncate text-muted" title={card.cwd}>
        {card.role === "copilot" ? "whole board" : folderName(card.cwd)}
      </span>
      {alsoHere.length > 0 && (
        <span className="shrink-0 font-medium text-warn" title={`Also running in this folder (shared working tree):\n${alsoHere.map((c) => c.title).join("\n")}`}>
          +{alsoHere.length}
        </span>
      )}
    </span>
  );
}

// How long since it last moved.
function AgeCell({ card, now }: { card: Card; now: number }) {
  return (
    <span className="truncate text-right text-[11px] tabular-nums text-faint">
      {timeAgo(card.lastActivity ?? card.updatedAt, now).replace(" ago", "")}
    </span>
  );
}

// The card's own actions.
function ActionsCell({
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

// The status a row shows: an error, a wait, a prompt for you, or a running turn.
interface RowStatus {
  word: string;
  tone?: string;
  icon: "alert" | "lock";
  tip?: string;
  spinner?: boolean;
}

function statusOf(card: Card): RowStatus | null {
  if (card.error) return { word: "Error", tone: "text-danger", icon: "alert", tip: card.error };
  if (card.pending?.waiting) return { word: "Waiting", tone: "text-warn", icon: "lock", tip: "Waiting on another card's code" };
  if (card.pending) {
    // The card is asking the user something: a permission, or a question.
    return card.pending.questions
      ? { word: "Question", tone: "text-warn", icon: "lock", tip: card.pending.title }
      : { word: "Permission", tone: "text-warn", icon: "lock", tip: card.pending.title };
  }
  if (card.column === "running") return { word: "Running", icon: "alert", spinner: true };
  if (card.column === "needs_you") return { word: "Needs you", tone: "text-warn", icon: "alert", tip: card.lastLine };
  return null;
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
