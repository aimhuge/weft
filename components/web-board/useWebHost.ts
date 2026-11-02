"use client";

// weft.zip's board in front of the desktop's own card code: its one host goes in front of every card
// (lib/project-host.ts setHostForEveryCard, lib/web-host.ts), so hostOf(card) never answers this Mac's server on the web,
// and the cards are drawn through lib/optimistic-cards.ts, so a star, a move or a Stop shows before the machine runs it.
import { useEffect, useMemo, useState } from "react";
import { onOptimistic, overlayAll } from "@/lib/optimistic-cards";
import { hostFor, setHostForEveryCard, type ProjectHost } from "@/lib/project-host";
import type { Card } from "@/lib/types";

export function useHostForEveryCard(host: ProjectHost) {
  // In place from the first render: the tiles pick their handlers by their host as they draw.
  if (hostFor(null) !== host) setHostForEveryCard(host);
  useEffect(() => setHostForEveryCard(host), [host]);
}

// The cards with what's on its way drawn on them; redrawn whenever an intent opens or settles.
export function useOptimisticCards(cards: Card[]): Card[] {
  const [tick, setTick] = useState(0);
  useEffect(() => onOptimistic(() => setTick((t) => t + 1)), []);
  return useMemo(() => (tick >= 0 ? overlayAll(cards) : cards), [cards, tick]);
}
