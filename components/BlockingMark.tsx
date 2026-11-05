"use client";

import { useBlockingCount } from "@/lib/waits-on";
import Tip from "./Tip";

// "[blocking N cards]" on a card that other cards are waiting on: the user put this card first on a
// file (lib/precedence.ts), so the cards whose edits touch that file wait for it. The stamp says so
// on the card itself, so you can see what your card is holding up without opening each waiter.
// It lifts as soon as this card lets go of the file (it commits, or its turn ends), because the
// waiters are released then.
export default function BlockingMark({ cardId, titles }: { cardId: string; titles?: string[] }) {
  const count = useBlockingCount(cardId);
  if (!count) return null;
  const who = titles?.length ? `: ${titles.join(", ")}` : "";
  return (
    <Tip text={`${count} card${count === 1 ? "" : "s"} ${count === 1 ? "is" : "are"} waiting on this one for its code${who}. They resume when it commits or its turn ends.`}>
      <span className="shrink-0 rounded-md border border-warn/50 bg-warn/10 px-1.5 py-px text-[11px] font-medium text-warn" aria-label={`Blocking ${count} cards`}>
        blocking {count}
      </span>
    </Tip>
  );
}
