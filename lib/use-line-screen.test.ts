// @vitest-environment jsdom
// A watched simulator as a track on the session line (lib/use-line-screen.ts): renegotiated over the line while it's
// direct, its own input channel, and handing back to the screen's own line when it can't.
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { LineRoute } from "./session-line";

const track = vi.hoisted(() => ({ offerVideoTrack: vi.fn(() => true), playTrack: vi.fn((_: unknown, __: unknown, onFrame: () => void) => onFrame()) }));
vi.mock("./rtc-video-track", () => track);
vi.mock("./line-answer", () => ({ lineToken: () => "0123456789abcdef" }));
type Renegotiate = (add: (pc: unknown) => void, screen?: unknown) => Promise<void>;
const state = vi.hoisted(() => ({ route: null as LineRoute | null, line: null as null | { renegotiate: Mock<Renegotiate> } }));
vi.mock("./session-lines", () => ({ lineFor: () => state.line, useLineRoute: () => state.route }));

const own = vi.hoisted(() => ({ fast: [] as boolean[] }));
vi.mock("./use-rtc-screen", () => ({ useRtcScreen: (_: string, fast: boolean) => (own.fast.push(fast), { live: false, track: false, send: () => true, answer: vi.fn() }) }));

// A worker's browser takes the frames path (lib/use-line-frames.ts); off unless a test says so.
type FramesView = { on: boolean; live: boolean; send: (event: unknown) => boolean };
const lineFrames = vi.hoisted(() => vi.fn<(...args: unknown[]) => FramesView>(() => ({ on: false, live: false, send: () => false })));
vi.mock("./use-line-frames", () => ({ useLineFrames: lineFrames }));

const { useLineScreen, useScreenVideo } = await import("./use-line-screen");

class Channel {
  readyState = "connecting";
  sent: string[] = [];
  onopen: (() => void) | null = null;
  close = vi.fn();
  send(text: string) {
    this.sent.push(text);
  }
}

function pc() {
  const listeners: Record<string, (e: unknown) => void> = {};
  const channel = new Channel();
  return { channel, listeners, createDataChannel: vi.fn(() => channel), addEventListener: (type: string, fn: (e: unknown) => void) => (listeners[type] = fn) };
}

let video: { current: HTMLVideoElement | null };

beforeEach(() => {
  vi.clearAllMocks();
  own.fast = [];
  track.offerVideoTrack.mockReturnValue(true);
  video = { current: document.createElement("video") };
  state.route = { kind: "direct", ms: 4 };
  state.line = { renegotiate: vi.fn<Renegotiate>(() => Promise.resolve()) };
});
afterEach(cleanup);

describe("useLineScreen", () => {
  it("adds the track and its input channel over the line, plays it, sends gestures on it, and closes it to leave", () => {
    const p = pc();
    state.line!.renegotiate.mockImplementation((add) => {
      add(p);
      return Promise.resolve();
    });
    const { result, unmount } = renderHook(() => useLineScreen("w1", "sim", true, "low", video));
    expect(result.current.on).toBe(true);
    expect(state.line!.renegotiate).toHaveBeenCalledWith(expect.any(Function), { device: "sim", quality: "low", channel: "input:sim:01234567" });
    expect(p.createDataChannel).toHaveBeenCalledWith("input:sim:01234567", { ordered: true });
    expect(result.current.send({ t: "down", x: 0, y: 0 })).toBe(false);
    act(() => {
      p.channel.readyState = "open";
      p.channel.onopen?.();
      p.listeners.track?.({ track: "t" });
    });
    expect(track.playTrack).toHaveBeenCalledWith(video.current, "t", expect.any(Function));
    expect(result.current.live).toBe(true);
    expect(result.current.send({ t: "down", x: 0.5, y: 0.5 })).toBe(true);
    expect(p.channel.sent).toEqual([JSON.stringify({ t: "down", x: 0.5, y: 0.5 })]);
    unmount();
    expect(p.channel.close).toHaveBeenCalled();
  });

  it("hands back to the screen's own line when this board can't take the track, or the worker refuses", async () => {
    track.offerVideoTrack.mockReturnValue(false);
    state.line!.renegotiate.mockImplementation((add) => {
      try {
        add(pc());
        return Promise.resolve();
      } catch {
        return Promise.reject(new Error("This board can't play H.264 over RTP."));
      }
    });
    const { result } = renderHook(() => useLineScreen("w1", "sim", true, "medium", video));
    await vi.waitFor(() => expect(result.current.on).toBe(false));
  });

  it("ignores a failure that lands after it was left, and a frame that arrives after", async () => {
    let fail: (err: Error) => void = () => {};
    const p = pc();
    state.line!.renegotiate.mockImplementation((add) => {
      add(p);
      return new Promise<void>((_, no) => {
        fail = (err: Error) => no(err);
      });
    });
    track.playTrack.mockImplementationOnce(((_: unknown, __: unknown, onFrame: () => void) => setTimeout(onFrame, 0)));
    const { result, unmount } = renderHook(() => useLineScreen("w1", "sim", true, "medium", video));
    p.listeners.track?.({ track: "t" });
    unmount();
    fail(new Error("late"));
    await new Promise((done) => setTimeout(done, 5));
    expect(result.current.on).toBe(true);
  });

  it("stays off while the line isn't direct, the screen isn't fast, or there's no worker, line or video", () => {
    const cases: [string | undefined, boolean, LineRoute | null][] = [
      ["w1", false, { kind: "direct", ms: 1 }],
      ["w1", true, { kind: "relay" }],
      ["w1", true, null],
      [undefined, true, { kind: "direct", ms: 1 }],
    ];
    for (const [worker, fast, route] of cases) {
      state.route = route;
      const { result } = renderHook(() => useLineScreen(worker, "sim", fast, "medium", video));
      expect(result.current).toMatchObject({ on: false, live: false });
    }
    state.route = { kind: "direct", ms: 1 };
    state.line = null;
    renderHook(() => useLineScreen("w1", "sim", true, "medium", video));
    state.line = { renegotiate: vi.fn<Renegotiate>() };
    renderHook(() => useLineScreen("w1", "sim", true, "medium", { current: null }));
    expect(state.line.renegotiate).not.toHaveBeenCalled();
  });
});

describe("useScreenVideo", () => {
  it("takes the line's track while it carries the screen, keeping the screen's own line shut, and its own line otherwise", () => {
    const p = pc();
    state.line!.renegotiate.mockImplementation((add) => {
      add(p);
      return Promise.resolve();
    });
    const canvas = { current: null };
    const { result } = renderHook(() => useScreenVideo("w1", "sim", true, canvas, vi.fn(), "medium", video));
    expect(own.fast).toEqual([false]);
    act(() => {
      p.channel.readyState = "open";
      p.channel.onopen?.();
      p.listeners.track?.({ track: "t" });
    });
    expect(result.current).toMatchObject({ live: true, track: true });
    expect(result.current.send({ t: "up", x: 0, y: 0 })).toBe(true);
    own.fast = [];
    state.route = { kind: "relay" };
    const relayed = renderHook(() => useScreenVideo("w1", "sim", true, canvas, vi.fn(), "medium", video));
    expect(own.fast).toEqual([true]);
    expect(relayed.result.current).toMatchObject({ live: false, track: false });
    expect(relayed.result.current.send({ t: "up", x: 0, y: 0 })).toBe(true);
  });

  it("draws a worker's browser from its frames on the line, never its own line or a track, and sends input there", () => {
    const frames = { on: true, live: true, send: vi.fn(() => true) };
    lineFrames.mockReturnValue(frames);
    const canvas = { current: null };
    const { result } = renderHook(() => useScreenVideo("w1", "browser-0123456789abcdef", true, canvas, vi.fn(), "medium", video));
    expect(own.fast).toEqual([false]);
    expect(state.line!.renegotiate).not.toHaveBeenCalled();
    expect(lineFrames).toHaveBeenCalledWith("w1", "browser-0123456789abcdef", true, canvas);
    expect(result.current).toMatchObject({ live: true, track: false });
    expect(result.current.send({ t: "up", x: 0, y: 0 })).toBe(true);
    expect(frames.send).toHaveBeenCalled();
  });
});
