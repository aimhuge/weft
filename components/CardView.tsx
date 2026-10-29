"use client";

import { useState } from "react";
import { api } from "@/lib/client";
import { isLive } from "@/lib/format";
import { BACKEND_LABELS, type Backend, type Card } from "@/lib/types";
import { firstNow, otherFirstNow, patchNow, waitNow } from "@/lib/optimistic-cards";
import ArchiveButton from "./ArchiveButton";
import CardFooterMeta from "./CardFooterMeta";
import CronMark, { cronCardClass } from "./CronMark";
import CardFace from "./CardFace";
import CardPicture from "./CardPicture";
import CardProgress, { showsCardProgress } from "./CardProgress";
import Icon, { Spinner } from "./Icon";
import { ContinueButton, RestartButton, type ResumeHow } from "./CardResume";
import CardMarks from "./CardMarks";
import RestartMark, { restartCardClass } from "./RestartMark";
import StarButton from "./StarButton";

// Re-exports so existing import sites keep working.
export { default as BackendBadge } from "./BackendBadge";
export { default as BackendPicker } from "./BackendPicker";

// What the thread last said: the line you read to decide whether to open it.
function Summary({ card }: { card: Card }) {
  if (card.error) {
    return (
      <div className="mt-1 flex items-start gap-1.5 text-danger">
        <Icon name="alert" size={12} className="mt-[3px] shrink-0" />
        <span className="line-clamp-2 text-[12px] leading-snug">{card.error}</span>
      </div>
    );
  }
  if (!card.lastLine) return null;
  // A card waiting on another card's code (lib/permission-wait.ts) sits in Running, but it isn't
  // working: it shows the wait, not a spinner.
  const icon =
    card.pending?.waiting ? (
      <Icon name="lock" size={12} className="mt-[3px] shrink-0 text-warn" />
    ) : card.column === "running" ? (
      <span className="mt-[3px] shrink-0 text-accent"><Spinner size={11} /></span>
    ) : card.column === "needs_you" ? (
      <Icon name={card.pending ? "lock" : "alert"} size={12} className="mt-[3px] shrink-0 text-warn" />
    ) : null;
  return (
    <div className="mt-1 flex items-start gap-1.5">
      {icon}
      <span className={`line-clamp-2 text-[12px] leading-snug ${card.column === "done" ? "text-faint" : "text-muted"}`}>
        {card.lastLine}
      </span>
    </div>
  );
}

// "Run on <other CLI>" — the one-click escape from a rate-limit error. Sits under the error line
// on a rate-limited card; flips the card's backend and replays the last user message.
function RateLimitSwitch({ card }: { card: Card }) {
  if (!card.rateLimitHit) return null;
  const other: Backend = card.backend === "puku" ? "claude" : "puku";
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        void api.switchBackend(card.id, other, true).catch(() => {});
      }}
      className="mt-2 rounded-md bg-accent px-2.5 py-1 text-[12px] font-medium text-on-accent hover:opacity-90"
    >
      Run on {BACKEND_LABELS[other]}
    </button>
  );
}

// Stopped in Needs you because the CLI is logged out (no permission request): the card offers Log in.
function waitsForLogin(card: Card) {
  return card.column === "needs_you" && !card.pending && /^Log in to /.test(card.lastLine ?? "");
}

// The border says a lot: selection, last opened (ink, unlike unseen's accent), unseen, or needs-you's amber.
function cardBorder(card: Card, selected: boolean, unseen: boolean, lastOpen: boolean) {
  if (selected) return "border-accent ring-1 ring-accent";
  if (lastOpen || unseen) return `${lastOpen ? "card-last-open border-ink" : "border-accent/70 ring-1 ring-accent/40"} ${unseen ? "card-unseen" : ""}`;
  // A card waiting on another card's code sits in Running but reads like Needs you: it is held.
  if (card.column === "needs_you" || card.pending?.waiting) return "border-warn/60";
  return "border-line hover:border-line-strong";
}

const BROKE_BORDER = "border-danger ring-1 ring-danger/50";

const noop = () => {};

// What a card takes. The board's list view draws the same card as a row (components/CardRow.tsx), so
// this is the shape both share.
export interface CardViewProps {
  card: Card;
  now: number;
  selected: boolean;
  // The card you opened last, outlined after you close it.
  lastOpen?: boolean;
  // Moved here while you weren't looking; cleared when you open it.
  unseen?: boolean;
  onOpen: () => void;
  onAnswer?: (allow: boolean) => void;
  onStop?: () => void;
  // ▶ sends "continue" into the card's session; Restart (on a stopped or failed card) runs its last message again.
  onResume?: (how: ResumeHow) => void;
  // Right-click: the card's menu (lib/card-menu.ts).
  onContextMenu?: (e: React.MouseEvent) => void;
  // The ☆: star or unstar the card (api.mark).
  onStar?: () => void;
  // A click on one of its tag pills: the board filters to that tag.
  onTag?: (tag: string) => void;
  // Backlog and Done cards get a one-click archive (Board.tsx → lib/card-handlers.ts); archived cards unarchive.
  onArchive?: () => void;
  // Other busy cards in this folder (lib/overlap.ts busyHere); flagged only while this one is busy too.
  alsoHere?: Card[];
  // The weft.zip board mirrors a card it can't act on: no drag, no stop, answer, resume, star or archive.
  readOnly?: boolean;
  // This card's thread asked Weft to restart (lib/restart-tool.ts): it gets a red edge and a ⟳ chip.
  restartRequested?: boolean;
}

export default function CardView({
  card,
  now,
  selected,
  lastOpen = false,
  unseen = false,
  onOpen,
  onAnswer = noop,
  onStop = noop,
  onResume,
  onContextMenu,
  onStar,
  onTag,
  onArchive,
  alsoHere = [],
  readOnly = false,
  restartRequested = false,
}: CardViewProps) {
  // The request already answered here, so a second click can't answer it (or the next one) again.
  const [answeredId, setAnsweredId] = useState<string | null>(null);
  // A running card is placed by its status line; one waiting on you (a question or a permission) can still be dragged.
  const fixed = card.column === "running" || card.role === "copilot" || readOnly;
  // The issue and tags sit on the progress line, or in the footer when the card has none.
  const marks = <CardMarks card={card} onTag={onTag} onDismissBreak={readOnly ? undefined : () => void patchNow(card.id, { broke: undefined }, () => api.clearBreak(card.id)).catch(() => {})} />;
  const progress = showsCardProgress(card);
  const answered = answeredId !== null && answeredId === card.pending?.id;
  // A card that broke Weft (lib/crash-blame.ts) is ringed red until you dismiss its chip; selection still shows.
  const border = card.broke && !selected ? BROKE_BORDER : cardBorder(card, selected, unseen, lastOpen);

  function answer(allow: boolean) {
    if (!card.pending || answered) return;
    setAnsweredId(card.pending.id);
    onAnswer(allow);
  }

  return (
    <div
      role="button"
      tabIndex={0}
      draggable={!fixed}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", card.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      data-card-id={card.id}
      onClick={onOpen}
      onContextMenu={onContextMenu}
      className={`group relative rounded-lg border bg-card px-3 py-2.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent ${border} ${cronCardClass(card)} ${restartCardClass(restartRequested)} ${fixed ? "" : "cursor-grab active:cursor-grabbing"}`}
    >
      {unseen && (
        <span title="New since you last looked" className="absolute right-1 top-1 z-10 size-2.5 animate-pulse rounded-full border-2 border-card bg-accent" />
      )}
      <div className="flex items-start gap-2.5">
        <div className="min-w-0 flex-1">
          <div className={`line-clamp-2 text-[13px] font-medium leading-snug ${card.column === "done" ? "text-muted" : "text-ink"}`}>
            <RestartMark requested={restartRequested} />
            <CronMark card={card} />
            {card.title}
          </div>
          <Summary card={card} />
          {!readOnly && <RateLimitSwitch card={card} />}
        </div>
        <div className="flex shrink-0 items-start gap-1.5">
          <CardPicture card={card} />
        </div>
      </div>
      {progress && <CardProgress card={card} marks={marks} />}

      {!readOnly && <CardPrompts card={card} answered={answered} onAnswer={answer} onOpen={onOpen} onResume={onResume} />}

      <div className="mt-2 flex items-center gap-2 border-t border-line pt-1.5 text-[11px] text-faint">
        <div className="min-w-0 flex-1">
          <CardFooterMeta card={card} now={now} alsoHere={alsoHere} marks={progress ? null : marks} />
        </div>
        <CardActions card={card} readOnly={readOnly} onResume={onResume} onStar={onStar} onArchive={onArchive} onStop={onStop} />
      </div>
    </div>
  );
}

// What a card in Needs you asks of you, right on it: log in, restart, answer or allow.
function CardPrompts({ card, answered, onAnswer, onOpen, onResume }: { card: Card; answered: boolean; onAnswer: (allow: boolean) => void; onOpen: () => void; onResume?: (how: ResumeHow) => void }) {
  return (
    <>
      {waitsForLogin(card) && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            void api.login(card.backend, "start").catch(() => {});
          }}
          className="mt-2 rounded-md bg-accent px-2.5 py-1 text-[12px] font-medium text-on-accent hover:opacity-90"
        >
          Log in
        </button>
      )}

      <RestartButton card={card} onResume={onResume} />

      {card.pending?.questions && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
          className="mt-2 rounded-md bg-accent px-2.5 py-1 text-[12px] font-medium text-on-accent hover:opacity-90"
        >
          Answer
        </button>
      )}

      {/* An MCP server's form (lib/elicitation.ts) needs its fields, so it's answered in the thread. */}
      {card.pending && !card.pending.questions && !card.pending.elicitation?.fields.length && <PermissionRow card={card} answered={answered} onAnswer={onAnswer} />}
    </>
  );
}

// The footer's buttons: continue, star, archive and stop. A read-only card (weft.zip) has none.
function CardActions({ card, readOnly, onResume, onStar, onArchive, onStop }: { card: Card; readOnly: boolean; onResume?: (how: ResumeHow) => void; onStar?: () => void; onArchive?: () => void; onStop: () => void }) {
  if (readOnly) return null;
  // The copilot opens like any card but can't be moved, starred or filed under a project.
  const copilot = card.role === "copilot";
  return (
    <div className="flex shrink-0 items-center">
      <ContinueButton card={card} onResume={onResume} />
      {!copilot && <StarButton variant="card" starred={Boolean(card.starred)} onClick={onStar} />}
      {(card.column === "done" || card.column === "backlog" || card.archived) && <ArchiveButton archived={Boolean(card.archived)} onClick={onArchive} />}
      {isLive(card) && <StopButton onClick={onStop} />}
    </div>
  );
}

// The Allow / Deny pair for a permission prompt. The card opens the thread on click; each button
// stops the event so the click answers the prompt instead. An edit another card is holding offers
// the order, not a refusal: the holder's face, Wait (the default, as in the thread's prompt), This first
// (lib/precedence.ts), which goes ahead and has the holder leave the file to this card, and Other
// first, which puts the holder ahead — this card leaves the file to it and waits. A card already
// waiting (lib/permission-wait.ts) drops Wait; its last line already says who it waits for. Buttons
// never wrap, so a narrow card stays one row.
function PermissionRow({ card, answered, onAnswer }: { card: Card; answered: boolean; onAnswer: (allow: boolean) => void }) {
  const stop = (allow: boolean) => (e: React.MouseEvent) => {
    e.stopPropagation();
    onAnswer(allow);
  };
  const holder = card.pending?.why?.holder;
  const send = (call: typeof waitNow) => (e: React.MouseEvent) => {
    e.stopPropagation();
    if (card.pending) void call(card.id, card.pending.id).catch(() => {});
  };
  const btn = "whitespace-nowrap rounded-md px-2.5 py-1 text-[12px] disabled:opacity-50";
  const primary = `${btn} bg-accent font-medium text-on-accent hover:opacity-90`;
  const secondary = `${btn} border border-line-strong text-ink hover:bg-sunken`;
  const elicited = Boolean(card.pending?.elicitation);
  const deny = <button onClick={stop(false)} disabled={answered} className={secondary}>{elicited ? "Decline" : "Deny"}</button>;
  if (holder)
    return (
      <div className="mt-2 flex items-center gap-1.5">
        <CardFace face={holder} tip={`‘${holder.title}’ is editing this file`} />
        {!card.pending?.waiting && (
          <button onClick={send(waitNow)} disabled={answered} className={primary} title={`Hold this edit until ‘${holder.title}’ finishes or commits, then redo it on top`}>
            Wait
          </button>
        )}
        <button onClick={send(firstNow)} disabled={answered} className={card.pending?.waiting ? primary : secondary} title={`Go ahead, and ‘${holder.title}’ leaves this file to this card until it commits or finishes`}>
          This first
        </button>
        <button onClick={send(otherFirstNow)} disabled={answered} className={secondary} title={`Let ‘${holder.title}’ go first: it keeps this file, and this card waits until it commits or finishes`}>
          Others first
        </button>
      </div>
    );
  return (
    <div className="mt-2 flex items-center gap-1.5">
      <button onClick={stop(true)} disabled={answered} className={primary}>
        {elicited ? "Accept" : "Allow"}
      </button>
      {deny}
    </div>
  );
}

// The card's footer button that stops a running thread.
function StopButton({ onClick }: { onClick: () => void }) {
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
