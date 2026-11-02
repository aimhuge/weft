// @vitest-environment jsdom
// A worker's browser on the session line (lib/use-line-frames.ts): an input channel added over the line, JPEG frames
// drawn off it, and pointer and keys sent up it.
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { LineRoute } from "./session-line";

vi.mock("./line-answer", () => ({ lineToken: () => "0123456789abcdef" }));
type Renegotiate = (add: (pc: unknown) => void, screen?: unknown) => Promise<void>;
const state = vi.hoisted(() => ({ route: null as LineRoute | null, line: null as null | { renegotiate: Mock<Renegotiate> } }));
vi.mock("./session-lines", () => ({ lineFor: () => state.line, useLineRoute: () => state.route }));

const { jpegPainter, useLineFrames } = await import("./use-line-frames");

class Channel {
  readyState = "connecting";
  binaryType = "blob";
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  close = vi.fn();
  send(text: string) {
    this.sent.push(text);
  }
}

const framed = (text: string) => {
  const body = new TextEncoder().encode(text);
  const all = new Uint8Array(4 + body.length);
  new DataView(all.buffer).setUint32(0, body.length);
  all.set(body, 4);
  return all.buffer;
};

let drawn: unknown[];
let decode: Mock;
let canvas: { current: HTMLCanvasElement | null };
const DEVICE = "browser-0123456789abcdef";

beforeEach(() => {
  drawn = [];
  decode = vi.fn((blob: Blob) => Promise.resolve({ width: 100, height: 50, close: vi.fn(), blob }));
  vi.stubGlobal("createImageBitmap", decode);
  const el = document.createElement("canvas");
  Object.defineProperty(el, "getContext", { value: () => ({ drawImage: (img: unknown) => drawn.push(img) }) });
  canvas = { current: el };
  state.route = { kind: "direct", ms: 3 };
  state.line = { renegotiate: vi.fn<Renegotiate>(() => Promise.resolve()) };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("jpegPainter", () => {
  it("sizes the canvas to the frame, draws it, and drops a frame that decoded after a newer one", async () => {
    const onDrawn = vi.fn();
    let release: (v: unknown) => void = () => {};
    decode.mockImplementationOnce(() => new Promise((done) => (release = done)));
    const paint = jpegPainter(canvas, onDrawn);
    paint(new Uint8Array([1]));
    paint(new Uint8Array([2]));
    await vi.waitFor(() => expect(drawn).toHaveLength(1));
    expect([canvas.current?.width, canvas.current?.height]).toEqual([100, 50]);
    // The same size again: the canvas isn't touched.
    paint(new Uint8Array([3]));
    await vi.waitFor(() => expect(drawn).toHaveLength(2));
    const late = { width: 100, height: 50, close: vi.fn() };
    release(late);
    await new Promise((done) => setTimeout(done, 0));
    expect(drawn).toHaveLength(2);
    expect(late.close).toHaveBeenCalled();
    expect(onDrawn).toHaveBeenCalledTimes(2);
  });

  it("draws nothing without a canvas, or when a frame won't decode", async () => {
    const onDrawn = vi.fn();
    jpegPainter({ current: null }, onDrawn)(new Uint8Array([1]));
    decode.mockRejectedValueOnce(new Error("bad jpeg"));
    jpegPainter(canvas, onDrawn)(new Uint8Array([1]));
    await new Promise((done) => setTimeout(done, 0));
    expect(onDrawn).not.toHaveBeenCalled();
  });
});

describe("useLineFrames", () => {
  it("adds its input channel over the line, draws the frames that come down it, sends input up it, and closes it to leave", async () => {
    const channel = new Channel();
    const pc = { createDataChannel: vi.fn(() => channel) };
    state.line!.renegotiate.mockImplementation((add) => (add(pc), Promise.resolve()));
    const { result, unmount } = renderHook(() => useLineFrames("w1", DEVICE, true, canvas));
    expect(state.line!.renegotiate).toHaveBeenCalledWith(expect.any(Function), { device: DEVICE, channel: `input:${DEVICE}:01234567` });
    expect(channel.binaryType).toBe("arraybuffer");
    expect(result.current).toMatchObject({ on: true, live: false });
    expect(result.current.send({ t: "down", x: 0, y: 0 })).toBe(false);
    act(() => {
      channel.readyState = "open";
      channel.onopen?.();
      channel.onmessage?.({ data: "text is ignored" });
      channel.onmessage?.({ data: framed("jpeg") });
    });
    await vi.waitFor(() => expect(result.current.live).toBe(true));
    expect(result.current.send({ t: "up", x: 0.5, y: 0.5 })).toBe(true);
    expect(channel.sent).toEqual([JSON.stringify({ t: "up", x: 0.5, y: 0.5 })]);
    unmount();
    expect(channel.close).toHaveBeenCalled();
  });

  it("shrugs off a refused renegotiation, and stays off without a direct line, a worker or a line", async () => {
    state.line!.renegotiate.mockRejectedValueOnce(new Error("refused"));
    const { result } = renderHook(() => useLineFrames("w1", DEVICE, true, canvas));
    await new Promise((done) => setTimeout(done, 0));
    expect(result.current.on).toBe(true);
    const cases: [string | undefined, boolean, LineRoute | null][] = [
      ["w1", false, { kind: "direct", ms: 1 }],
      ["w1", true, { kind: "relay" }],
      [undefined, true, { kind: "direct", ms: 1 }],
    ];
    for (const [worker, enabled, route] of cases) {
      state.route = route;
      expect(renderHook(() => useLineFrames(worker, DEVICE, enabled, canvas)).result.current).toMatchObject({ on: false, live: false });
    }
    state.route = { kind: "direct", ms: 1 };
    state.line = null;
    expect(renderHook(() => useLineFrames("w1", DEVICE, true, canvas)).result.current.on).toBe(true);
  });
});
