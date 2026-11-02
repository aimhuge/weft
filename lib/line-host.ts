"use client";

// CloudHost on its two routes (docs/architecture/project-hosts.md#routes-the-webrtc-line): the worker's session line
// when it's up (lib/session-lines.ts), the relay (cloud_commands and polling, lib/worker-acts.ts) when it isn't.
//
// - A verb goes on the line's `host` channel, and the worker runs it through the host command's own checks. One the line
//   couldn't send (LineDown) takes the relay instead; one it sent and then lost (LineLost) is refused rather than sent
//   twice, since the worker may have run it. Text that pastes files goes by the relay, which uploads them first.
// - The open thread hears the line's `events` instead of the 2.5 s poll, and re-reads its newest page whenever the line
//   comes up or goes down, so nothing between the poll and the push is missed.
import { useEffect, useRef } from "react";
import type { HostVerb } from "./host-api/types";
import type { HostArgs } from "./host-command";
import { MEDIA_REF } from "./media";
import { LineDown } from "./session-line-calls";
import { lineFor, useLineRoute } from "./session-lines";
import { applyThreadEvent, type ThreadPage } from "./thread-page";
import type { PageUpdate, ThreadTransport } from "./thread-transport";
import { actOnWorker, askWorker, type ActResult } from "./worker-acts";
import { workerFilesVia } from "./worker-files";
import { useWorkerLive, workerTransportVia } from "./worker-transport";
import { signedArgs } from "./widen-signer";

const EMPTY: ThreadPage = { items: [], start: 0, total: 0 };

const pastesFiles = (args: HostArgs) => Object.values(args).some((v) => typeof v === "string" && new RegExp(MEDIA_REF.source).test(v));

// What the network would refuse goes with a signed approval for exactly that change (lib/widen-signer.ts).
export async function actOnLine(workerId: string, verb: HostVerb, given: HostArgs): Promise<ActResult> {
  const args = await signedArgs(workerId, verb, given);
  const line = lineFor(workerId);
  if (!line?.up() || pastesFiles(args)) return actOnWorker(verb, args);
  try {
    await line.call(verb, args);
    return undefined;
  } catch (err) {
    if (err instanceof LineDown) return actOnWorker(verb, args);
    throw err;
  }
}

// A verb run for its answer (the editor's files.*): the line's `host` channel answers with the same HostResult the relay
// writes to the row, `value` or `blob`, so lib/worker-files.ts reads either alike. LineDown takes the relay.
export async function askOnLine(workerId: string, verb: HostVerb, args: HostArgs): Promise<unknown> {
  const line = lineFor(workerId);
  if (!line?.up()) return askWorker(verb, args);
  try {
    return await line.call(verb, args);
  } catch (err) {
    if (err instanceof LineDown) return askWorker(verb, args);
    throw err;
  }
}

const files = new Map<string, ReturnType<typeof workerFilesVia>>();

// The editor's files for a worker's cards, over its line when it's up.
export function lineFiles(workerId: string) {
  let f = files.get(workerId);
  if (!f) files.set(workerId, (f = workerFilesVia((verb, args) => askOnLine(workerId, verb, args))));
  return f;
}

// card.warm only where it's free: on a line that's up. Without one a cold start is fine, as on this Mac's own best effort.
export function warmOnLine(workerId: string, cardId: string): void {
  const line = lineFor(workerId);
  if (line?.up()) line.call("card.warm", { id: cardId }).catch(() => {});
}

export function useLineLive(workerId: string, cardId: string, onUpdate: (update: PageUpdate) => void, onReconnect: () => void) {
  const direct = useLineRoute(workerId)?.kind === "direct";
  const update = useRef(onUpdate);
  const reconnect = useRef(onReconnect);
  useEffect(() => {
    update.current = onUpdate;
    reconnect.current = onReconnect;
  });
  useWorkerLive(cardId, onUpdate, !direct);
  const first = useRef(true);
  useEffect(() => {
    // The route changed: read the newest page once, to cover what neither route carried meanwhile.
    if (first.current) first.current = false;
    else reconnect.current();
    if (!direct) return;
    return lineFor(workerId)?.onEvent((event) => {
      if (event.t === "thread_cleared" && event.cardId === cardId) update.current(() => EMPTY);
      if (event.t === "thread" && event.cardId === cardId) update.current((prev) => applyThreadEvent(prev, event));
    });
  }, [direct, workerId, cardId]);
}

const transports = new Map<string, ThreadTransport>();

// The thread transport for a worker's cards, one per worker.
export function lineTransport(workerId: string): ThreadTransport {
  let t = transports.get(workerId);
  if (!t) {
    t = workerTransportVia(
      (verb, args) => actOnLine(workerId, verb, args),
      (cardId, onUpdate, onReconnect) => useLineLive(workerId, cardId, onUpdate, onReconnect),
      lineFiles(workerId),
    );
    transports.set(workerId, t);
  }
  return t;
}
