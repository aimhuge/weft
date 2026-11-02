import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Device } from "./simulator-devices";

const sim = vi.hoisted(() => ({ frame: vi.fn(), markLive: vi.fn(), noteWatchedSize: vi.fn(), stopWatching: vi.fn(), watch: vi.fn(), watching: vi.fn() }));
const devices = vi.hoisted(() => ({ boot: vi.fn(), listDevices: vi.fn((): Promise<Device[]> => Promise.resolve([])), pickDevice: vi.fn() }));
const notePage = vi.hoisted(() => vi.fn());
vi.mock("./simulator-watch", () => ({ ...sim, WATCH_MS: 600_000 }));
// The capture hands back raw bytes; the frame's type is the box's (lib/screen-frame.ts).
const box: { type: "webp" | "jpeg" } = vi.hoisted(() => ({ type: "webp" }));
vi.mock("./screen-frame", () => ({ frameType: () => box.type, screenFrame: async (dev: Device, type: string) => ({ type, bytes: (await sim.frame(dev)) as unknown }) }));
vi.mock("./card-page", () => ({ notePage }));
vi.mock("./simulator-devices", () => devices);

const { nudgeScreen, openScreenChannel, pump, screenInput, screenOnWorker, setFastScreen, setScreenChannel, watchFromBoard } = await import("./worker-screen");
const { paneFromUrl, screenTopic } = await import("./share-types");
const { newAnswerKey, openAnswer } = await import("./rtc-signal");

const d: Device = { id: "udid-1", name: "iPhone 17", platform: "ios", state: "booted" };

beforeEach(() => {
  vi.clearAllMocks();
  setScreenChannel(null);
});

describe("pump", () => {
  it("sends a changed frame, skips a still one, and resends after a while", async () => {
    let clock = 0;
    const frames = ["a", "a", "b", "b"];
    sim.watching.mockImplementation(() => frames.length > 0);
    sim.frame.mockImplementation(() => Promise.resolve(Buffer.from(frames.shift() ?? "")));
    const send = vi.fn(() => Promise.resolve());
    await pump(d, { send, answer: vi.fn(), close: vi.fn(), type: () => "webp" as const }, () => clock, (ms) => ((clock += ms), Promise.resolve()));
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledWith({ type: "webp", bytes: Buffer.from("a") });
    sim.watching.mockReset();

    const again = ["a", "a"];
    clock = 0;
    sim.watching.mockImplementation(() => again.length > 0);
    sim.frame.mockImplementation(() => Promise.resolve(Buffer.from(again.shift() ?? "")));
    const later = vi.fn(() => Promise.resolve());
    await pump(d, { send: later, answer: vi.fn(), close: vi.fn(), type: () => "webp" as const }, () => clock, (ms) => ((clock += 5_000 + ms), Promise.resolve()));
    expect(later).toHaveBeenCalledTimes(2);
  });

  it("carries on past a bad capture", async () => {
    let passes = 2;
    sim.watching.mockImplementation(() => passes-- > 0);
    sim.frame.mockRejectedValueOnce(new Error("mid boot")).mockResolvedValueOnce(Buffer.from("x"));
    const send = vi.fn(() => Promise.resolve());
    await pump(d, { send, answer: vi.fn(), close: vi.fn(), type: () => "webp" as const }, () => 0, () => Promise.resolve());
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("nudgeScreen", () => {
  it("captures now instead of waiting out the tick", async () => {
    let passes = 2;
    sim.watching.mockImplementation(() => passes-- > 0);
    sim.frame.mockResolvedValue(Buffer.from("x"));
    const done = pump(d, { send: () => Promise.resolve(), answer: () => Promise.resolve(), close: vi.fn(), type: () => "webp" as const }, () => 0, () => new Promise(() => {}));
    await vi.waitFor(() => expect(sim.frame).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => {
      nudgeScreen("udid-1");
      expect(sim.frame).toHaveBeenCalledTimes(2);
    });
    nudgeScreen("udid-1");
    await done;
  });

  it("does nothing for a device with no stream", () => {
    expect(nudgeScreen("nobody")).toBeUndefined();
  });
});

describe("screenOnWorker", () => {
  it("says so on a worker without the channel", async () => {
    await expect(screenOnWorker("c", d)).rejects.toThrow("Update it");
  });

  it("puts a screen page on the card and reuses its topic on a second watch", async () => {
    let live = true;
    sim.watching.mockImplementation(() => live);
    sim.frame.mockResolvedValue(Buffer.from("x"));
    const close = vi.fn();
    const open = vi.fn(() => Promise.resolve({ send: () => Promise.resolve(), answer: () => Promise.resolve(), close, type: () => "webp" as const }));
    setScreenChannel(open);
    await screenOnWorker("c", d, () => 1_000);
    await screenOnWorker("c", d, () => 2_000);
    expect(open).toHaveBeenCalledTimes(1);
    expect(sim.markLive).toHaveBeenCalledWith("udid-1");
    const pane = paneFromUrl(notePage.mock.calls[1]?.[1] as string);
    expect(pane).toMatchObject({ kind: "screen", device: "udid-1", label: "iPhone 17", until: 602_000 });
    expect(open).toHaveBeenCalledWith(screenTopic((pane as { token: string }).token));
    live = false;
    await vi.waitFor(() => expect(close).toHaveBeenCalled());
  });
});

describe("openScreenChannel", () => {
  const client = (status: string, err?: Error, state: Record<string, unknown[]> = {}) => {
    const send = vi.fn(() => Promise.resolve());
    const removeChannel = vi.fn(() => Promise.resolve());
    const on = vi.fn();
    const channel = {
      send,
      on: (...args: unknown[]) => (on(...args), channel),
      subscribe: (cb: (s: string, e?: Error) => void) => status && cb(status, err),
      presenceState: () => state,
    };
    return { send, on, removeChannel, state, client: { channel: () => channel, removeChannel } };
  };

  it("sends JPEG to an old board, which says nothing, and to a mix with one, and WebP once every board takes it", async () => {
    box.type = "webp";
    const state: Record<string, unknown[]> = {};
    const c = client("SUBSCRIBED", undefined, state);
    const channel = await openScreenChannel(c.client, "t");
    expect(c.on).toHaveBeenCalledWith("presence", { event: "sync" }, expect.any(Function));
    expect(channel.type()).toBe("jpeg");
    state.old = [{}];
    state.new = [{ formats: ["webp", "jpeg"] }];
    expect(channel.type()).toBe("jpeg");
    delete state.old;
    expect(channel.type()).toBe("webp");
    // A box whose sharp can't write WebP, or told not to, stays on JPEG.
    box.type = "jpeg";
    expect(channel.type()).toBe("jpeg");
    box.type = "webp";
  });

  it("encodes each frame in the agreed format", async () => {
    let passes = 2;
    sim.watching.mockImplementation(() => passes-- > 0);
    sim.frame.mockResolvedValueOnce(Buffer.from("x")).mockResolvedValueOnce(Buffer.from("y"));
    const send = vi.fn(() => Promise.resolve());
    const types: ("webp" | "jpeg")[] = ["jpeg", "webp"];
    await pump(d, { send, answer: vi.fn(), close: vi.fn(), type: () => types.shift()! }, () => 0, () => Promise.resolve());
    expect(send).toHaveBeenCalledWith({ type: "jpeg", bytes: Buffer.from("x") });
    expect(send).toHaveBeenCalledWith({ type: "webp", bytes: Buffer.from("y") });
  });

  it("resolves joined and sends frames on the event", async () => {
    const c = client("SUBSCRIBED");
    const channel = await openScreenChannel(c.client, "t");
    await channel.send({ type: "webp", bytes: Buffer.from("w") });
    expect(c.send).toHaveBeenCalledWith({ type: "broadcast", event: "frame", payload: { webp: Buffer.from("w").toString("base64") } });
    await channel.send({ type: "jpeg", bytes: Buffer.from("j") });
    expect(c.send).toHaveBeenLastCalledWith({ type: "broadcast", event: "frame", payload: { jpg: Buffer.from("j").toString("base64") } });
    channel.close();
    expect(c.removeChannel).toHaveBeenCalled();
  });

  it("rejects a failed join, with and without a reason, and a join that never answers", async () => {
    await expect(openScreenChannel(client("CHANNEL_ERROR", new Error("nope")).client, "t")).rejects.toThrow("nope");
    await expect(openScreenChannel(client("TIMED_OUT").client, "t")).rejects.toThrow("channel.");
    await expect(openScreenChannel(client("").client, "t", 1)).rejects.toThrow("channel.");
  });
});

describe("the fast path", () => {
  const fast = () => ({ size: { width: 1, height: 2 }, connect: vi.fn(() => Promise.resolve("answer-sdp")), close: vi.fn(), type: () => "webp" as const });
  const channel = () => ({ send: vi.fn(() => Promise.resolve()), answer: vi.fn(() => Promise.resolve()), close: vi.fn(), type: () => "webp" as const });

  beforeEach(() => {
    sim.watch.mockResolvedValue("file:///x");
    sim.watching.mockReturnValue(false);
    setScreenChannel(() => Promise.resolve(channel()));
  });

  it("flags the page, and closes with the watch", async () => {
    const f = fast();
    setFastScreen(() => Promise.resolve(f));
    await screenOnWorker("c", { ...d, id: "fast-1" });
    expect(sim.noteWatchedSize).toHaveBeenCalledWith("fast-1", f.size);
    expect(paneFromUrl(notePage.mock.calls.at(-1)?.[1] as string)).toMatchObject({ fast: true });
    await vi.waitFor(() => expect(f.close).toHaveBeenCalled());
    setFastScreen(null);
  });

  it("carries on with JPEGs when the fast path fails", async () => {
    setFastScreen(() => Promise.reject(new Error("no idb")));
    await screenOnWorker("c", { ...d, id: "fast-2" });
    expect(paneFromUrl(notePage.mock.calls.at(-1)?.[1] as string)).toMatchObject({ fast: false });
    setFastScreen(null);
  });

  it("answers a sealed offer under the board's key, on the watch's channel", async () => {
    const f = fast();
    const ch = channel();
    let release: (v: unknown) => void = () => {};
    sim.watching.mockReturnValue(true);
    sim.frame.mockImplementation(() => new Promise((go) => (release = go)));
    setScreenChannel(() => Promise.resolve(ch));
    const key = newAnswerKey();
    setFastScreen(() => Promise.resolve(f), () => JSON.stringify({ sdp: "offer-sdp", key }));
    await screenOnWorker("c", { ...d, id: "fast-3" });
    await screenInput({ kind: "offer", device: "fast-3", sealed: {} as never }, vi.fn());
    expect(f.connect).toHaveBeenCalledWith("offer-sdp", "medium");
    await expect(openAnswer(key, ch.answer.mock.calls[0]?.[0 as never] as never)).resolves.toBe("answer-sdp");
    sim.watching.mockReturnValue(false);
    release(Buffer.from("x"));
    await vi.waitFor(() => expect(f.close).toHaveBeenCalled());
    setFastScreen(null);
  });

  it("ignores an offer for a device with no fast path, and passes a touch through", async () => {
    const touch = vi.fn(() => Promise.resolve());
    await screenInput({ kind: "offer", device: "nobody", sealed: {} as never }, touch);
    expect(touch).not.toHaveBeenCalled();
    const tap = { kind: "tap", device: "d", x: 0, y: 0 } as const;
    await screenInput(tap, touch);
    expect(touch).toHaveBeenCalledWith(tap);
  });
});

describe("watching from the pane", () => {
  const other: Device = { id: "udid-2", name: "iPad", platform: "ios", state: "shutdown" };
  const android: Device = { id: "avd:Pixel", name: "Pixel", platform: "android", state: "shutdown" };

  beforeEach(() => {
    sim.watch.mockResolvedValue("file:///x");
    sim.watching.mockReturnValue(false);
    setScreenChannel(() => Promise.resolve({ send: vi.fn(() => Promise.resolve()), answer: vi.fn(() => Promise.resolve()), close: vi.fn(), type: () => "webp" as const }));
  });

  it("streams the booted device, and lists the worker's devices on the page", async () => {
    devices.listDevices.mockResolvedValue([other, d]);
    await screenInput({ kind: "watch" }, vi.fn(), "card-1");
    expect(sim.watch).toHaveBeenCalledWith(d, expect.any(Function));
    expect(paneFromUrl(notePage.mock.calls.at(-1)?.[1] as string)).toMatchObject({ device: "udid-1", devices: [{ id: "udid-2", name: "iPad" }, { id: "udid-1", name: "iPhone 17" }] });
  });

  it("boots the one it names, and stops the card's device before", async () => {
    devices.listDevices.mockResolvedValue([d, other]);
    devices.pickDevice.mockReturnValue(d);
    devices.boot.mockResolvedValue({ ...other, state: "booted" });
    await watchFromBoard("card-2", "udid-1", () => Promise.resolve([d]));
    devices.pickDevice.mockReturnValue(other);
    await screenInput({ kind: "watch", device: "udid-2" }, vi.fn(), "card-2");
    expect(devices.boot).toHaveBeenCalledWith("udid-2");
    expect(sim.stopWatching).toHaveBeenCalledWith("udid-1");
  });

  it("with nothing booted, takes the first simulator, else any device, else says there are none", async () => {
    devices.boot.mockImplementation((id: string) => Promise.resolve({ ...[other, android].find((x) => x.id === id), state: "booted" }));
    await watchFromBoard("card-3", undefined, () => Promise.resolve([android, other]));
    expect(devices.boot).toHaveBeenLastCalledWith("udid-2");
    await watchFromBoard("card-4", undefined, () => Promise.resolve([android]));
    expect(devices.boot).toHaveBeenLastCalledWith("avd:Pixel");
    await expect(watchFromBoard("card-5", undefined, () => Promise.resolve([]))).rejects.toThrow("no simulators");
  });
});
