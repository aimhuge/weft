"use client";

// weft.zip's board in front of the desktop's own card code: its one host goes in front of every card
// (lib/project-host.ts setHostForEveryCard, lib/web-host.ts), so hostOf(card) never answers this Mac's server on the web,
// and the cards are drawn through lib/optimistic-cards.ts, so a star, a move or a Stop shows before the machine runs it.
import { useEffect, useMemo, useState } from "react";
import { onOptimistic, overlayAll } from "@/lib/optimistic-cards";
import { hostFor, setHostForEveryCard, type ProjectHost } from "@/lib/project-host";
import { useSessionLine, type MakeLine } from "@/lib/session-lines";
import type { CloudCardRow } from "@/lib/cloud-sync-types";
import type { Card } from "@/lib/types";
import { canReply } from "@/lib/web-commands";

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

// The worker's session line while one of your worker cards is open here (lib/web-lines.ts): its verbs, its thread's
// events and its live screen's H.264 track then go direct, and back on the relay whenever the line is down. None for a
// Mac's card, a teammate's card (only its owner may open a line: private.owns_device), or a browser without WebRTC.
// Returns the worker held.
export function useWebLine(make: MakeLine, row: CloudCardRow | undefined, userId: string): string | undefined {
  const device = row && canReply(row, userId) ? row.owner_device : "";
  const workerId = device.startsWith("worker:") && typeof RTCPeerConnection !== "undefined" ? device.slice("worker:".length) : undefined;
  useSessionLine(workerId, make);
  return workerId;
}
