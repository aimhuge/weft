"use client";

import { useEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from "react";
import { announce } from "./board-helpers";
import { cardChangeEffects } from "./board-view";
import { playChime } from "./chimes";
import type { Card, Column } from "./types";

// What a card's change tells you, wherever the card runs: a desktop notification when it moved and Weft isn't in front,
// a chime unless the move was your own drag, the unseen dot, and Away open. This Mac's cards get it from the board's
// live events (lib/board-live.ts); a worker's from each read of its cards (useWorkerNotices), so a worker card that
// needs you is announced as a local one is.
export interface NoticeCtx {
  // The board's own drag moves, so their echo doesn't chime.
  ownMoves: RefObject<Map<string, { column: Column; at: number }>>;
  selectedRef: RefObject<string | null>;
  select: (id: string | null) => void;
  setUnseen: Dispatch<SetStateAction<ReadonlySet<string>>>;
  // Away open (lib/use-away-open.ts): a card moved; heard is false for the board's own drags.
  awayMove: (id: string, column: Column, heard: boolean) => void;
}

export type Seen = { column?: Column; error?: string };

export function noticeCard(card: Card, previous: Seen, ctx: NoticeCtx): void {
  const { id, column, error } = card;
  const effects = cardChangeEffects({
    previous: previous.column,
    column,
    previousError: previous.error,
    error,
    own: ctx.ownMoves.current.get(id),
    now: Date.now(),
    open: ctx.selectedRef.current === id,
  });
  if (effects.moved) {
    announce(card, () => ctx.select(id));
    ctx.ownMoves.current.delete(id);
    ctx.awayMove(id, column, Boolean(effects.chime));
  }
  if (effects.chime) playChime(effects.chime);
  if (effects.markUnseen) ctx.setUnseen((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  if (effects.errorChime) playChime("error");
}

// A worker's cards, read every few seconds: each change since the last read is noticed once. A card seen for the first
// time (the first read, or one just made) only becomes the baseline.
export function useWorkerNotices(cards: readonly Card[], ctx: NoticeCtx): void {
  const seen = useRef(new Map<string, Seen>());
  const latest = useRef(ctx);
  useEffect(() => {
    latest.current = ctx;
  });
  useEffect(() => {
    for (const card of cards) {
      const before = seen.current.get(card.id);
      seen.current.set(card.id, { column: card.column, error: card.error });
      if (before) noticeCard(card, before, latest.current);
    }
  }, [cards]);
}
