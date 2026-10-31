"use client";

import { type RefObject, useCallback, useEffect, useRef } from "react";
import { arrive, awayPrefs, leaveAway, selectedAway, setAwayOpener } from "./away-open";
import type { Column } from "./types";

// What counts as you being at the board: any pointer, key or scroll in its window.
const INPUT_EVENTS = ["pointermove", "pointerdown", "keydown", "wheel"] as const;

// The board's side of away open (lib/away-open.ts): watches for input, hands the store the board's
// select, ends the stack when you open or close a card yourself, and answers each card move.
export function useAwayOpen({
  select,
  selectedId,
  selectedRef,
  busy,
  columns,
}: {
  select: (id: string | null) => void;
  selectedId: string | null;
  // The open card, set the moment select runs: two cards arriving in one tick see the first one open.
  selectedRef: RefObject<string | null>;
  // Something holds the screen that a card mustn't open over: the New thread form, or the browser pane
  // open on its own. Input in the pane never reaches the board's window, so reading there looks like away.
  busy: boolean;
  // Each card's last known column, already updated for the move being answered.
  columns: RefObject<Map<string, Column>>;
}) {
  const lastInput = useRef(0);
  const busyRef = useRef(busy);

  useEffect(() => {
    lastInput.current = Date.now();
    const seen = () => {
      lastInput.current = Date.now();
    };
    for (const name of INPUT_EVENTS) window.addEventListener(name, seen, { passive: true, capture: true });
    return () => {
      for (const name of INPUT_EVENTS) window.removeEventListener(name, seen, { capture: true });
    };
  }, []);

  useEffect(() => {
    setAwayOpener(select, (id) => columns.current.get(id) === "needs_you");
    return () => setAwayOpener(null);
  }, [select, columns]);

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    selectedAway(selectedId);
  }, [selectedId]);

  // A card moved to column; heard is false for your own drags, which never open anything.
  return useCallback(
    (id: string, column: Column, heard: boolean) => {
      if (column !== "needs_you") {
        leaveAway(id);
        return;
      }
      if (!heard) return;
      arrive({
        id,
        selected: selectedRef.current,
        busy: busyRef.current,
        idleMs: Date.now() - lastInput.current,
        prefs: awayPrefs(),
      });
    },
    [selectedRef],
  );
}
