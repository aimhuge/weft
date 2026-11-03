// A worker card's reply as it streams, for the session lines' `events` (docs/architecture/project-hosts.md, the session
// line): the runner's text deltas (lib/runner-turn.ts publishes `delta` on the bus, as it does on a Mac) coalesced to one
// event per card every DELTA_MS, so a fast model sends a few dozen messages a second, not hundreds.
//
// - Redacted like the rows: the whole reply so far goes through redactText each time, and only what follows what was
//   already sent goes out. When a later match rewrites text already sent (a key that turned out longer), the event
//   carries the whole redacted reply with `reset`.
// - The word still being typed is held back until whitespace follows it: it could be the first half of a key the
//   redactor can't recognise yet. The finished reply lands as its item a moment later anyway.
// - `index` is the thread's length when the reply began, so the board starts a fresh reply when it changes.
import type { LineEvent } from "./host-line-protocol";
import { redactText } from "./share-redact";

export const DELTA_MS = 50;

type Stream = { index: number; raw: string; sent: string };

// The end of the last whitespace run: everything before it is whole words.
function wholeWords(text: string): string {
  const match = /\s(?=\S*$)/.exec(text);
  return match ? text.slice(0, match.index + 1) : "";
}

export function createDeltaStream(emit: (event: Extract<LineEvent, { t: "delta" }>) => void, indexOf: (cardId: string) => number, ms = DELTA_MS) {
  const streams = new Map<string, Stream>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  function send(cardId: string, s: Stream) {
    const safe = redactText(wholeWords(s.raw));
    if (safe === s.sent) return;
    const follows = safe.startsWith(s.sent);
    emit({ t: "delta", cardId, index: s.index, text: follows ? safe.slice(s.sent.length) : safe, ...(follows ? {} : { reset: true }) });
    s.sent = safe;
  }

  function tick() {
    timer = null;
    streams.forEach((s, cardId) => send(cardId, s));
  }

  return {
    // More of a card's reply.
    add(cardId: string, text: string) {
      let s = streams.get(cardId);
      if (!s) streams.set(cardId, (s = { index: indexOf(cardId), raw: "", sent: "" }));
      s.raw += text;
      timer ??= setTimeout(tick, ms);
    },
    // The reply landed as an item (or the card went): what's still held back is dropped, and the next delta starts anew.
    end: (cardId: string) => void streams.delete(cardId),
    stop() {
      if (timer) clearTimeout(timer);
      timer = null;
      streams.clear();
    },
  };
}

export type DeltaStream = ReturnType<typeof createDeltaStream>;
