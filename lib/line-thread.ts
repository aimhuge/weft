"use client";

import { useEffect, useRef } from "react";
import { NOT_STREAMING, streamedAfter } from "./line-streaming";
import { lineFor, useLineRoute } from "./session-lines";
import { applyThreadEvent, type ThreadPage } from "./thread-page";
import type { PageUpdate } from "./thread-transport";

const EMPTY: ThreadPage = { items: [], start: 0, total: 0 };

// The open thread's share of the line's `events`, while the line is direct: weft.zip's board hears these beside its
// Realtime stream (components/web-board/useCloudTransport.ts), and both land by index, so one arriving twice is harmless.
// The reply types out as it streams (`delta` events, lib/line-streaming.ts) for a caller that passes onStreaming.
export function useLineThread(workerId: string | null, cardId: string, onUpdate: (update: PageUpdate) => void, onStreaming?: (text: string) => void) {
  const direct = useLineRoute(workerId)?.kind === "direct";
  const update = useRef(onUpdate);
  const streaming = useRef(onStreaming);
  useEffect(() => {
    update.current = onUpdate;
    streaming.current = onStreaming;
  });
  useEffect(() => {
    if (!direct) return;
    let streamed = NOT_STREAMING;
    const off = lineFor(workerId)?.onEvent((event) => {
      if (event.t === "thread_cleared" && event.cardId === cardId) update.current(() => EMPTY);
      if (event.t === "thread" && event.cardId === cardId) update.current((prev) => applyThreadEvent(prev, event));
      const next = streamedAfter(streamed, event, cardId);
      if (next !== streamed) streaming.current?.((streamed = next).text);
    });
    // Another card, or the line went: what was streaming isn't any more (the re-read page has the reply if it landed).
    return () => {
      off?.();
      if (streamed.text) streaming.current?.("");
    };
  }, [direct, workerId, cardId]);
  return direct;
}
