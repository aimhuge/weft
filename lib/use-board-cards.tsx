"use client";

import { useCallback, type ComponentType } from "react";
import type { Card, Column } from "./types";
import type { CardActionsCtx } from "./card-handlers";
import { cardHandlers } from "./card-handlers";
import { busyHere } from "./overlap";
import type { CardViewProps } from "@/components/CardView";
import CardRow from "@/components/CardRow";

// The card component the board draws, with its props (components/CardView.tsx). It arrives as a
// prop because the board loads it lazily through guarded(), in its own CrashGuard.
export type CardViewComponent = ComponentType<CardViewProps & { guardName?: string }>;

// How the board draws a card, in either layout: the card as a card, and the card as a row of the
// list view. Both carry the same facts and the same handlers, so a row is as usable as a card.
export interface BoardCardRenderers {
  renderCard: (card: Card) => React.ReactNode;
  renderRow: (card: Card, column: Column) => React.ReactNode;
}

export interface BoardCardsDeps {
  cards: Card[];
  now: number;
  selectedId: string | null;
  lastOpenId: string | null;
  unseen: ReadonlySet<string>;
  // The thread that asked to restart, so its card says so (components/RestartMark.tsx).
  restartRequestedBy: string | null;
  ctx: CardActionsCtx;
  CardView: CardViewComponent;
}

export function useBoardCards(deps: BoardCardsDeps): BoardCardRenderers {
  const { cards, now, selectedId, lastOpenId, unseen, restartRequestedBy, ctx, CardView } = deps;

  const renderCard = useCallback(
    (card: Card) => (
      <CardView
        guardName={card.title}
        card={card}
        now={now}
        selected={card.id === selectedId}
        lastOpen={card.id === lastOpenId}
        unseen={unseen.has(card.id)}
        alsoHere={busyHere(cards, card)}
        restartRequested={restartRequestedBy === card.id}
        {...cardHandlers(card, ctx)}
      />
    ),
    [CardView, cards, now, selectedId, lastOpenId, unseen, restartRequestedBy, ctx],
  );

  const renderRow = useCallback(
    (card: Card, column: Column) => (
      <CardRow
        card={card}
        column={column}
        now={now}
        selected={card.id === selectedId}
        lastOpen={card.id === lastOpenId}
        unseen={unseen.has(card.id)}
        alsoHere={busyHere(cards, card)}
        {...cardHandlers(card, ctx)}
      />
    ),
    [cards, now, selectedId, lastOpenId, unseen, ctx],
  );

  return { renderCard, renderRow };
}
