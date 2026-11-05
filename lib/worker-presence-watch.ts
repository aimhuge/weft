// The board's side of worker presence (lib/worker-presence.ts), held by the local server: it asks the database once for
// the topics of your own headless workers (worker_presence_topics), joins each on one keyless socket and keeps it joined,
// so every poll of /api/worker-board or /api/workers reads who is up from memory. A worker that's no longer listed, or
// every one when the account changes, has its channel left. A worker whose topic hasn't synced yet,
// or a database without the function, is simply unknown, and its row decides (liveStatus).
import { createClient } from "@supabase/supabase-js";
import { globalSingleton } from "./global-singleton";
import { SUPABASE_KEY, SUPABASE_URL } from "./supabase-project";
import { PRESENCE_KEY, type PresenceRead } from "./worker-presence";
import type { Rpc, WorkerStatus } from "./worker-registry";

// supabase-js's channel, narrowed to what this needs, so tests hand in a fake.
export interface WatchChannel {
  on(type: "presence", filter: { event: "sync" }, callback: () => void): WatchChannel;
  subscribe(callback: (status: string) => void): WatchChannel;
  presenceState(): Record<string, unknown[]>;
}

export interface WatchClient {
  channel(topic: string): WatchChannel;
  removeChannel(channel: WatchChannel): Promise<unknown>;
}

// Who is asking, and whether ids is all their workers (the board's list) or only some (one thread's start).
export interface ReadScope {
  owner: string;
  all?: boolean;
}

interface Joined {
  channel: WatchChannel;
  synced: boolean;
}

// A worker enrolled since the last ask is looked for at most this often.
const RETRY_MS = 60_000;

const statusOf = (metas: unknown[] | undefined): WorkerStatus | null => {
  const tracked = (metas ?? []).map((m) => (m as { status?: unknown } | null)?.status);
  if (tracked.includes("busy")) return "busy";
  return tracked.includes("online") ? "online" : null;
};

export function createPresenceWatch(realtime: () => WatchClient, now: () => number = Date.now) {
  const topics = new Map<string, string>();
  const joined = new Map<string, Joined>();
  let askedAt = -Infinity;
  let owner: string | null = null;

  function leave(topic: string) {
    const entry = joined.get(topic);
    joined.delete(topic);
    if (entry) void realtime().removeChannel(entry.channel).catch(() => {});
  }

  // Leaves every channel whose worker isn't kept, and forgets its topic.
  function prune(keep: (id: string) => boolean) {
    for (const [id, topic] of topics) {
      if (keep(id)) continue;
      topics.delete(id);
      leave(topic);
    }
  }

  // A different account: none of the last one's workers count, and its topics are asked for at once.
  function switchTo(next: string) {
    if (owner === next) return;
    if (owner !== null) prune(() => false);
    owner = next;
    askedAt = -Infinity;
  }

  async function loadTopics(rpc: Rpc, ids: string[]) {
    if (ids.every((id) => topics.has(id)) || now() - askedAt < RETRY_MS) return;
    askedAt = now();
    const { data, error } = await rpc("worker_presence_topics", {});
    if (error) throw new Error(error.message);
    const rows = (data as { worker_id: string; topic: string }[] | null) ?? [];
    // The database's list is the truth: a worker removed since the last ask goes.
    prune((id) => rows.some((r) => r.worker_id === id));
    for (const row of rows) topics.set(row.worker_id, row.topic);
  }

  function join(topic: string): Joined {
    const had = joined.get(topic);
    if (had) return had;
    const entry = { synced: false } as Joined;
    entry.channel = realtime()
      .channel(topic)
      .on("presence", { event: "sync" }, () => (entry.synced = true))
      .subscribe((status) => {
        // Off the socket, what it last synced is stale; realtime-js rejoins and syncs again by itself.
        if (status !== "SUBSCRIBED") entry.synced = false;
      });
    joined.set(topic, entry);
    return entry;
  }

  // What presence says about these workers. Never throws: anything it can't learn stays unknown.
  async function read(rpc: Rpc, ids: string[], scope: ReadScope): Promise<PresenceRead> {
    const seen: PresenceRead = { known: new Set(), present: new Map() };
    try {
      switchTo(scope.owner);
      if (scope.all) prune((id) => ids.includes(id));
    } catch {
      // Leaving a channel can't fail a read.
    }
    // A database without worker_presence_topics yet: the topics it already has still count.
    await loadTopics(rpc, ids).catch(() => {});
    try {
      for (const id of ids) {
        const topic = topics.get(id);
        const entry = topic ? join(topic) : null;
        if (!entry?.synced) continue;
        seen.known.add(id);
        const status = statusOf(entry.channel.presenceState()[PRESENCE_KEY]);
        if (status) seen.present.set(id, status);
      }
    } catch {
      // No socket on this Node: the rows decide.
    }
    return seen;
  }

  return { read };
}

export type PresenceWatch = ReturnType<typeof createPresenceWatch>;

// The local server's one watch, on its own keyless client: the channels are public and the topic is the secret.
export const presenceWatch = (): PresenceWatch =>
  globalSingleton("__weftWorkerPresence", () =>
    createPresenceWatch(() => globalSingleton("__weftPresenceClient", () => createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } }))),
  );
