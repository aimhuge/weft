"use client";

// The board's session lines, one per worker (lib/session-line.ts), shared by everything that shows that worker: the
// selected project's chip and the open card each hold it while they're on screen, and it closes LINGER_MS after the
// last lets go, so stepping between a worker's cards or projects doesn't reconnect. CloudHost reads lineFor() to take the
// direct route (lib/line-host.ts), and the line's pings set the worker chip's route (lib/worker-route.ts).
import { useEffect, useSyncExternalStore } from "react";
import { apiFetch } from "./api-client";
import { iceServers, type LineEvent } from "./host-line-protocol";
import { lineToken, listenForAnswer } from "./line-answer";
import { createSessionLine, type LineRoute, type SessionLine } from "./session-line";
import { postWorkerAction } from "./worker-acts";
import { setWorkerRoute } from "./worker-route";

export const LINGER_MS = 30_000;

type Entry = { line: SessionLine; users: number; linger?: ReturnType<typeof setTimeout>; direct?: boolean };
const lines = new Map<string, Entry>();
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((fn) => fn());
const heard = new Set<(workerId: string, event: LineEvent) => void>();

// Every line's events, named by worker: the board's card list reads card changes off them (lib/use-worker-board.ts).
export function onLineEvents(fn: (workerId: string, event: LineEvent) => void) {
  heard.add(fn);
  return () => void heard.delete(fn);
}

const flips = new Set<(workerId: string, direct: boolean) => void>();

// A worker's line coming up (its route turned direct) or going down: the board's card list takes a snapshot over it, or
// goes back to polling fast (lib/use-worker-board.ts).
export function onLineFlips(fn: (workerId: string, direct: boolean) => void) {
  flips.add(fn);
  return () => void flips.delete(fn);
}

async function ice() {
  const res = await apiFetch("/api/rtc-ice");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return iceServers(((await res.json()) as { iceServers?: unknown }).iceServers);
}

export type MakeLine = (workerId: string) => SessionLine;

const realLine: MakeLine = (workerId) =>
  createSessionLine(workerId, {
    peer: (servers) => new RTCPeerConnection({ iceServers: servers }),
    ice,
    offer: (id, offer) => postWorkerAction({ action: "line", workerId: id, offer }),
    listen: listenForAnswer,
    token: lineToken,
  });

// Holds the worker's line open; the returned function lets go.
export function retainLine(workerId: string, make: MakeLine = realLine): () => void {
  let entry = lines.get(workerId);
  if (!entry) {
    const fresh: Entry = { line: make(workerId), users: 0 };
    // Each pong is the worker chip's "direct · N ms" (lib/worker-route.ts); once they stop, relay notes take over.
    fresh.line.onRoute(() => {
      const route = fresh.line.route();
      if (route.kind === "direct" && route.ms !== null) setWorkerRoute(workerId, "direct", route.ms);
      const direct = route.kind === "direct";
      if (direct !== Boolean(fresh.direct)) {
        fresh.direct = direct;
        flips.forEach((fn) => fn(workerId, direct));
      }
      changed();
    });
    fresh.line.onEvent((event) => heard.forEach((fn) => fn(workerId, event)));
    lines.set(workerId, (entry = fresh));
    changed();
  }
  const held = entry;
  clearTimeout(held.linger);
  held.users += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    held.users -= 1;
    if (held.users > 0) return;
    // Holding it again clears this timer, and so does closeLines.
    held.linger = setTimeout(() => {
      lines.delete(workerId);
      held.line.close();
      changed();
    }, LINGER_MS);
  };
}

export const lineFor = (workerId: string | null | undefined): SessionLine | null => (workerId ? (lines.get(workerId)?.line ?? null) : null);

// Closes every line at once (tests, and a board signing out).
export function closeLines() {
  lines.forEach((entry) => {
    clearTimeout(entry.linger);
    entry.line.close();
  });
  lines.clear();
  changed();
}

const canLine = () => typeof RTCPeerConnection !== "undefined";

// Holds the line to this worker while the caller is on screen. Null holds none.
export function useSessionLine(workerId: string | null | undefined, make?: MakeLine) {
  useEffect(() => (workerId && (make || canLine()) ? retainLine(workerId, make) : undefined), [workerId, make]);
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

// Any line held, let go, or changing route (each pong included): an open file's watch re-asks on a line that came up.
export const onLinesChange = subscribe;

export function useLineRoute(workerId: string | null | undefined): LineRoute | null {
  // The server has no lines, so the same read is its snapshot too.
  const read = () => lineFor(workerId)?.route() ?? null;
  return useSyncExternalStore(subscribe, read, read);
}
