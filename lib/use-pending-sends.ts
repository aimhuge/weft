import { useMemo, useState } from "react";
import { pendingItem, unsent, type PendingSend } from "./pending-sends";
import type { ThreadPage } from "./thread-page";

// A send the server said yes to but whose message never showed up (a wrap-up that closed the thread, say) stops
// being drawn after this long, so it can't sit in the thread for good.
export const PENDING_SEND_MS = 30_000;

let lastKey = 0;

// The open thread's sends still on their way (lib/pending-sends.ts): `track` draws a message at once and sends it,
// `items` is the page's own items with them drawn after. A refused send leaves the thread at once; the reply box puts
// its text back.
export function usePendingSends(cardId: string, page: ThreadPage) {
  const [pending, setPending] = useState<(PendingSend & { cardId: string })[]>([]);
  const drop = (key: number) => setPending((list) => list.filter((p) => p.key !== key));
  // from: the thread index the message lands at or after; by default the end of the thread as it's sent.
  const track = async <T>(text: string, call: () => Promise<T>, from = page.start + page.items.length): Promise<T> => {
    const key = ++lastKey;
    setPending((list) => [...list, { key, text, from, at: Date.now(), cardId }]);
    try {
      const result = await call();
      setTimeout(() => drop(key), PENDING_SEND_MS);
      return result;
    } catch (err) {
      drop(key);
      throw err;
    }
  };
  // The page's items with the sends still on their way after them. Memoized: a view that keys an effect on the
  // array (the web board's useCloudView marks items shown) would otherwise loop on a fresh one every render.
  const items = useMemo(() => {
    const shown = unsent(page, pending.filter((p) => p.cardId === cardId)).map(pendingItem);
    return shown.length ? [...page.items, ...shown] : page.items;
  }, [page, pending, cardId]);
  return { items, track };
}

export type TrackSend = ReturnType<typeof usePendingSends>["track"];
