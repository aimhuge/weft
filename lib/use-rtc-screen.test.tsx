// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newAnswerKey, sealAnswer } from "./rtc-signal";
import { useRtcScreen } from "./use-rtc-screen";
import type { BoardInput } from "./worker-commands";

const KEY = [0, 0, 0, 1, 0x67, 0x64, 0, 0x33, 0, 0, 1, 0x65, 1];
const framed = (bytes: number[]) => Uint8Array.from([0, 0, 0, bytes.length, ...bytes]).buffer;

class FakeChannel {
  binaryType = "";
  readyState = "connecting";
  onmessage: ((e: { data: ArrayBuffer }) => void) | null = null;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  send = vi.fn();
  constructor(readonly label: string) {}
}

class FakePeer {
  static made: FakePeer[] = [];
  iceGatheringState = "complete";
  connectionState = "new";
  channels: FakeChannel[] = [];
  localDescription = { sdp: "offer-sdp" };
  listeners: Record<string, () => void> = {};
  close = vi.fn();
  setLocalDescription = vi.fn(() => Promise.resolve());
  setRemoteDescription = vi.fn(() => Promise.resolve());
  createOffer = () => Promise.resolve({});
  addTransceiver = vi.fn(() => ({ setCodecPreferences: vi.fn(), receiver: {} }));
  addEventListener = (name: string, fn: () => void) => (this.listeners[name] = fn);
  createDataChannel = (label: string) => {
    const c = new FakeChannel(label);
    this.channels.push(c);
    return c;
  };
  constructor() {
    FakePeer.made.push(this);
  }
}

class FakeDecoder {
  static made: FakeDecoder[] = [];
  state = "unconfigured";
  configure = vi.fn(() => (this.state = "configured"));
  decode = vi.fn();
  close = vi.fn(() => (this.state = "closed"));
  constructor(readonly init: { output(f: unknown): void; error(): void }) {
    FakeDecoder.made.push(this);
  }
}

const canvas: { current: HTMLCanvasElement | null } = { current: null };
const offered = () => {
  return vi.fn<(input: BoardInput) => Promise<unknown>>(() => Promise.resolve());
};

beforeEach(() => {
  FakePeer.made = [];
  FakeDecoder.made = [];
  canvas.current = null;
  vi.stubGlobal("RTCPeerConnection", FakePeer);
  vi.stubGlobal("VideoDecoder", FakeDecoder);
  vi.stubGlobal("EncodedVideoChunk", class { constructor(readonly init: unknown) {} });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useRtcScreen", () => {
  it("stays on the JPEGs for a watch with no fast path, a board that can't offer, or no WebRTC", () => {
    renderHook(() => useRtcScreen("d", false, canvas, offered()));
    renderHook(() => useRtcScreen("d", true, canvas));
    vi.stubGlobal("RTCPeerConnection", undefined);
    renderHook(() => useRtcScreen("d", true, canvas, offered()));
    expect(FakePeer.made).toHaveLength(0);
  });

  it("sends an offer with a one-time key, opening video and input by name", async () => {
    const onOffer = offered();
    renderHook(() => useRtcScreen("d", true, canvas, onOffer));
    await waitFor(() => expect(onOffer).toHaveBeenCalled());
    expect(FakePeer.made[0]?.channels.map((c) => c.label)).toEqual(["video", "input"]);
    expect(onOffer.mock.calls[0]?.[0]).toMatchObject({ kind: "offer", device: "d", sdp: "offer-sdp" });
  });

  it("accepts an answer under its key, and drops a forged one", async () => {
    const onOffer = offered();
    const { result } = renderHook(() => useRtcScreen("d", true, canvas, onOffer));
    await waitFor(() => expect(onOffer).toHaveBeenCalled());
    const { key } = onOffer.mock.calls[0]?.[0] as { key: string };
    result.current.answer(await sealAnswer(newAnswerKey(), "forged"));
    result.current.answer(await sealAnswer(key, "answer-sdp"));
    await waitFor(() => expect(FakePeer.made[0]?.setRemoteDescription).toHaveBeenCalledTimes(1));
    expect(FakePeer.made[0]?.setRemoteDescription).toHaveBeenCalledWith({ type: "answer", sdp: "answer-sdp" });
  });

  it("ignores an answer with no offer out", () => {
    const { result } = renderHook(() => useRtcScreen("d", false, canvas));
    expect(() => result.current.answer({ iv: "", ct: "" })).not.toThrow();
  });

  it("goes live on the first frame, and draws at the frame's size", async () => {
    const onOffer = offered();
    const { result } = renderHook(() => useRtcScreen("d", true, canvas, onOffer));
    await waitFor(() => expect(onOffer).toHaveBeenCalled());
    act(() => FakePeer.made[0]?.channels[0]?.onmessage?.({ data: framed(KEY) }));
    expect(result.current.live).toBe(true);
    expect(FakeDecoder.made[0]?.configure).toHaveBeenCalledWith({ codec: "avc1.640033", optimizeForLatency: true });
    const drawImage = vi.fn();
    canvas.current = { width: 0, height: 0, getContext: () => ({ drawImage }) } as unknown as HTMLCanvasElement;
    const frame = { displayWidth: 603, displayHeight: 1311, close: vi.fn() };
    FakeDecoder.made[0]?.init.output(frame);
    expect(canvas.current.width).toBe(603);
    expect(drawImage).toHaveBeenCalled();
    expect(frame.close).toHaveBeenCalled();
  });

  it("doesn't decode before a key frame", async () => {
    const onOffer = offered();
    renderHook(() => useRtcScreen("d", true, canvas, onOffer));
    await waitFor(() => expect(onOffer).toHaveBeenCalled());
    act(() => FakePeer.made[0]?.channels[0]?.onmessage?.({ data: framed([0, 0, 1, 0x41, 1]) }));
    expect(FakeDecoder.made[0]?.decode).not.toHaveBeenCalled();
  });

  it("sends live events only while the input channel is open, so the caller can fall back", async () => {
    const onOffer = offered();
    const { result } = renderHook(() => useRtcScreen("d", true, canvas, onOffer));
    await waitFor(() => expect(onOffer).toHaveBeenCalled());
    const event = { t: "down", x: 0, y: 0 } as const;
    expect(result.current.send(event)).toBe(false);
    const input = FakePeer.made[0]?.channels[1] as FakeChannel;
    input.readyState = "open";
    input.onopen?.();
    expect(result.current.send(event)).toBe(true);
    expect(input.send).toHaveBeenCalledWith(JSON.stringify(event));
  });

  it("drops to the JPEGs when the connection fails, and closes everything on unmount", async () => {
    const onOffer = offered();
    const { result, unmount } = renderHook(() => useRtcScreen("d", true, canvas, onOffer));
    await waitFor(() => expect(onOffer).toHaveBeenCalled());
    const peer = FakePeer.made[0] as FakePeer;
    act(() => peer.channels[0]?.onmessage?.({ data: framed(KEY) }));
    peer.connectionState = "failed";
    act(() => peer.listeners.connectionstatechange?.());
    expect(result.current.live).toBe(false);
    expect(peer.close).toHaveBeenCalled();
    unmount();
    expect(FakeDecoder.made[0]?.close).toHaveBeenCalled();
  });

  it("waits for gathering to finish before it offers", async () => {
    const onOffer = offered();
    class Gathering extends FakePeer {
      iceGatheringState = "gathering";
    }
    vi.stubGlobal("RTCPeerConnection", Gathering);
    renderHook(() => useRtcScreen("d", true, canvas, onOffer));
    await waitFor(() => expect(FakePeer.made[0]?.listeners.icegatheringstatechange).toBeDefined());
    const peer = FakePeer.made[0] as FakePeer;
    peer.listeners.icegatheringstatechange?.();
    expect(onOffer).not.toHaveBeenCalled();
    peer.iceGatheringState = "complete";
    peer.listeners.icegatheringstatechange?.();
    await waitFor(() => expect(onOffer).toHaveBeenCalled());
  });

  describe("on a video track", () => {
    const h264 = { mimeType: "video/H264", sdpFmtpLine: "packetization-mode=1;profile-level-id=64001f" };
    let frame: (() => void) | null = null;
    const video = () => ({ current: { play: () => Promise.resolve(), srcObject: null, requestVideoFrameCallback: (fn: () => void) => (frame = fn) } as unknown as HTMLVideoElement });

    beforeEach(() => {
      frame = null;
      vi.stubGlobal("RTCRtpReceiver", { getCapabilities: () => ({ codecs: [h264] }) });
      vi.stubGlobal("MediaStream", class { constructor(readonly tracks: unknown[]) {} });
    });

    it("offers a receive-only H.264 m-line and goes live on the track's first frame", async () => {
      const onOffer = offered();
      const el = video();
      const { result } = renderHook(() => useRtcScreen("d", true, canvas, onOffer, "medium", el));
      await waitFor(() => expect(onOffer).toHaveBeenCalled());
      const peer = FakePeer.made[0] as FakePeer;
      expect(peer.addTransceiver).toHaveBeenCalledWith("video", { direction: "recvonly" });
      act(() => (peer.listeners.track as unknown as (e: { track: unknown }) => void)({ track: { id: "t" } }));
      expect(result.current.live).toBe(false);
      act(() => frame?.());
      expect(result.current).toMatchObject({ live: true, track: true });
      peer.connectionState = "failed";
      act(() => peer.listeners.connectionstatechange?.());
      expect(result.current).toMatchObject({ live: false, track: false });
      expect(el.current.srcObject).toBeNull();
    });

    it("stays on the channel without a <video> to play in", async () => {
      const onOffer = offered();
      renderHook(() => useRtcScreen("d", true, canvas, onOffer, "medium", { current: null }));
      await waitFor(() => expect(onOffer).toHaveBeenCalled());
      expect(FakePeer.made[0]?.addTransceiver).not.toHaveBeenCalled();
    });

    it("leaves the track out of the next offer when it negotiated but never showed a frame", async () => {
      vi.useFakeTimers();
      try {
        const onOffer = offered();
        renderHook(() => useRtcScreen("d", true, canvas, onOffer, "medium", video()));
        await act(() => vi.advanceTimersByTimeAsync(0));
        expect(onOffer).toHaveBeenCalledTimes(1);
        const first = FakePeer.made[0] as FakePeer;
        act(() => (first.listeners.track as unknown as (e: { track: unknown }) => void)({ track: {} }));
        await act(() => vi.advanceTimersByTimeAsync(15_000 + 30_000));
        expect(onOffer).toHaveBeenCalledTimes(2);
        expect(FakePeer.made[1]?.addTransceiver).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it("keeps offering the track after a try that never reached it", async () => {
      vi.useFakeTimers();
      try {
        const onOffer = offered();
        renderHook(() => useRtcScreen("d", true, canvas, onOffer, "medium", video()));
        await act(() => vi.advanceTimersByTimeAsync(15_000 + 30_000));
        expect(onOffer).toHaveBeenCalledTimes(2);
        expect(FakePeer.made[1]?.addTransceiver).toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
