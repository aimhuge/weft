"use client";

import { useCallback, useRef } from "react";
import { api } from "./client";
import { addTag } from "./rail-view";
import type { Card, Column } from "./types";
import { compareCardOrder, ordersForSlot } from "./card-order";

// What the board does to a card beyond opening it: drag a card to another column, drop it on a tag in
// the 🏷 drawer, drop it on a backlog card to reorder, and remember a move you just made so its
// chime is skipped (lib/board-view.ts).
export interface BoardCardActions {
  // The latest cards (Board.tsx) — read fresh on each call so the actions see what the user just did.
  cards: readonly Card[];
  // Apply an optimistic update to the cards state. Used by reorder so the new order lands
  // before the server's PATCH round-trips.
  setCards: (updater: (cards: Card[]) => Card[]) => void;
  setDragOver: (column: Column | null) => void;
  notify: (err: unknown) => void;
}

export function useBoardCardActions({ cards, setCards, setDragOver, notify }: BoardCardActions) {
  // Moves you made, by card: where to and when, so the next event for that card skips its chime.
  const ownMoves = useRef(new Map<string, { column: Column; at: number }>());

  // Moves a card for you, remembering it so the move doesn't chime. The card lands in its new
  // column right away; if the server refuses (a busy thread, Running from anywhere but Backlog),
  // it goes back where it was, unless something else has moved it since.
  const move = useCallback(
    (id: string, column: Column) => {
      ownMoves.current.set(id, { column, at: Date.now() });
      const from = cards.find((c) => c.id === id)?.column;
      const setColumn = (to: Column, unless?: Column) =>
        setCards((cur) => cur.map((c) => (c.id === id && (!unless || c.column === unless) ? { ...c, column: to } : c)));
      if (from && from !== column) setColumn(column);
      api.move(id, column).catch((err: unknown) => {
        if (from && from !== column) setColumn(from, column);
        notify(err);
      });
    },
    [cards, setCards, notify],
  );

  // A card dropped on a column moves there if it's not already; clears the drag highlight.
  const drop = useCallback(
    (column: Column, e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(null);
      const id = e.dataTransfer.getData("text/plain");
      const card = cards.find((c) => c.id === id);
      if (card && card.column !== column) move(id, column);
    },
    [cards, setDragOver, move],
  );

  // A card dropped on a tag in the 🏷 drawer gets that tag.
  const tagCard = useCallback(
    (cardId: string, tag: string) => {
      const card = cards.find((c) => c.id === cardId);
      const next = card && addTag(card.tags, tag);
      if (next) api.mark(cardId, { tags: next }).catch(notify);
    },
    [cards, notify],
  );

  // A backlog card dropped on a sibling. `before` is the indicator side: true for the top
  // half (place before target), false for the bottom (place after). Mirrors the same
  // order calculation as lib/store.ts reorderCard, so optimistic and persisted order match.
  const reorder = useCallback(
    (id: string, target: string, before: boolean) => {
      const moved = cards.find((c) => c.id === id);
      if (!moved) return;
      // Siblings in the same column, sorted by current order with createdAt as a stable tie-breaker.
      const siblings = cards
        .filter((c) => c.column === moved.column && c.id !== id)
        .slice()
        .sort(compareCardOrder);
      const targetIndex = siblings.findIndex((c) => c.id === target);
      if (targetIndex < 0) return;
      // The drop slot: top half -> before target; bottom half -> after target.
      const slot = before ? targetIndex : targetIndex + 1;
      const orderChanges = ordersForSlot(siblings, id, slot);
      setCards((cur) => cur.map((c) => {
        const order = orderChanges.get(c.id);
        return order === undefined ? c : { ...c, order };
      }));
      // The API's `before` anchor expresses both halves: after a card means before its
      // next sibling, or append when the target is last.
      api.reorder(id, siblings[slot]?.id ?? null).catch(notify);
    },
    [cards, setCards, notify],
  );

  return { ownMoves, move, drop, reorder, tagCard };
}
