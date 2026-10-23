"use client";

import { useEffect, useRef } from "react";
import type { BoardEvent } from "./types";

// One EventSource per window, shared by every hook that listens. Each stream holds an HTTP/1.1
// connection for good, and Chromium allows six per host: the board, the open thread and the copilot's
// two used to open four, so with a few slow polls a dialog's fetch (Share… on a mini app) queued in the
// renderer and never reached the server. The stream opens with the first listener and closes with the last.
interface Listener {
  onEvent: (event: BoardEvent) => void;
  onOpen: () => void;
}

let stream: EventSource | null = null;
let open = false;
const listeners = new Set<Listener>();

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  if (!stream) {
    stream = new EventSource("/api/events");
    stream.onopen = () => {
      open = true;
      for (const l of [...listeners]) l.onOpen();
    };
    stream.onmessage = (message: MessageEvent<string>) => {
      const event = JSON.parse(message.data) as BoardEvent;
      for (const l of [...listeners]) l.onEvent(event);
    };
  } else if (open) {
    listener.onOpen(); // joined a stream that's already up: reload what it might have missed, as a fresh connect would
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size || !stream) return;
    stream.close();
    stream = null;
    open = false;
  };
}

// Subscribes to the server's live event stream. onOpen runs on the first connect and every
// reconnect, so callers can reload anything they might have missed.
export function useBoardEvents(onEvent: (event: BoardEvent) => void, onOpen: () => void) {
  const handlers = useRef({ onEvent, onOpen });

  useEffect(() => {
    handlers.current = { onEvent, onOpen };
  });

  useEffect(
    () =>
      subscribe({
        onEvent: (event) => handlers.current.onEvent(event),
        onOpen: () => handlers.current.onOpen(),
      }),
    [],
  );
}
