// The worker's browser, live in the card's pane (docs/architecture/worker-browser.md#the-live-view). Chromium's own
// screencast (Page.startScreencast) hands over a JPEG whenever the page repaints; each goes two ways:
// - on the Realtime topic card.page names (lib/worker-screen.ts's channel), at most 4 a second plus one every 3 s, which
//   WorkerScreen draws on either board as it draws a simulator's frames, and a click there comes back as an `input`
//   command (a tap is a click, a swipe a wheel);
// - on a session line's `input:<device>:<nonce>` channel (lib/host-line-screen.ts), every frame, length-prefixed as the
//   fast path's video is (lib/worker-fast-screen.ts sendFrame), with the board's live pointer and keys coming back on the
//   same channel.
// The device is `browser-<16 hex>`, named after the card, so the line's channel label and the relay's own-card check
// take it as they take a simulator's.
import { createHash, randomBytes } from "node:crypto";
import { notePage } from "./card-page";
export { isBrowserScreen } from "./host-line-protocol";
import { liveEvent, type LiveEvent } from "./rtc-signal";
import { screenPage, screenTopic } from "./share-types";
import { existingPage, holdOpen, VIEW } from "./worker-browser";
import { keyFor } from "./worker-browser-keys";
import type { BrowserPage } from "./worker-browser-page";
import type { ScreenInput } from "./worker-commands";
import { quietly } from "./worker-chromium";
import { sendFrame } from "./worker-fast-screen";
import type { Channel } from "./worker-rtc";
import type { FastScreen, OpenScreenChannel, ScreenChannel } from "./worker-screen";

export const LIVE_MS = 10 * 60_000;
const FRAME_MS = 250;
const KEYFRAME_MS = 3_000;
const TICK_MS = 1_000;
// A line viewer this far behind skips frames rather than let its queue grow.
const MAX_BEHIND = 1024 * 1024;
// card.page is written again (it carries `until`) at most this often while the view keeps getting extended.
const RENOTE_MS = 60_000;

type Live = {
  key: string;
  device: string;
  token: string;
  channel: ScreenChannel;
  until: number;
  notedAt: number;
  noted: string;
  last: { bytes: Buffer; width: number; height: number } | null;
  sentAt: number;
  sinks: Set<Channel>;
  stop: () => void;
};

let open: OpenScreenChannel | null = null;
const lives = new Map<string, Live>();
const starting = new Map<string, Promise<Live>>();

// scripts/weft-worker.ts: the same Realtime opener the simulator's screen uses.
export function setBrowserScreenChannel(fn: OpenScreenChannel | null) {
  open = fn;
}

export const browserDevice = (key: string) => `browser-${createHash("sha256").update(key).digest("hex").slice(0, 16)}`;
const liveOf = (device: string) => [...lives.values()].find((l) => l.device === device);

// The card watching a browser device, for the line's own-card check.
export const browserWatcherOf = (device: string): string | undefined => liveOf(device)?.key;

function pageNamed(l: Live) {
  return screenPage(l.token, { id: l.device, name: "Browser" }, l.until, true, []);
}

function sendRealtime(l: Live, bytes: Buffer, now: number) {
  l.sentAt = now;
  quietly(l.channel.send({ type: "jpeg", bytes }));
}

function onFrame(l: Live, page: BrowserPage, params: Record<string, unknown>, now: () => number) {
  const meta = (params.metadata ?? {}) as { deviceWidth?: number; deviceHeight?: number };
  quietly(page.send("Page.screencastFrameAck", { sessionId: params.sessionId }));
  l.last = { bytes: Buffer.from(String(params.data), "base64"), width: meta.deviceWidth || VIEW.width, height: meta.deviceHeight || VIEW.height };
  for (const sink of l.sinks) if (sink.bufferedAmount < MAX_BEHIND) sendFrame(sink, l.last.bytes);
  if (now() - l.sentAt >= FRAME_MS) sendRealtime(l, l.last.bytes, now());
}

async function begin(key: string, page: BrowserPage, now: () => number): Promise<Live> {
  const token = randomBytes(16).toString("hex");
  const channel = await (open as OpenScreenChannel)(screenTopic(token));
  const base = { key, device: browserDevice(key), token, channel, until: 0, notedAt: 0, noted: "", last: null, sentAt: 0, sinks: new Set<Channel>() };
  const off = page.on((method, params) => method === "Page.screencastFrame" && onFrame(l, page, params, now));
  const tick = setInterval(() => {
    if (now() > l.until || page.wc.isDestroyed()) {
      endLive(key);
      return;
    }
    if (l.last && now() - l.sentAt >= KEYFRAME_MS) sendRealtime(l, l.last.bytes, now());
  }, TICK_MS);
  tick.unref();
  const l: Live = Object.assign(base, {
    stop: () => {
      clearInterval(tick);
      off();
      channel.close();
      quietly(page.send("Page.stopScreencast"));
    },
  });
  lives.set(key, l);
  holdOpen(key, () => lives.has(key));
  await page.send("Page.startScreencast", { format: "jpeg", quality: 70, maxWidth: 1280, maxHeight: 1280, everyNthFrame: 1 });
  return l;
}

export function endLive(key: string) {
  const l = lives.get(key);
  if (!l) return;
  lives.delete(key);
  l.stop();
}

// Starts or extends the card's live view and puts it in the card's pane. Quietly nothing when this worker can't stream
// (an older daemon) or the card has no page.
export async function showLive(key: string, now: () => number = Date.now) {
  const page = existingPage(key);
  if (!open || !page) return;
  let l = lives.get(key);
  if (!l) {
    const pending = starting.get(key) ?? begin(key, page, now).finally(() => starting.delete(key));
    starting.set(key, pending);
    l = await pending;
  }
  l.until = now() + LIVE_MS;
  const fresh = pageNamed(l);
  if (l.noted && now() - l.notedAt < RENOTE_MS) return;
  l.noted = fresh;
  l.notedAt = now();
  notePage(key, fresh);
}

// The pane now shows something else for the card (a page it wrote, uploaded): the next act puts the live view back.
export function paneMovedOn(key: string) {
  const l = lives.get(key);
  if (l) l.noted = "";
}

// Where a fraction of the screen lands on the page, in CSS pixels.
function at(l: Live, x: number, y: number) {
  const size = l.last ?? { width: VIEW.width, height: VIEW.height };
  return { x: Math.round(x * size.width), y: Math.round(y * size.height) };
}

const mouse = (page: BrowserPage, type: string, p: { x: number; y: number }, extra: Record<string, unknown> = {}) =>
  page.send("Input.dispatchMouseEvent", { type, x: p.x, y: p.y, ...extra });

async function click(page: BrowserPage, p: { x: number; y: number }) {
  await mouse(page, "mouseMoved", p);
  await mouse(page, "mousePressed", p, { button: "left", clickCount: 1 });
  await mouse(page, "mouseReleased", p, { button: "left", clickCount: 1 });
}

// A live gesture or key from the board, on the line's input channel.
export async function liveInput(l: Live, page: BrowserPage, event: LiveEvent) {
  if (event.t === "key") {
    const key = keyFor(event.code, event.down);
    if (key) await page.send("Input.dispatchKeyEvent", key);
    return;
  }
  const p = at(l, event.x, event.y);
  if (event.t === "move") await mouse(page, "mouseMoved", p, { buttons: 1, button: "left" });
  else await mouse(page, event.t === "down" ? "mousePressed" : "mouseReleased", p, { button: "left", clickCount: 1 });
}

// The `input` command for a browser device (the relay's path): a tap clicks, a swipe wheels the page the way the
// finger moved it, and the pane's Resume starts the view again.
export async function browserInput(input: ScreenInput, cardId: string | undefined, now: () => number = Date.now): Promise<string> {
  if (!cardId) throw new Error("The worker's browser takes input only for a card.");
  const key = cardId;
  if (input.kind === "watch") {
    await showLive(key, now);
    return "watching";
  }
  if (input.kind === "offer") return "no offers";
  const l = lives.get(key);
  const page = existingPage(key);
  if (!l || !page || l.device !== input.device) throw new Error("The worker's browser isn't live for this card; ask the thread to open a page again.");
  l.until = Math.max(l.until, now() + LIVE_MS);
  const from = at(l, input.x, input.y);
  if (input.kind === "tap") {
    await click(page, from);
    return `click ${from.x},${from.y}`;
  }
  const to = at(l, input.x2 ?? input.x, input.y2 ?? input.y);
  await mouse(page, "mouseWheel", from, { deltaX: from.x - to.x, deltaY: from.y - to.y });
  return `scroll ${from.x - to.x},${from.y - to.y}`;
}

// The live view as a session line sees a watched device (lib/host-line-screen.ts): no video m-line, since a browser
// has no H.264 to send, and the frames and input both on the input channel.
export function browserScreenOf(device: string): FastScreen | null {
  const l = liveOf(device);
  const page = l ? existingPage(l.key) : null;
  if (!l || !page) return null;
  return {
    size: l.last ? { width: l.last.width, height: l.last.height } : VIEW,
    connect: () => Promise.reject(new Error("The worker's browser streams on the session line only.")),
    input(channel) {
      l.sinks.add(channel);
      if (l.last) sendFrame(channel, l.last.bytes);
      channel.onMessage.subscribe((raw) => {
        const event = liveEvent(raw.toString());
        if (event) quietly(liveInput(l, page, event));
      });
      channel.stateChanged.subscribe((state) => {
        if (state === "closed") l.sinks.delete(channel);
      });
    },
    close: () => {},
  };
}
