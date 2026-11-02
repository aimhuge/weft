"use client";

import { useCallback, useMemo, type ComponentType } from "react";
import type { Card, Column } from "./types";
import type { CardActionsCtx } from "./card-handlers";
import { handlersFor } from "./card-handlers-host";
import { busyHere } from "./overlap";
import { api } from "./client";
import { knownFolders } from "./list-actions";
import { patchNow } from "./optimistic-cards";
import { hostOf } from "./project-host";
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

  const shared = useCallback(
    (card: Card) => ({ card, now, selected: card.id === selectedId, lastOpen: card.id === lastOpenId, unseen: unseen.has(card.id), alsoHere: busyHere(cards, card) }),
    [cards, now, selectedId, lastOpenId, unseen],
  );

  // A card's own controls act on its host, this Mac or a worker (lib/card-handlers-host.ts).
  const renderCard = useCallback(
    (card: Card) => <CardView guardName={card.title} {...shared(card)} restartRequested={restartRequestedBy === card.id} {...handlersFor(card, ctx)} />,
    [CardView, shared, restartRequestedBy, ctx],
  );

  // Every folder a card can move to from the list view's folder picker: this Mac's, for a card that runs here.
  const folders = useMemo(() => knownFolders(cards.filter((c) => hostOf(c).can("folder"))), [cards]);

  // A card moves to another folder only on this Mac: a remote host refuses a new folder from the network.
  const renderRow = useCallback(
    (card: Card, column: Column, nest?: RowNest) => (
      <CardRow
        column={column}
        nest={nest}
        {...shared(card)}
        folders={hostOf(card).can("folder") ? folders : undefined}
        onMove={(to) => ctx.move(card.id, to)}
        onFolder={hostOf(card).can("folder") ? (cwd) => void patchNow(card.id, { cwd }, () => api.setCwd(card.id, cwd)).catch(ctx.notify) : undefined}
        {...handlersFor(card, ctx)}
      />
    ),
    [folders, ctx, shared],
  );

  return { renderCard, renderRow };
}
