// The fakes the board's session line tests share (lib/session-line.test.ts, lib/session-line-repair.test.ts): a browser-
// shaped RTCPeerConnection and data channel, and an in-memory Broadcast for the sealed answer.
import { vi } from "vitest";
import type { LineOffer } from "./host-line-protocol";
import { sealAnswer, type SealedAnswer } from "./rtc-signal";
import { createSessionLine, type LineDeps } from "./session-line";

export class FakeChannel {
  readyState = "connecting";
  sent: Record<string, unknown>[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  constructor(readonly label: string) {}
  send(text: string) {
    if (this.readyState !== "open") throw new Error("not open");
    this.sent.push(JSON.parse(text) as Record<string, unknown>);
  }
  open() {
    this.readyState = "open";
    this.onopen?.();
  }
  close() {
    this.readyState = "closed";
    this.onclose?.();
  }
  msg(v: unknown) {
    this.onmessage?.({ data: typeof v === "string" ? v : JSON.stringify(v) });
  }
}

export class FakePc {
  channels: Record<string, FakeChannel> = {};
  listeners: Record<string, (() => void)[]> = {};
  iceGatheringState = "complete";
  connectionState = "new";
  localDescription: { sdp: string } | null = null;
  remote: { type: string; sdp: string }[] = [];
  offers: unknown[] = [];
  closed = false;
  noSdp = false;
  createDataChannel(label: string) {
    return (this.channels[label] = new FakeChannel(label));
  }
  addEventListener(type: string, fn: () => void) {
    (this.listeners[type] ??= []).push(fn);
  }
  emit(type: string) {
    this.listeners[type]?.forEach((fn) => fn());
  }
  createOffer(o?: unknown) {
    this.offers.push(o);
    return Promise.resolve({ type: "offer", sdp: `offer ${this.offers.length}` });
  }
  setLocalDescription(d: { sdp: string }) {
    this.localDescription = this.noSdp ? null : d;
    return Promise.resolve();
  }
  setRemoteDescription(d: { type: string; sdp: string }) {
    this.remote.push(d);
    return Promise.resolve();
  }
  close() {
    this.closed = true;
  }
  state(s: string) {
    this.connectionState = s;
    this.emit("connectionstatechange");
  }
  openAll() {
    Object.values(this.channels).forEach((c) => c.open());
  }
}

// What the fakes saw, reset before each test (fresh()).
export const seen = { pcs: [] as FakePc[], offers: [] as LineOffer[], topics: new Map<string, (sealed: SealedAnswer) => void>(), t: 1_000 };

export function setup(over: Partial<LineDeps> = {}) {
  const deps: LineDeps = {
    peer: () => {
      const pc = new FakePc();
      seen.pcs.push(pc);
      return pc as unknown as RTCPeerConnection;
    },
    ice: () => Promise.resolve([{ urls: "turn:t", username: "u", credential: "c" }]),
    offer: vi.fn((_: string, offer: LineOffer) => Promise.resolve(seen.offers.push(offer))),
    listen: (topic, fn) => (seen.topics.set(topic, fn), () => void seen.topics.delete(topic)),
    token: () => `tok${seen.pcs.length}`,
    now: () => seen.t,
    ...over,
  };
  return { line: createSessionLine("w1", deps), deps };
}

// Web Crypto settles off the timer queue, so a flush also gives the real event loop a few turns.
export const flush = async () => {
  for (let i = 0; i < 5; i++) {
    await vi.advanceTimersByTimeAsync(0);
    await new Promise((done) => setImmediate(done));
  }
};
// Flushes until a condition holds (up to 200 turns), for work that waits on Web Crypto's thread pool, which a fixed
// number of turns can outrun on a busy machine.
export const flushUntil = async (done: () => boolean) => {
  for (let i = 0; i < 200 && !done(); i++) await flush();
};
export function last(): FakePc {
  const pc = seen.pcs.at(-1);
  if (!pc) throw new Error("No peer yet.");
  return pc;
}

export async function answer(pc = last(), offer: LineOffer | undefined = seen.offers.at(-1)) {
  if (!offer) throw new Error("No offer yet.");
  const before = pc.remote.length;
  seen.topics.get(offer.topic)?.(await sealAnswer(offer.key, "the answer"));
  await flushUntil(() => pc.remote.length > before);
  return pc;
}

export async function up() {
  const made = setup();
  await flush();
  await answer();
  last().openAll();
  return made;
}

export function fresh() {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  seen.pcs = [];
  seen.offers = [];
  seen.topics = new Map();
  seen.t = 1_000;
}

