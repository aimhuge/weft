"use client";

// The open card on weft.zip, framed the way the desktop opens one (components/OpenCard.tsx's CardFrame: a window inset
// over the board, with a backdrop): the desktop's own ThreadPanel on the left (its header, ThreadView and ReplyBox, fed
// by the cloud transport the board provides, useCloudTransport.ts) and the card's browser pane on the right (WebPane).
//
// The reply box is the desktop's: the transport leaves out what only the Mac can do (a "!" command, ↑ edit, folder
// grants, Wait), so the box doesn't offer them. What this board sent the card that hasn't reached it yet shows above
// the box (WebReplyStatus).
import { useEffect, useMemo, type ReactNode } from "react";
import { paneFor, paneFromUrl } from "@/lib/share-types";
import type { GrantScope } from "@/lib/cloud-commands";
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
  onAnswer: (allow: boolean, answers?: Record<string, string>, reply?: QuestionReply, grant?: GrantScope) => void;
}) {
  // The card's own page when the thread loaded so far doesn't reach its last open_url (newest 50 first).
  // A worker's live screen is only ever on the card, so it wins while it's the card's page.
  const pane = useMemo(() => {
    const page = paneFromUrl(card.page ?? "");
    return page?.kind === "screen" ? page : (paneFor(shown) ?? page);
  }, [shown, card.page]);

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
        // The desktop's thread width (ThreadPanel's default) from md up, so the pane beside it gets the rest; a bare
        // w-full took the whole row and left the pane 0px wide. A phone hides the pane, so the thread fills it there.
        className="flex h-full min-h-0 w-full flex-col bg-panel md:w-[44%] md:min-w-[380px] md:shrink-0"
      />
      <WebPane orgId={orgId} pane={pane} thumbUrl={card.thumb && /^https?:/.test(card.thumb) ? card.thumb : undefined} />
    </CardFrame>
  );
}
