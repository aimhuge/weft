"use client";

import { useEffect, useRef } from "react";
import { lineFor, useLineRoute } from "./session-lines";
import { applyThreadEvent, type ThreadPage } from "./thread-page";
import type { PageUpdate } from "./thread-transport";

const EMPTY: ThreadPage = { items: [], start: 0, total: 0 };

// The open thread's share of the line's `events`, while the line is direct: weft.zip's board hears these beside its
// Realtime stream (components/web-board/useCloudTransport.ts), and both land by index, so one arriving twice is harmless.
export function useLineThread(workerId: string | null, cardId: string, onUpdate: (update: PageUpdate) => void) {
  const direct = useLineRoute(workerId)?.kind === "direct";
  const update = useRef(onUpdate);
  useEffect(() => {
    update.current = onUpdate;
  });
  useEffect(() => {
    if (!direct) return;
    return lineFor(workerId)?.onEvent((event) => {
      if (event.t === "thread_cleared" && event.cardId === cardId) update.current(() => EMPTY);
      if (event.t === "thread" && event.cardId === cardId) update.current((prev) => applyThreadEvent(prev, event));
    });
  }, [direct, workerId, cardId]);
  return direct;
}
