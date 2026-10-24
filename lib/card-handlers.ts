import type React from "react";
import type { ResumeHow } from "./card-resume";
import { api } from "./client";
import { stopNow } from "./optimistic-cards";
import type { Card } from "./types";

// What the board does when you use a card's own controls, closed over the board's actions so
// Board.tsx's renderCard spreads one object instead of listing every handler.
export type CardActionsCtx = {
  openCard: (card: Card) => void;
  resume: (id: string, how: ResumeHow) => void;
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
    onAnswer: (allow: boolean) => void api.answer(card.id, allow, undefined, card.pending?.id).catch(ctx.notify),
    onStop: () => void stopNow(card.id).catch(ctx.notify),
    onResume: (how: ResumeHow) => ctx.resume(card.id, how),
    onContextMenu: (e: React.MouseEvent) => void ctx.onCardMenu(card, e),
    onStar: () => ctx.toggleStar(card),
    onArchive: () => ctx.toggleArchive(card),
    onTag: ctx.onTag,
  };
}
