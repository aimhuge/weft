"use client";

// The open card on weft.zip, framed the way the desktop opens one (components/OpenCard.tsx's CardFrame: a window inset
// over the board, with a backdrop): the desktop's own ThreadPanel on the left (its header, ThreadView and ReplyBox, fed
// by the cloud transport the board provides, useCloudTransport.ts) and the card's browser pane on the right (WebPane).
//
// The reply box is the desktop's: the transport leaves out what only the Mac can do (a "!" command, ↑ edit, folder
// grants, Wait), so the box doesn't offer them. What this board sent the card that hasn't reached it yet shows above
// the box (WebReplyStatus).
import { useEffect, useMemo, type ReactNode } from "react";
import { paneFor } from "@/lib/share-types";
import type { Card, QuestionReply, ThreadItem } from "@/lib/types";
import ThreadPanel from "../ThreadPanel";
import { CardFrame } from "../OpenCard";
import { WebPane } from "./WebPane";

export function WebThreadPanel({
  orgId,
  card,
  seed,
  shown,
  readOnly,
  footer,
  onClose,
  onSend,
  onAnswer,
}: {
  orgId: string;
  card: Card;
  // The thread the server read for a ?card= link, so the first paint isn't empty; the view reads it again itself.
  seed: ThreadItem[];
  // What the thread view draws now (raw, blob refs and all), for the pane to follow.
  shown: ThreadItem[];
  // A teammate's card: only the Mac of the account that runs it obeys, so there's no reply box.
  readOnly: boolean;
  footer: ReactNode;
  onClose: () => void;
  onSend: (text: string) => Promise<void>;
  onAnswer: (allow: boolean, answers?: Record<string, string>, reply?: QuestionReply) => void;
}) {
  const pane = useMemo(() => paneFor(shown), [shown]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <CardFrame framed onBackdrop={onClose} label={card.title}>
      <ThreadPanel
        key={card.id}
        card={card}
        items={seed}
        streaming=""
        readOnly={readOnly}
        footer={footer}
        onClose={onClose}
        onSend={onSend}
        onAnswer={onAnswer}
        className="flex h-full min-h-0 w-full flex-col bg-panel"
      />
      <WebPane orgId={orgId} pane={pane} thumbUrl={card.thumb && /^https?:/.test(card.thumb) ? card.thumb : undefined} />
    </CardFrame>
  );
}
