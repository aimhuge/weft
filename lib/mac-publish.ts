// What a Mac publishes for the threads on the user's Weft Workers, kept fresh: its crons (lib/mac-crons.ts) and its
// projects (lib/mac-projects.ts). Each goes a moment after a change on the bus, and every 10 minutes in case the
// sign-in changed; a failure (signed out, a database without the table yet) is logged once until a publish works again.
import { subscribe } from "./bus";
import type { BoardEvent } from "./types";

export const PUBLISH_DELAY_MS = 2_000;
export const REPUBLISH_MS = 10 * 60_000;

export interface MacPublishDeps<T> {
  // What the log calls it: "crons", "projects".
  what: string;
  read: () => T;
  put: (value: T) => Promise<unknown>;
  log?: (msg: string) => void;
  delayMs?: number;
}

// poke() after any change: the value goes once, delayMs later, however many changes came in between.
export function createMacPublisher<T>({ what, read, put, log = console.warn, delayMs = PUBLISH_DELAY_MS }: MacPublishDeps<T>) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let failing = false;
  async function flush() {
    if (timer) clearTimeout(timer);
    timer = null;
    try {
      await put(read());
      failing = false;
    } catch (err) {
      if (!failing) log(`[weft] couldn't publish this Mac's ${what} for your workers: ${(err as Error).message}`);
      failing = true;
    }
  }
  return {
    poke() {
      timer ??= setTimeout(() => void flush(), delayMs);
    },
    flush,
  };
}

// Publishes at once, after each event `changed` picks, and every `every` ms. Answers the way to stop it.
export function startMacPublish(publisher: ReturnType<typeof createMacPublisher>, changed: (event: BoardEvent) => boolean, every = REPUBLISH_MS): () => void {
  const off = subscribe((event) => {
    if (changed(event)) publisher.poke();
  });
  void publisher.flush();
  const tick = setInterval(() => void publisher.flush(), every);
  tick.unref();
  return () => {
    off();
    clearInterval(tick);
  };
}
