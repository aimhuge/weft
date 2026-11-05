// The worker's browser, live in the pane (lib/worker-browser-screen.ts), with a fake page and channels: the Realtime
// frames and their pace, card.page, the relay's taps and swipes, and the session line's channel.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flush } from "./worker-browser.harness";

const notePage = vi.hoisted(() => vi.fn());
vi.mock("./card-page", () => ({ notePage }));
const browser = vi.hoisted(() => ({ pages: new Map<string, unknown>(), holds: new Map<string, () => boolean>() }));
vi.mock("./worker-browser", () => ({
  VIEW: { width: 1280, height: 800 },
  existingPage: (key: string) => browser.pages.get(key) ?? null,
  holdOpen: (key: string, hold: () => boolean) => browser.holds.set(key, hold),
}));

const ws = await import("./worker-browser-screen");

type Listener = (method: string, params: Record<string, unknown>) => void;
function fakePage() {
  const listeners = new Set<Listener>();
  const page = {
    destroyed: false,
    sent: [] as Array<[string, Record<string, unknown> | undefined]>,
    send: vi.fn((method: string, params?: Record<string, unknown>) => (page.sent.push([method, params]), Promise.resolve({}))),
    on: (l: Listener) => (listeners.add(l), () => listeners.delete(l)),
    wc: { isDestroyed: () => page.destroyed },
    frame: (data: string, metadata?: object) => listeners.forEach((l) => l("Page.screencastFrame", { data: Buffer.from(data).toString("base64"), sessionId: 7, ...(metadata ? { metadata } : {}) })),
  };
  return page;
}

let clock = 1_000_000;
const now = () => clock;
let frames: Buffer[];
let closed: number;
const channel = () => ({ send: vi.fn((f: { bytes: Buffer }) => (frames.push(f.bytes), Promise.resolve())), type: () => "jpeg" as const, answer: vi.fn(), close: () => {
    closed++;
  } });

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  frames = [];
  closed = 0;
  browser.pages.clear();
  ws.setBrowserScreenChannel(() => Promise.resolve(channel()));
});
afterEach(() => {
  ws.endLive("c1");
  ws.endLive("c2");
  vi.useRealTimers();
});

const sentOf = (page: ReturnType<typeof fakePage>, method: string) => page.sent.filter(([m]) => m === method).map(([, p]) => p);

describe("showLive", () => {
  it("does nothing without a channel opener or a page", async () => {
    await ws.showLive("c1", now);
    expect(notePage).not.toHaveBeenCalled();
    ws.setBrowserScreenChannel(null);
    browser.pages.set("c1", fakePage());
    await ws.showLive("c1", now);
    expect(notePage).not.toHaveBeenCalled();
  });

  it("starts a screencast once, names the view in card.page, and writes it again at most once a minute", async () => {
    const page = fakePage();
    browser.pages.set("c1", page);
    await Promise.all([ws.showLive("c1", now), ws.showLive("c1", now)]);
    expect(sentOf(page, "Page.startScreencast")).toEqual([{ format: "jpeg", quality: 70, maxWidth: 1280, maxHeight: 1280, everyNthFrame: 1 }]);
    const device = ws.browserDevice("c1");
    expect(ws.isBrowserScreen(device)).toBe(true);
    expect(notePage).toHaveBeenCalledTimes(1);
    expect(notePage.mock.calls[0]?.[1]).toMatch(new RegExp(`^weft-screen:[0-9a-f]{32}\\?device=${device}&name=Browser&until=${clock + ws.LIVE_MS}&fast=1`));
    expect(ws.browserWatcherOf(device)).toBe("c1");
    expect(browser.holds.get("c1")?.()).toBe(true);
    clock += 30_000;
    await ws.showLive("c1", now);
    expect(notePage).toHaveBeenCalledTimes(1);
    ws.paneMovedOn("c1");
    ws.paneMovedOn("nobody");
    await ws.showLive("c1", now);
    expect(notePage).toHaveBeenCalledTimes(2);
    clock += 61_000;
    await ws.showLive("c1", now);
    expect(notePage).toHaveBeenCalledTimes(3);
  });

  it("acks every frame, sends at most four a second, repeats the last every 3 s, and stops when the view runs out", async () => {
    const page = fakePage();
    browser.pages.set("c1", page);
    await ws.showLive("c1", now);
    page.frame("one", { deviceWidth: 1000, deviceHeight: 500 });
    page.frame("two");
    expect(sentOf(page, "Page.screencastFrameAck")).toEqual([{ sessionId: 7 }, { sessionId: 7 }]);
    expect(frames.map(String)).toEqual(["one"]);
    clock += 300;
    page.frame("three");
    expect(frames.map(String)).toEqual(["one", "three"]);
    clock += 3_000;
    vi.advanceTimersByTime(1_000);
    expect(frames.map(String)).toEqual(["one", "three", "three"]);
    vi.advanceTimersByTime(1_000);
    expect(frames).toHaveLength(3);
    clock += ws.LIVE_MS;
    vi.advanceTimersByTime(1_000);
    expect(ws.browserWatcherOf(ws.browserDevice("c1"))).toBeUndefined();
    expect(sentOf(page, "Page.stopScreencast")).toHaveLength(1);
    expect(closed).toBe(1);
    ws.endLive("c1");
  });

  it("stops when the page is gone, and keeps going when a send fails", async () => {
    const page = fakePage();
    browser.pages.set("c1", page);
    ws.setBrowserScreenChannel(() => Promise.resolve({ ...channel(), send: () => Promise.reject(new Error("socket")) }));
    await ws.showLive("c1", now);
    page.frame("x");
    await flush();
    vi.advanceTimersByTime(1_000);
    page.destroyed = true;
    vi.advanceTimersByTime(1_000);
    expect(ws.browserWatcherOf(ws.browserDevice("c1"))).toBeUndefined();
  });
});

describe("browserInput", () => {
  it("clicks a tap where it landed, wheels a swipe, and starts the view on watch", async () => {
    const page = fakePage();
    browser.pages.set("c1", page);
    expect(await ws.browserInput({ kind: "watch" }, "c1", now)).toBe("watching");
    const device = ws.browserDevice("c1");
    expect(await ws.browserInput({ kind: "tap", device, x: 0.5, y: 0.25 }, "c1", now)).toBe("click 640,200");
    expect(sentOf(page, "Input.dispatchMouseEvent").map((p) => p?.type)).toEqual(["mouseMoved", "mousePressed", "mouseReleased"]);
    page.frame("f", { deviceWidth: 1000, deviceHeight: 500 });
    expect(await ws.browserInput({ kind: "swipe", device, x: 0.5, y: 0.8, x2: 0.5, y2: 0.2 }, "c1", now)).toBe("scroll 0,300");
    expect(await ws.browserInput({ kind: "swipe", device, x: 0.5, y: 0.5 }, "c1", now)).toBe("scroll 0,0");
    expect(await ws.browserInput({ kind: "offer", device, sealed: {} as never }, "c1", now)).toBe("no offers");
  });

  it("refuses a device that isn't this card's live view", async () => {
    browser.pages.set("c1", fakePage());
    await ws.showLive("c1", now);
    await expect(ws.browserInput({ kind: "tap", device: ws.browserDevice("c2"), x: 0, y: 0 }, "c1", now)).rejects.toThrow(/isn't live/);
    // No card, no browser: "" would be one page every card-less caller shared.
    await expect(ws.browserInput({ kind: "tap", device: "x", x: 0, y: 0 }, undefined, now)).rejects.toThrow(/only for a card/);
    await expect(ws.browserInput({ kind: "watch" }, undefined, now)).rejects.toThrow(/only for a card/);
  });
});

describe("browserScreenOf", () => {
  function line() {
    const listeners: { message?: (raw: Buffer) => void; state?: (s: string) => void } = {};
    return {
      listeners,
      sent: [] as Buffer[],
      bufferedAmount: 0,
      label: "input:x:00000000",
      send(b: Buffer) {
        this.sent.push(b);
      },
      onMessage: { subscribe: (fn: (raw: Buffer) => void) => (listeners.message = fn) },
      stateChanged: { subscribe: (fn: (s: string) => void) => (listeners.state = fn) },
    };
  }

  it("is null for a device nobody's watching", () => {
    expect(ws.browserScreenOf("browser-0000000000000000")).toBeNull();
  });

  // The watched device's fast screen; the test fails here, not on a null later, when there's none.
  async function liveScreen(page: ReturnType<typeof fakePage>) {
    browser.pages.set("c1", page);
    await ws.showLive("c1", now);
    const device = ws.browserDevice("c1");
    const fast = ws.browserScreenOf(device);
    if (!fast?.input) throw new Error("no screen");
    return { device, fast, input: fast.input };
  }
  const say = (c: ReturnType<typeof line>, event: unknown) => c.listeners.message?.(Buffer.from(typeof event === "string" ? event : JSON.stringify(event)));

  it("has the view's size and no own line before a frame, and sends nothing yet", async () => {
    const { fast, input } = await liveScreen(fakePage());
    expect(fast.size).toEqual({ width: 1280, height: 800 });
    await expect(fast.connect("sdp")).rejects.toThrow(/session line only/);
    fast.close();
    const empty = line();
    input(empty as never);
    expect(empty.sent).toHaveLength(0);
  });

  it("sends frames down the line's channel, takes pointer and keys up it, and lets go when it closes", async () => {
    const page = fakePage();
    const { device } = await liveScreen(page);
    page.frame("jpeg", { deviceWidth: 1000, deviceHeight: 500 });
    const { fast, input } = await liveScreen(page);
    expect(fast.size).toEqual({ width: 1000, height: 500 });
    const c = line();
    input(c as never);
    expect(Buffer.concat(c.sent).subarray(4).toString()).toBe("jpeg");
    for (const event of [{ t: "down", x: 0.5, y: 0.5 }, { t: "move", x: 0.6, y: 0.5 }, { t: "up", x: 0.6, y: 0.5 }, { t: "key", code: 4, down: true }, { t: "key", code: 225, down: true }, { t: "key", code: 225, down: false }, { t: "text", text: "pasted" }, "not json"]) say(c, event);
    await flush();
    expect(sentOf(page, "Input.dispatchMouseEvent")).toEqual([
      { type: "mousePressed", x: 500, y: 250, button: "left", clickCount: 1 },
      { type: "mouseMoved", x: 600, y: 250, buttons: 1, button: "left" },
      { type: "mouseReleased", x: 600, y: 250, button: "left", clickCount: 1 },
    ]);
    expect(sentOf(page, "Input.dispatchKeyEvent")).toEqual([expect.objectContaining({ type: "keyDown", key: "a" })]);
    expect(sentOf(page, "Input.insertText")).toEqual([{ text: "pasted" }]);
    // A viewer far behind skips frames; one that left gets none.
    c.bufferedAmount = 2 * 1024 * 1024;
    page.frame("skipped");
    c.bufferedAmount = 0;
    c.listeners.state?.("open");
    c.listeners.state?.("closed");
    const count = c.sent.length;
    page.frame("after");
    expect(c.sent).toHaveLength(count);
    browser.pages.delete("c1");
    expect(ws.browserScreenOf(device)).toBeNull();
  });
});
