"use client";

// A card's own actions on a Weft Worker (docs/architecture/project-hosts.md, H3): each a `host` command through this
// Mac's server, followed to its result so a refusal takes the board's change back (lib/optimistic-cards.ts).
//
// - Following backs off (0.5, 1, 2, 4 s), so archiving twenty cards isn't forty reads a second.
// - A worker that hasn't taken a command within a few seconds is offline or busy: the command stays queued, and the
//   caller gets `{ queued }`, a promise that settles when the worker runs it (or refuses it), read every 15 s. The board
//   keeps the change drawn meanwhile and the open card says how many wait (useWorkerQueued).
// - The same action again while one is on its way isn't sent twice: it joins the one already out. An opposite action
//   (unstar after star) is sent after it, and the worker runs them in order. A row can't be taken back once inserted,
//   so it isn't cancelled.
import { useSyncExternalStore } from "react";
import { apiFetch } from "./api-client";
import type { HostVerb } from "./host-api/types";
import type { HostArgs } from "./host-command";
import type { Queued } from "./optimistic-cards";
import type { LineAction, WorkerAction } from "./worker-board";
import { wakeCard, workerOfCard } from "./worker-poll";
import { noteRelay } from "./worker-route";
import { waitForCommand, type CommandResult } from "./worker-command-wait";

export async function postWorkerAction(body: WorkerAction | LineAction): Promise<{ commandId?: string; answer?: unknown }> {
  const started = Date.now();
  const res = await apiFetch("/api/worker-board", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  // A session line's offer names a worker, not a card, and isn't a relay round trip.
  if (res.ok && "cardId" in body) {
    noteRelay(workerOfCard(body.cardId), Date.now() - started);
    wakeCard(body.cardId);
  }
  const reply = (await res.json().catch(() => ({}))) as { commandId?: string; answer?: unknown; error?: string };
  if (res.ok) return reply;
  throw new Error(reply.error || `HTTP ${res.status}`);
}

// How long an action waits for its worker before it counts as queued, and how it's read after that.
export const ACT_WAIT = { every: (ask: number) => Math.min(500 * 2 ** ask, 4_000), unclaimed: 10_000, claimed: 30_000 };
export const QUEUED_WAIT = { every: 15_000, unclaimed: 3_600_000, claimed: 3_600_000 };

export type ActResult = undefined | Queued;

async function commandStatus(id: string): Promise<CommandResult> {
  const res = await apiFetch(`/api/workers?command=${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as CommandResult;
}

function outcome(result: CommandResult): undefined {
  if (result.status === "failed") throw new Error(result.error || "Your worker couldn't do that.");
  return undefined;
}

// Commands on their way, by verb and args, and how many wait per card.
const outstanding = new Map<string, Promise<ActResult>>();
const waiting = new Map<string, number>();
const listeners = new Set<() => void>();

function count(cardId: string, by: number) {
  const next = (waiting.get(cardId) ?? 0) + by;
  if (next > 0) waiting.set(cardId, next);
  else waiting.delete(cardId);
  for (const listener of [...listeners]) listener();
}

async function send(verb: HostVerb, args: HostArgs, done: () => void): Promise<ActResult> {
  try {
    const { commandId } = await postWorkerAction({ action: "host", cardId: args.id, verb, args });
    if (!commandId) {
      done();
      return undefined;
    }
    const read = () => commandStatus(commandId);
    const first = await waitForCommand(read, ACT_WAIT);
    if (first.status === "done" || first.status === "failed") {
      done();
      outcome(first);
      return undefined;
    }
    count(args.id, 1);
    const queued = waitForCommand(read, QUEUED_WAIT)
      .then(outcome)
      .finally(() => {
        count(args.id, -1);
        done();
      });
    // Whoever holds it handles a refusal; nobody holding it isn't an unhandled rejection.
    queued.catch(() => {});
    return { queued };
  } catch (err) {
    done();
    throw err;
  }
}

// One host-api verb on the worker that runs the card (lib/host-command.ts).
export function actOnWorker(verb: HostVerb, args: HostArgs): Promise<ActResult> {
  const key = `${verb} ${JSON.stringify(args)}`;
  const known = outstanding.get(key);
  if (known) return known;
  const sent = send(verb, args, () => {
    outstanding.delete(key);
  });
  outstanding.set(key, sent);
  return sent;
}

// A verb run for its answer (a read like skills.list): what the worker wrote to the row's `result`. Nothing to keep
// drawn meanwhile, so one the worker hasn't run within ACT_WAIT isn't queued for later: it fails, and the caller asks
// again next time. `wait` is longer for a verb that waits on a person, like dev.open's Touch ID.
export async function askWorker(verb: HostVerb, args: HostArgs, wait: typeof ACT_WAIT = ACT_WAIT): Promise<unknown> {
  const { commandId } = await postWorkerAction({ action: "host", cardId: args.id, verb, args });
  if (!commandId) throw new Error("Your worker didn't take that.");
  const done = await waitForCommand(() => commandStatus(commandId), wait);
  if (done.status === "done") return done.result;
  outcome(done);
  throw new Error("Your worker didn't answer. It may be offline.");
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

// How many of this card's actions wait for its worker to take them.
export function useWorkerQueued(cardId: string): number {
  return useSyncExternalStore(subscribe, () => waiting.get(cardId) ?? 0, () => 0);
}
