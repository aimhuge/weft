"use client";

// An open thread's live feed from its transport (lib/thread-transport.ts): changes to the loaded page, a re-read on
// reconnect, and the reply streaming in. A local card's streaming text comes from the board (`given`); a worker card's
// from its session line, through the transport's onStreaming. Whichever has text is what ThreadView shows.
import { useState } from "react";
import type { PageUpdate, ThreadTransport } from "./thread-transport";

export function useThreadLive(transport: ThreadTransport, cardId: string, onUpdate: (update: PageUpdate) => void, onReconnect: () => void, given: string): string {
  const [own, setOwn] = useState("");
  transport.useLive(cardId, onUpdate, onReconnect, setOwn);
  return given || own;
}
