"use client";

import { useCallback, useMemo, type ComponentType } from "react";
import type { Card, Column } from "./types";
import type { CardActionsCtx } from "./card-handlers";
import { handlersFor } from "./card-handlers-host";
import { busyHere } from "./overlap";
import { api } from "./client";
import { knownFolders } from "./list-actions";
import { patchNow } from "./optimistic-cards";
import { hostOf, sameHostCards } from "./project-host";
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

  const shared = useCallback(
    (card: Card) => ({ card, now, selected: card.id === selectedId, lastOpen: card.id === lastOpenId, unseen: unseen.has(card.id), alsoHere: busyHere(cards, card) }),
    [cards, now, selectedId, lastOpenId, unseen],
  );

  // A card's own controls act on its host, this Mac or a worker (lib/card-handlers-host.ts).
  const renderCard = useCallback(
    (card: Card) => <CardView guardName={card.title} {...shared(card)} restartRequested={restartRequestedBy === card.id} {...handlersFor(card, ctx)} readOnly={Boolean(card.team)} />,
    [CardView, shared, restartRequestedBy, ctx],
  );

  // Every folder a card can move to from the list view's folder picker: its own host's (this Mac's, or one worker's).
  const folders = useMemo(() => knownFolders(cards.filter((c) => !isWorkerCard(c))), [cards]);
  const foldersFor = useCallback((card: Card) => (hostOf(card).can("folder") ? knownFolders(sameHostCards(cards, card)) : undefined), [cards]);

  // A worker card moves only with a signed approval, which its host asks Touch ID for (lib/widen-signer.ts).
  // A teammate's card (lib/team-host.ts) only opens: it runs on their Mac.
  const renderRow = useCallback(
    (card: Card, column: Column, nest?: RowNest) => card.team ? <CardRow column={column} nest={nest} {...shared(card)} onOpen={() => ctx.openCard(card)} /> : (
      <CardRow
        column={column}
        nest={nest}
        {...shared(card)}
        folders={isWorkerCard(card) ? foldersFor(card) : hostOf(card).can("folder") ? folders : undefined}
        onMove={(to) => ctx.move(card.id, to)}
        onFolder={
          hostOf(card).can("folder")
            ? (cwd) => void patchNow(card.id, { cwd }, () => hostOf(card).act("card.update", { id: card.id, body: { cwd } }, () => api.setCwd(card.id, cwd))).catch(ctx.notify)
            : undefined
        }
        {...handlersFor(card, ctx)}
      />
    ),
    [folders, foldersFor, ctx, shared],
  );

  return { renderCard, renderRow };
}
