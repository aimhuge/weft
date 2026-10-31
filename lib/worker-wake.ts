// Push wake-ups for the Weft Worker (docs/architecture/weft-worker.md): a trigger on cloud_commands sends an empty
// Realtime Broadcast ping (supabase/migrations/*_worker_wake.sql), and this hears it on one socket. The worker has
// no session, so the channel is public and the topic is the secret: only the worker can derive it from its key. A
// ping says only "ask now"; commands still come through the key-checked worker_pending.
import { createHash } from "node:crypto";

export const WAKE_EVENT = "wake";
// A push to main (lib/worker-push.ts). One topic for every worker: main is public, so there's nothing to hide, and a
// ping only makes a worker fetch origin, limited by lib/worker-update-loop.ts.
export const PUSH_TOPIC = "worker-updates";
export const PUSH_EVENT = "push";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

// Must match private.worker_wake_topic, which starts from the key_hash the database holds.
export const wakeTopic = (key: string) => `worker-wake:${sha256(`weft-worker-wake:${sha256(key)}`)}`;

export interface WakeHooks {
  // A command is waiting.
  ping(): void;
  // Joined: pings will arrive. Also after a rejoin, when any sent meanwhile are gone.
  up(): void;
  // Not joined: pings won't arrive until the next up.
  down(): void;
}

// supabase-js's channel, narrowed to what this needs, so tests hand in a fake.
export interface WakeChannel {
  on(type: "broadcast", filter: { event: string }, callback: () => void): WakeChannel;
  subscribe(callback: (status: string, err?: Error) => void): WakeChannel;
}

export interface WakeClient {
  channel(topic: string): WakeChannel;
  removeChannel(channel: WakeChannel): Promise<unknown>;
}

// Node before 22 has no WebSocket, so the join can throw: the worker then just stays on its faster pace.
function join(client: WakeClient, topic: string, event: string, label: string, hooks: WakeHooks, log: (msg: string) => void): () => void {
  let left = false;
  try {
    const channel = client
      .channel(topic)
      .on("broadcast", { event }, () => hooks.ping())
      .subscribe((status, err) => {
        if (left) return;
        if (status === "SUBSCRIBED") {
          log(`Weft Worker: ${label} socket joined`);
          hooks.up();
        } else {
          log(`Weft Worker: ${label} socket: ${status}${err ? ` (${err.message})` : ""}`);
          hooks.down();
        }
      });
    return () => {
      left = true;
      void client.removeChannel(channel).catch(() => {});
    };
  } catch (err) {
    log(`Weft Worker: no ${label} socket, polling instead: ${(err as Error).message}`);
    return () => {};
  }
}

// Joins the worker's own topic; the returned function leaves it.
export const listenForWakes = (client: WakeClient, key: string, hooks: WakeHooks, log: (msg: string) => void) => join(client, wakeTopic(key), WAKE_EVENT, "wake", hooks, log);

// Joins the shared topic for pushes to main, on the same socket.
export const listenForPushes = (client: WakeClient, hooks: WakeHooks, log: (msg: string) => void) => join(client, PUSH_TOPIC, PUSH_EVENT, "update", hooks, log);
