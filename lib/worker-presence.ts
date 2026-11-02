// A Weft Worker's liveness as Realtime Presence (docs/architecture/weft-worker.md#liveness). The worker tracks itself on
// a public topic only it and its owner's boards can name, so "is it up" costs no row write; the row still gets one every
// few minutes, for last-seen and for a board that can't reach Realtime (supabase/migrations/*_worker_upkeep.sql).
import { createHash } from "node:crypto";
import type { WorkerStatus } from "./worker-registry";

// The one presence key a worker tracks under, so a board reads presenceState()[PRESENCE_KEY].
export const PRESENCE_KEY = "worker";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

// Must match private.worker_presence_topic, which starts from the key_hash the database holds.
export const presenceTopic = (key: string) => `worker-presence:${sha256(`weft-worker-presence:${sha256(key)}`)}`;

export interface PresenceHooks {
  // Tracked: boards on the topic see it. Also after a rejoin.
  up(): void;
  // Not joined: boards only have the row.
  down(): void;
}

export interface Presence {
  track(status: WorkerStatus): void;
  leave(): void;
}

// supabase-js's channel, narrowed to what this needs, so tests hand in a fake.
export interface PresenceChannel {
  subscribe(callback: (status: string, err?: Error) => void): PresenceChannel;
  track(payload: { status: WorkerStatus }): Promise<unknown>;
}

export interface PresenceClient {
  channel(topic: string, opts: { config: { presence: { key: string } } }): PresenceChannel;
  removeChannel(channel: PresenceChannel): Promise<unknown>;
}

const NO_PRESENCE: Presence = { track: () => {}, leave: () => {} };

// Joins the worker's presence topic on the client's one socket. Node before 22 has no WebSocket, so the join can throw:
// the worker then stays on its 20 s row beat.
export function joinPresence(client: PresenceClient, key: string, hooks: PresenceHooks, log: (msg: string) => void): Presence {
  let left = false;
  let joined = false;
  try {
    const channel = client.channel(presenceTopic(key), { config: { presence: { key: PRESENCE_KEY } } }).subscribe((status, err) => {
      if (left) return;
      joined = status === "SUBSCRIBED";
      if (joined) {
        log("Weft Worker: presence socket joined");
        hooks.up();
      } else {
        log(`Weft Worker: presence socket: ${status}${err ? ` (${err.message})` : ""}`);
        hooks.down();
      }
    });
    return {
      track(status) {
        if (!joined || left) return;
        channel.track({ status }).catch((e: unknown) => log(`Weft Worker: presence: ${(e as Error).message}`));
      },
      leave() {
        left = true;
        void client.removeChannel(channel).catch(() => {});
      },
    };
  } catch (err) {
    log(`Weft Worker: no presence socket, beating the row instead: ${(err as Error).message}`);
    return NO_PRESENCE;
  }
}

// What a board knows from presence: the workers whose topic it has synced, and the status each present one tracks.
export interface PresenceRead {
  known: Set<string>;
  present: Map<string, WorkerStatus>;
}

// A worker whose socket is down writes its row every 20 s (lib/worker-beat.ts), so this is the old threshold.
export const FRESH_AFTER_MS = 60_000;
// One whose socket is up writes it every 5 minutes: two missed beats and some slack, for a board without presence.
export const SLOW_OFFLINE_AFTER_MS = 11 * 60_000;

interface LiveRow {
  id: string;
  status: WorkerStatus;
  last_seen_at: string | null;
}

// A headless worker's status: present means up; a fresh row means up (its socket is down, or it just said so);
// synced but absent means down; and a board without presence reads the row against the slow beat.
export function liveStatus(row: LiveRow, seen: PresenceRead | null, now: number): WorkerStatus {
  const tracked = seen?.present.get(row.id);
  if (tracked) return tracked;
  const age = row.last_seen_at ? now - Date.parse(row.last_seen_at) : Infinity;
  if (age <= FRESH_AFTER_MS) return row.status;
  if (seen?.known.has(row.id)) return "offline";
  return age <= SLOW_OFFLINE_AFTER_MS ? row.status : "offline";
}
