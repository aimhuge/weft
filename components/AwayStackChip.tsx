"use client";

import { useSyncExternalStore } from "react";
import { awayStack, nextAway, subscribeAwayStack } from "@/lib/away-open";

const NONE: readonly string[] = [];

// "1 of 3 waiting · Next ›" in the header of a card away open opened (lib/away-open.ts), while more cards
// wait behind it. Nothing for a card you opened yourself, or the last one in the stack.
export default function AwayStackChip({ id }: { id: string }) {
  const stack = useSyncExternalStore(subscribeAwayStack, awayStack, () => NONE);
  if (stack.length < 2 || stack[0] !== id) return null;
  return (
    <button
      type="button"
      onClick={() => nextAway()}
      title="Cards that needed you while you were away. Answering this one opens the next."
      className="flex shrink-0 items-center gap-1 self-center rounded-full bg-warn/15 px-2 py-0.5 text-[11.5px] font-medium text-ink hover:bg-warn/25"
    >
      1 of {stack.length} waiting
      <span className="text-muted">· Next ›</span>
    </button>
  );
}
