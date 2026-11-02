// mcp__simulator__watch on a Weft Worker (docs/architecture/weft-worker.md#the-live-screen). There's no window to capture
// and no pane to open, so the device's screenshots go out as JPEGs on a Realtime Broadcast topic, and card.page names the
// topic so either board can draw it. Frames only go out when the screen changed, plus one every few seconds for a board
// that just opened, so a still screen costs almost nothing. The topic is random per watch and ends with it.
import { createHash, randomBytes } from "node:crypto";
import { notePage } from "./card-page";
import { ANSWER_EVENT, sealAnswer, type SealedAnswer } from "./rtc-signal";
import { SCREEN_EVENT, screenPage, screenTopic } from "./share-types";
import type { Device } from "./simulator-devices";
import { frameJpeg, markLive, noteWatchedSize, watch, watching, WATCH_MS } from "./simulator-watch";
import type { ScreenInput } from "./worker-commands";
import type { Sealed } from "./worker-seal";

// Four frames a second at most; a capture that takes longer sets the pace itself.
const FRAME_MS = 250;
const KEYFRAME_MS = 3_000;
const JOIN_MS = 10_000;

export interface ScreenChannel {
  send(jpg: string): Promise<unknown>;
  answer(sealed: SealedAnswer): Promise<unknown>;
  close(): void;
}

export type OpenScreenChannel = (topic: string) => Promise<ScreenChannel>;

// supabase-js's channel, narrowed to what this needs, so tests hand in a fake.
interface BroadcastChannel {
  subscribe(callback: (status: string, err?: Error) => void): unknown;
  send(message: { type: "broadcast"; event: string; payload: unknown }): Promise<unknown>;
}

interface BroadcastClient {
  channel(topic: string): unknown;
  removeChannel(channel: never): Promise<unknown>;
}

let open: OpenScreenChannel | null = null;

// The fast path, beside the JPEGs (lib/worker-fast-screen.ts): null when this device or box can't do it. The JPEGs keep
// running either way, for a board with no direct route.
export interface FastScreen {
  size: { width: number; height: number };
  // Answers a WebRTC offer; a new one replaces the line before it.
  connect: (sdp: string) => Promise<string>;
  close: () => void;
}
export type OpenFastScreen = (d: Device) => Promise<FastScreen | null>;
export type Unseal = (sealed: Sealed) => string;
let openFast: OpenFastScreen | null = null;
let unseal: Unseal | null = null;

export function setFastScreen(fn: OpenFastScreen | null, opener: Unseal | null = null) {
  openFast = fn;
  unseal = opener;
}

const fastScreens = new Map<string, { fast: FastScreen; channel: ScreenChannel }>();

async function startFast(d: Device, channel: ScreenChannel) {
  const fast = await openFast?.(d).catch(() => null);
  if (!fast) return;
  noteWatchedSize(d.id, fast.size);
  fastScreens.set(d.id, { fast, channel });
}

async function takeOffer(device: string, sealed: Sealed) {
  const screen = fastScreens.get(device);
  if (!screen || !unseal) return;
  const { sdp, key } = JSON.parse(unseal(sealed)) as { sdp: string; key: string };
  await screen.channel.answer(await sealAnswer(key, await screen.fast.connect(sdp)));
}

// What the daemon does with an `input` command: an offer opens the WebRTC line, anything else is a touch.
export function screenInput(input: ScreenInput, touch: (input: Exclude<ScreenInput, { kind: "offer" }>) => Promise<unknown>) {
  if (input.kind === "offer") return takeOffer(input.device, input.sealed);
  return touch(input).finally(() => nudgeScreen(input.device));
}

// scripts/weft-worker.ts: joins through the worker's one Realtime client.
export function setScreenChannel(fn: OpenScreenChannel | null) {
  open = fn;
}

export function openScreenChannel(client: BroadcastClient, topic: string, joinMs = JOIN_MS): Promise<ScreenChannel> {
  const channel = client.channel(topic) as BroadcastChannel;
  const leave = () => void client.removeChannel(channel as never).catch(() => {});
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      leave();
      reject(new Error("Couldn't reach the live view's channel."));
    }, joinMs);
    channel.subscribe((status, err) => {
      if (status !== "SUBSCRIBED" && status !== "CHANNEL_ERROR" && status !== "TIMED_OUT") return;
      clearTimeout(timer);
      if (status === "SUBSCRIBED") {
        resolve({
          send: (jpg) => channel.send({ type: "broadcast", event: SCREEN_EVENT, payload: { jpg } }),
          answer: (sealed) => channel.send({ type: "broadcast", event: ANSWER_EVENT, payload: sealed }),
          close: leave,
        });
        return;
      }
      leave();
      reject(new Error(`Couldn't reach the live view's channel${err ? `: ${err.message}` : "."}`));
    });
  });
}

const streams = new Map<string, string>();
const nudges = new Map<string, () => void>();

// A tap just landed: capture now rather than at the next tick, so the answer on screen comes back as soon as it can.
export const nudgeScreen = (device: string) => nudges.get(device)?.();

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

// Runs until the watch ends, however it ends. One bad capture or send doesn't stop the stream: a device mid-boot or a
// socket rejoining both come back by themselves.
export async function pump(d: Device, channel: ScreenChannel, now: () => number = Date.now, wait: (ms: number) => Promise<unknown> = sleep) {
  let last = "";
  let sentAt = 0;
  while (watching(d.id)) {
    const start = now();
    try {
      const jpg = await frameJpeg(d);
      const hash = createHash("sha1").update(jpg).digest("hex");
      if (hash !== last || start - sentAt >= KEYFRAME_MS) {
        await channel.send(jpg.toString("base64"));
        last = hash;
        sentAt = start;
      }
    } catch {
      // The next pass tries again.
    }
    await Promise.race([wait(Math.max(0, FRAME_MS - (now() - start))), new Promise<void>((go) => nudges.set(d.id, go))]);
  }
  nudges.delete(d.id);
}

// Starts or extends the stream and puts it in the card's pane; what it returns is the tool's answer.
export async function screenOnWorker(cardId: string | undefined, d: Device, now: () => number = Date.now): Promise<string> {
  if (!open) throw new Error("This worker can't stream its screen yet. Update it with weft-worker update.");
  // watch() measures the screen and lets taps through (lib/simulator-input.ts); marked live, it writes no frame files.
  await watch(d, now);
  markLive(d.id);
  const until = now() + WATCH_MS;
  let token = streams.get(d.id);
  if (!token) {
    const fresh = randomBytes(16).toString("hex");
    const channel = await open(screenTopic(fresh));
    token = fresh;
    streams.set(d.id, fresh);
    await startFast(d, channel);
    void pump(d, channel).finally(() => {
      streams.delete(d.id);
      channel.close();
      fastScreens.get(d.id)?.fast.close();
      fastScreens.delete(d.id);
    });
  }
  const fast = fastScreens.has(d.id);
  notePage(cardId, screenPage(token, d, until, fast));
  return `Streaming ${d.name} to the pane on the user's board for 10 minutes, ${fast ? "as live video where the board can connect to this box, otherwise" : ""} at up to 4 frames a second. They can tap and swipe it there. Call watch again to extend it.`;
}
