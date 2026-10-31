"use client";

import { useCallback, useMemo, type ComponentType } from "react";
import type { Card, Column } from "./types";
import type { CardActionsCtx } from "./card-handlers";
import { cardHandlers } from "./card-handlers";
import { busyHere } from "./overlap";
import { api } from "./client";
import { knownFolders } from "./list-actions";
import { patchNow } from "./optimistic-cards";
import { isWorkerCard } from "./worker-project";
import type { CardViewProps } from "@/components/CardView";
import CardRow, { type RowNest } from "@/components/CardRow";

// The card component the board draws, with its props (components/CardView.tsx). It arrives as a
// prop because the board loads it lazily through guarded(), in its own CrashGuard.
export type CardViewComponent = ComponentType<CardViewProps & { guardName?: string }>;

// How the board draws a card, in either layout: the card as a card, and the card as a row of the
// list view. Both carry the same facts and the same handlers, so a row is as usable as a card.
export interface BoardCardRenderers {
  renderCard: (card: Card) => React.ReactNode;
  renderRow: (card: Card, column: Column, nest?: RowNest) => React.ReactNode;
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

  // A worker's card opens and that's all: its moves, stars and the rest would reach for a card this Mac doesn't have.
  const shared = useCallback(
    (card: Card) => ({ card, now, selected: card.id === selectedId, lastOpen: card.id === lastOpenId, unseen: unseen.has(card.id), alsoHere: busyHere(cards, card) }),
    [cards, now, selectedId, lastOpenId, unseen],
  );

  const renderCard = useCallback(
    (card: Card) =>
      isWorkerCard(card) ? (
        <CardView guardName={card.title} readOnly {...shared(card)} onOpen={() => ctx.openCard(card)} />
      ) : (
        <CardView guardName={card.title} {...shared(card)} restartRequested={restartRequestedBy === card.id} {...cardHandlers(card, ctx)} />
      ),
    [CardView, shared, restartRequestedBy, ctx],
  );

  // Every folder a card can move to from the list view's folder picker.
  const folders = useMemo(() => knownFolders(cards.filter((c) => !isWorkerCard(c))), [cards]);

  const renderRow = useCallback(
    (card: Card, column: Column, nest?: RowNest) => isWorkerCard(card) ? (
      <CardRow column={column} nest={nest} {...shared(card)} onOpen={() => ctx.openCard(card)} />
    ) : (
      <CardRow
        card={card}
        column={column}
        nest={nest}
        folders={folders}
        onMove={(to) => ctx.move(card.id, to)}
        onFolder={(cwd) => void patchNow(card.id, { cwd }, () => api.setCwd(card.id, cwd)).catch(ctx.notify)}
        now={now}
        selected={card.id === selectedId}
        lastOpen={card.id === lastOpenId}
        unseen={unseen.has(card.id)}
        alsoHere={busyHere(cards, card)}
        {...cardHandlers(card, ctx)}
      />
    ),
    [cards, folders, now, selectedId, lastOpenId, unseen, ctx, shared],
  );

  return { renderCard, renderRow };
}
