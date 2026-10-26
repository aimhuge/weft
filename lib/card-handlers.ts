import type React from "react";
import type { ResumeHow } from "./card-resume";
import { api } from "./client";
import { answerNow, stopNow } from "./optimistic-cards";
import type { Card, Column } from "./types";

// What the board does when you use a card's own controls, closed over the board's actions so
// Board.tsx's renderCard spreads one object instead of listing every handler.
export type CardActionsCtx = {
  openCard: (card: Card) => void;
  resume: (id: string, how: ResumeHow) => void;
  // Your move to another column, as a drag does (lib/use-board-card-actions.ts).
  move: (id: string, column: Column) => void;
  onCardMenu: (card: Card, e: React.MouseEvent) => void | Promise<void>;
  toggleStar: (card: Card) => void;
  toggleArchive: (card: Card) => void;
  onTag: (tag: string) => void;
  notify: (err: unknown) => void;
};

// The handler props CardView takes for one card: open, answer, stop, continue, right-click,
// star, archive (a Done card's footer button; an archived one unarchives) and tag filter.
export function cardHandlers(card: Card, ctx: CardActionsCtx) {
  return {
    onOpen: () => ctx.openCard(card),
    // The prompt leaves the card at once (lib/optimistic-cards.ts); a refusal brings it back.
    onAnswer: (allow: boolean) => {
      const pendingId = card.pending?.id;
      const send = () => api.answer(card.id, allow, undefined, pendingId);
      void (pendingId ? answerNow(card.id, pendingId, allow, send) : send()).catch(ctx.notify);
    },
    onStop: () => void stopNow(card.id).catch(ctx.notify),
    onResume: (how: ResumeHow) => ctx.resume(card.id, how),
    onContextMenu: (e: React.MouseEvent) => void ctx.onCardMenu(card, e),
    onStar: () => ctx.toggleStar(card),
    onArchive: () => ctx.toggleArchive(card),
    onTag: ctx.onTag,
  };
}
