"use client";

// The items a worker card's thread view draws, for the show rail beside it (components/ShowRail.tsx). A local card's
// rail reads the board's own copy of the thread; a worker card's thread pages itself in through its transport
// (lib/worker-transport.ts), so its view hands what it draws to here and the rail reads it back. The board opens one
// card at a time, so one slot is enough: a newly opened card's first draw replaces the last one's.
import { useEffect, useSyncExternalStore } from "react";
import type { ThreadItem } from "./types";

const NONE: ThreadItem[] = [];
let shown: ThreadItem[] = NONE;
const listeners = new Set<() => void>();

function publish(items: ThreadItem[]) {
  if (items === shown) return;
  shown = items;
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

// The transport's useView: the items as they are, passed on to the rail once drawn.
export function useShownItems(items: ThreadItem[]): ThreadItem[] {
  useEffect(() => publish(items), [items]);
  return items;
}

// What the open worker card's thread view drew last.
export function useWorkerShown(): ThreadItem[] {
  return useSyncExternalStore(subscribe, () => shown, () => NONE);
}

// Forget the last card's items (its card closed), so the next one doesn't start with them.
export const clearShown = () => publish(NONE);
