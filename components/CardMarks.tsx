"use client";

import { cardTags } from "@/lib/rail-view";
import { runningBadge } from "@/lib/tasks-view";
import { formatAt } from "@/lib/schedule";
import type { Card, CardBreak } from "@/lib/types";
import BlockingMark from "./BlockingMark";
import TagPill from "./TagPill";
import Tip from "./Tip";

// The card's running subagents (a count), its GitHub issue (#N, a link) and up to two tags with "+N" for the rest,
// folded into the footer line, after ⑃ for an isolated card (its own worktree, docs/architecture/worktrees.md). Also shows "Auto-resumed" when lib/limit-resume.ts replayed the last user
// message because the 15-min limit poll saw the window reset. First of all, "Broke Weft" when this thread stopped
// Weft's server, left a file that doesn't build or made the board reload (lib/crash-blame.ts), with × to dismiss it.
export default function CardMarks({ card, onTag, onDismissBreak }: { card: Card; onTag?: (tag: string) => void; onDismissBreak?: () => void }) {
  const { shown, more } = cardTags(card.tags);
  const tasks = runningBadge(card.tasks);
  // The blocking count is live (lib/waits-on.ts), so the row can't be skipped before it is known:
  // an empty span costs nothing, and the mark decides for itself.
  if (!hasMarks(card, shown.length > 0 || Boolean(tasks))) return <BlockingMark cardId={card.id} />;
  return (
    <span className="flex min-w-0 items-center gap-1">
      {card.broke && <BrokeChip broke={card.broke} onDismiss={onDismissBreak} />}
      <BlockingMark cardId={card.id} />
      <IsolatedMark card={card} />
      {tasks && (
        <Tip text={tasks.title}>
          <span className="shrink-0 font-medium text-accent">⑂{tasks.count}</span>
        </Tip>
      )}
      {card.issue && (
        <a
          href={card.issue.url}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          title={`${card.issue.repo}#${card.issue.number} (${card.issue.state})`}
          className={`shrink-0 font-medium hover:underline ${card.issue.state === "closed" ? "text-faint line-through" : "text-muted"}`}
        >
          #{card.issue.number}
        </a>
      )}
      {card.autoResumedAt && (
        <Tip text={resumedTip(card)}>
          <span className="shrink-0 rounded-md border border-accent/40 px-1.5 py-px text-[11px] font-medium text-accent">
            {card.autoResumedReason === "upgrade" ? "Resumed · plan upgraded" : `Auto-resumed · ${formatAt(card.autoResumedAt)}`}
          </span>
        </Tip>
      )}
      {shown.map((tag) => (
        <button
          key={tag}
          type="button"
          onClick={(e) => {
            if (!onTag) return;
            e.stopPropagation();
            onTag(tag);
          }}
          className="flex min-w-0"
          tabIndex={onTag ? 0 : -1}
        >
          <TagPill tag={tag} className="min-w-0 max-w-[60px] shrink" title={onTag ? `#${tag} · show only this tag` : undefined} />
        </button>
      ))}
      {more > 0 && (
        <span className="shrink-0" title={(card.tags ?? []).slice(2).join(", ")}>
          +{more}
        </span>
      )}
    </span>
  );
}

const HAPPENED: Record<CardBreak["kind"], string> = { server: "stopped Weft's server", build: "broke Weft's build", reload: "made the board reload" };

// Why the thread restarted on its own: the plan's window reset, or the plan itself changed (the
// user upgraded, so the models that were capped have room again — lib/limit-upgrade.ts).
function resumedTip(card: Card): string {
  if (card.autoResumedReason === "upgrade") {
    return "This thread restarted on its own: your plan was upgraded, so the limits that parked it are gone.";
  }
  return `This thread restarted on its own after the ${card.backend} limit reset.`;
}

// The red chip on a card that broke Weft: what it did on hover, × to dismiss.
function BrokeChip({ broke, onDismiss }: { broke: CardBreak; onDismiss?: () => void }) {
  const times = broke.times ? ` ×${broke.times}` : "";
  const text = `This thread ${HAPPENED[broke.kind]} at ${formatAt(broke.at)}${times}: ${broke.why}.${broke.told ? " It has been told." : " It hears why with your next message."}`;
  return (
    <Tip text={text}>
      <span data-broke={broke.kind} className="flex shrink-0 items-center gap-1 rounded-md border border-danger/50 bg-danger/10 px-1.5 py-px text-[11px] font-medium text-danger">
        💥 Broke Weft{times}
        {onDismiss && (
          <button
            type="button"
            aria-label="Dismiss"
            onClick={(e) => {
              e.stopPropagation();
              onDismiss();
            }}
            className="-mr-0.5 leading-none hover:text-ink"
          >
            ×
          </button>
        )}
      </span>
    </Tip>
  );
}

// Whether the card has anything for this row to show (its tags and running tasks counted by the caller).
function hasMarks(card: Card, listed: boolean) {
  return listed || Boolean(card.issue || card.autoResumedAt || card.broke || card.isolated);
}

// ⑃ on an isolated card (docs/architecture/worktrees.md), its branch in the tip.
function IsolatedMark({ card }: { card: Card }) {
  if (!card.isolated) return null;
  const tip = card.worktree ? `Isolated on ${card.worktree.branch}, in its own worktree; Done lands it.` : "Isolated: getting its worktree ready…";
  return (
    <Tip text={tip}>
      <span className="shrink-0 font-medium text-accent" aria-label="Isolated">
        ⑃
      </span>
    </Tip>
  );
}
