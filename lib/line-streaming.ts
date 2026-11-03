// The open worker card's reply as it streams in over its session line (lib/line-deltas.ts on the worker): the same
// `streaming` text a local card's ThreadView shows from the bus (lib/board-live.ts), built from `delta` events. A delta
// for another reply (its `index`, the thread's length when that reply began) starts the text anew, as `reset` does, and
// the finished reply landing as its item ends it, as on a Mac.
import type { LineEvent } from "./host-line-protocol";

export interface Streamed {
  index: number;
  text: string;
}

export const NOT_STREAMING: Streamed = { index: -1, text: "" };

// The streaming text after an event on this card's line; the same object when the event doesn't touch it.
export function streamedAfter(prev: Streamed, event: LineEvent, cardId: string): Streamed {
  if (event.t === "thread_cleared" && event.cardId === cardId) return NOT_STREAMING;
  if (event.t === "thread" && event.cardId === cardId && (event.item.kind === "assistant" || event.item.kind === "result")) return NOT_STREAMING;
  if (event.t !== "delta" || event.cardId !== cardId) return prev;
  const fresh = event.reset || event.index !== prev.index;
  return { index: event.index, text: fresh ? event.text : prev.text + event.text };
}
