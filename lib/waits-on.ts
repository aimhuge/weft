"use client";

import { useSyncExternalStore } from "react";
import { claimFileName } from "./claim-keys";
import type { Card } from "./types";

// Who is waiting on whom, for the holder's side of a claim clash: a card held on another card's code
// (lib/permission-wait.ts) shows on the holder's thread with You first (components/YouFirst.tsx), which puts
// the waiting card first (lib/precedence.ts). The board publishes its cards here (lib/use-board-card-actions.ts),
// so the thread reads it without the list threaded through every component between them.

export interface Waiter {
  id: string;
  title: string;
  emoji?: string;
  thumb?: string;
  // The waiting request, for Me first; and the file it waits on, by name.
  pendingId: string;
  file: string;
}

// The waiting cards, by the card they wait on.
export function waitersOf(cards: readonly Card[]) {
  const map = new Map<string, Waiter[]>();
  for (const c of cards) {
    const holder = c.pending?.waiting ? c.pending.why?.holder : undefined;
    if (!c.pending || !holder) continue;
    const list = map.get(holder.id) ?? [];
    list.push({ id: c.id, title: c.title, emoji: c.emoji, thumb: c.thumb, pendingId: c.pending.id, file: claimFileName(holder.claim) });
    map.set(holder.id, list);
  }
  return map;
}

const NONE: Waiter[] = [];
let waits = new Map<string, Waiter[]>();
let signature = "";
const listeners = new Set<() => void>();

// Called with every new card list; listeners hear only when who waits on whom changed.
export function publishWaits(cards: readonly Card[]) {
  const next = waitersOf(cards);
  const sig = JSON.stringify([...next]);
  if (sig === signature) return;
  signature = sig;
  waits = next;
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const useWaitersOn = (cardId: string) =>
  useSyncExternalStore(subscribe, () => waits.get(cardId) ?? NONE, () => NONE);
