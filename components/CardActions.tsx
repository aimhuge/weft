"use client";

// A board card's buttons: its skills and delete in the thread panel's header, and its marks (share, star,
// archive), which sit in the browser pane's toolbar while the pane is open beside the thread and in the
// header when it isn't.
import { useState } from "react";
import { shouldConfirmDelete } from "@/lib/delete-confirm";
import { useShortcutHint } from "@/lib/hotkeys";
import type { Card } from "@/lib/types";
import CrashGuard from "./CrashGuard";
import DeleteCardDialog from "./DeleteCardDialog";
import Icon from "./Icon";
import SkillMenu from "./SkillMenu";
import StarButton from "./StarButton";

const BUTTON = "rounded-md p-1.5 text-muted hover:bg-sunken hover:text-ink disabled:opacity-40";

export type CardMarkProps = {
  card: Card;
  live: boolean;
  // Share…: the card's weft.zip link, thread and pane (components/ShareCardDialog.tsx).
  onShare?: () => void;
  onStar?: () => void;
  onArchive: () => void;
};

export function CardMarks({ card, live, onShare, onStar, onArchive }: CardMarkProps) {
  const hint = useShortcutHint();
  return (
    <>
      {onShare && (
        <button onClick={onShare} title="Share… (⇧S)" aria-label="Share" className={BUTTON}>
          <Icon name="share" size={15} />
        </button>
      )}
      <CrashGuard inline what="star"><StarButton variant="header" starred={Boolean(card.starred)} onClick={onStar} /></CrashGuard>
      <button
        onClick={onArchive}
        disabled={live}
        title={hint("archive", card.archived ? "Unarchive card" : "Archive card")}
        aria-label={card.archived ? "Unarchive card" : "Archive card"}
        className={BUTTON}
      >
        <Icon name="archive" size={15} />
      </button>
    </>
  );
}

// Delete is for a thread that hasn't finished its first full turn: a wrong start, stopped and gone before it spends
// more tokens (the DELETE route ends its CLI). After that the header offers only Archive. A counted turn, or a saved
// session that isn't running (imported, Codex), counts as finished.
export function hasFinishedTurn(card: Card, live: boolean): boolean {
  return Boolean(card.turns) || (Boolean(card.sessionId) && !live);
}

export default function CardActions({ onSend, onDelete, marksInPane = false, ...marks }: CardMarkProps & {
  onSend: (text: string) => Promise<void>;
  onDelete: () => void;
  // The browser pane shows the marks in its toolbar, so the header leaves them out.
  marksInPane?: boolean;
}) {
  const { card, live } = marks;
  // The card waiting to be deleted: the confirmation dialog is open for it.
  const [deleting, setDeleting] = useState(false);

  // Deleting asks first, unless the user ticked "Don't ask again" (lib/delete-confirm.ts).
  const askToDelete = () => {
    if (!shouldConfirmDelete()) {
      onDelete();
      return;
    }
    setDeleting(true);
  };

  return (
    <>
      <CrashGuard inline what="skill menu"><SkillMenu cwd={card.cwd} disabled={live} onRun={(skill) => onSend(`/${skill}`)} /></CrashGuard>
      {!marksInPane && <CardMarks {...marks} />}
      {!hasFinishedTurn(card, live) && <button
        onClick={askToDelete}
        title="Delete card"
        aria-label="Delete card"
        className="rounded-md p-1.5 text-muted hover:bg-sunken hover:text-danger"
      >
        <Icon name="trash" size={15} />
      </button>}
      {deleting && (
        <DeleteCardDialog
          title={card.title}
          live={live}
          onCancel={() => setDeleting(false)}
          onConfirm={() => {
            setDeleting(false);
            onDelete();
          }}
        />
      )}
    </>
  );
}
