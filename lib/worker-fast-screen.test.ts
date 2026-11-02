import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Device } from "./simulator-devices";

const idb = vi.hoisted(() => ({ openIdb: vi.fn() }));
const rtc = vi.hoisted(() => ({ answerOffer: vi.fn() }));
const rtp = vi.hoisted(() => ({ takeVideo: vi.fn(), rtpVideo: vi.fn() }));
vi.mock("./idb-companion", () => idb);
vi.mock("./worker-rtc", () => rtc);
vi.mock("./rtp-video", () => rtp);

const { isKeyFrame, openFastScreen } = await import("./worker-fast-screen");

const ios: Device = { id: "u", name: "iPhone", platform: "ios", state: "booted" };
const session = () => ({ size: { width: 1, height: 2 }, video: vi.fn(), touch: vi.fn(), key: vi.fn(), close: vi.fn() });

beforeEach(() => vi.clearAllMocks());

describe("isKeyFrame", () => {
  it("finds an IDR slice after any start code", () => {
    expect(isKeyFrame(Buffer.from([0, 0, 0, 1, 0x67, 0, 0, 1, 0x65]))).toBe(true);
    expect(isKeyFrame(Buffer.from([0, 0, 1, 0x41, 3]))).toBe(false);
  });
});

describe("openFastScreen", () => {
  it("leaves Android on the JPEG path", async () => {
    await expect(openFastScreen({ ...ios, platform: "android" })).resolves.toBeNull();
    expect(idb.openIdb).not.toHaveBeenCalled();
  });

  it("leaves a box with no companion on the JPEG path", async () => {
    idb.openIdb.mockResolvedValue(null);
    await expect(openFastScreen(ios)).resolves.toBeNull();
  });

  it("answers an offer with the video and input channels, and a new offer replaces the line", async () => {
    const s = session();
    idb.openIdb.mockResolvedValue(s);
    const first = { answer: "a1", close: vi.fn() };
    rtc.answerOffer.mockResolvedValueOnce(first).mockResolvedValueOnce({ answer: "a2", close: vi.fn() });
    const fast = await openFastScreen(ios);
    await expect(fast?.connect("o1")).resolves.toBe("a1");
    expect(Object.keys(rtc.answerOffer.mock.calls[0]?.[1] as object)).toEqual(["video", "input"]);
    await expect(fast?.connect("o2")).resolves.toBe("a2");
    expect(first.close).toHaveBeenCalled();
  });

  it("closes the line and the session together", async () => {
    const s = session();
    idb.openIdb.mockResolvedValue(s);
    const line = { answer: "a", close: vi.fn() };
    rtc.answerOffer.mockResolvedValue(line);
    const fast = await openFastScreen(ios);
    await fast?.connect("o");
    fast?.close();
    expect(line.close).toHaveBeenCalled();
    expect(s.close).toHaveBeenCalled();
  });
});

describe("the video track", () => {
  type Opts = { media: (t: unknown[]) => void };
  type Handlers = Record<string, (c: unknown) => void>;
  const channel = () => {
    const subs: ((state: string) => void)[] = [];
    return { stateChanged: { subscribe: (fn: (state: string) => void) => subs.push(fn) }, emit: (state: string) => subs.forEach((fn) => fn(state)) };
  };
  const connect = async (sender: unknown) => {
    const s = session();
    idb.openIdb.mockResolvedValue(s);
    const line = { answer: "a", close: vi.fn() };
    let handlers: Handlers = {};
    rtc.answerOffer.mockImplementation((_: string, h: Handlers, opts: Opts) => {
      handlers = h;
      opts.media([{ kind: "video" }]);
      return Promise.resolve(line);
    });
    rtp.takeVideo.mockReturnValue(sender);
    const stop = vi.fn();
    rtp.rtpVideo.mockReturnValue(stop);
    const fast = await openFastScreen(ios);
    await fast?.connect("o", "high");
    return { s, line, handlers, stop, fast };
  };

  it("sends on the track the board offered, and hears it leave on the unused channel", async () => {
    const sender = { ssrc: 1 };
    const { s, handlers, stop, line, fast } = await connect(sender);
    expect(rtp.takeVideo).toHaveBeenCalledWith([{ kind: "video" }]);
    expect(rtp.rtpVideo).toHaveBeenCalledWith(s, sender, "high");
    const c = channel();
    handlers.video?.(c);
    expect(s.video).not.toHaveBeenCalled();
    c.emit("open");
    expect(stop).not.toHaveBeenCalled();
    c.emit("closed");
    expect(stop).toHaveBeenCalledTimes(1);
    fast?.close();
    expect(stop).toHaveBeenCalledTimes(2);
    expect(line.close).toHaveBeenCalled();
  });

  it("falls back to the channel when the board offered no track", async () => {
    const { s, handlers, stop, fast } = await connect(null);
    expect(rtp.rtpVideo).not.toHaveBeenCalled();
    handlers.video?.(channel());
    expect(s.video).toHaveBeenCalled();
    fast?.close();
    expect(stop).not.toHaveBeenCalled();
  });
});

describe("on a session line", () => {
  it("sends on the line's new m-line at its quality, or says it can't, and takes the line's input channel", async () => {
    const s = session();
    idb.openIdb.mockResolvedValue(s);
    const fast = await openFastScreen(ios);
    const stop = vi.fn();
    rtp.takeVideo.mockReturnValueOnce({ ssrc: 2 });
    rtp.rtpVideo.mockReturnValueOnce(stop);
    expect(fast?.attach?.([{ kind: "video" }] as never, "low")).toBe(stop);
    expect(rtp.rtpVideo).toHaveBeenCalledWith(s, { ssrc: 2 }, "low");
    rtp.takeVideo.mockReturnValueOnce(null);
    expect(fast?.attach?.([] as never)).toBeNull();
    let heard: (raw: string) => void = () => {};
    fast?.input?.({ onMessage: { subscribe: (fn: (raw: string) => void) => (heard = fn) } } as never);
    heard(JSON.stringify({ t: "down", x: 0.5, y: 0.5 }));
    expect(s.touch).toHaveBeenCalledWith("down", 0.5, 1);
  });
});
