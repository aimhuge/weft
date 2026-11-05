// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { h264First, offerVideoTrack, playTrack } from "./rtc-video-track";

const h264 = (profile: string, mode = 1) => ({ mimeType: "video/H264", sdpFmtpLine: `level-asymmetry-allowed=1;packetization-mode=${mode};profile-level-id=${profile}` });

afterEach(() => vi.unstubAllGlobals());

describe("h264First", () => {
  it("keeps H.264 in packetization-mode 1, High first, then Constrained Baseline", () => {
    const codecs: { mimeType: string; sdpFmtpLine?: string }[] = [h264("42001f"), { mimeType: "video/VP8" }, h264("42e01f"), h264("640c1f", 0), h264("64001f"), { mimeType: "video/h264" }, { mimeType: "video/h264", sdpFmtpLine: "packetization-mode=1" }];
    expect(h264First(codecs).map((c) => c.sdpFmtpLine?.slice(-6))).toEqual(["64001f", "42e01f", "42001f", "mode=1"]);
  });
});

describe("offerVideoTrack", () => {
  const peer = () => {
    const receiver: { jitterBufferTarget?: number | null } = { jitterBufferTarget: null };
    const t = { setCodecPreferences: vi.fn(), receiver };
    const addTransceiver = vi.fn(() => t);
    return { pc: { addTransceiver } as unknown as RTCPeerConnection, t, receiver, addTransceiver };
  };

  it("offers nothing where the browser can't receive H.264 over RTP", () => {
    expect(offerVideoTrack({} as RTCPeerConnection)).toBe(false);
    const { pc } = peer();
    expect(offerVideoTrack(pc)).toBe(false);
    vi.stubGlobal("RTCRtpReceiver", { getCapabilities: () => ({ codecs: [{ mimeType: "video/VP8" }] }) });
    expect(offerVideoTrack(pc)).toBe(false);
    vi.stubGlobal("RTCRtpReceiver", { getCapabilities: () => null });
    expect(offerVideoTrack(pc)).toBe(false);
  });

  it("adds a receive-only m-line that prefers High, with no jitter buffer to speak of", () => {
    vi.stubGlobal("RTCRtpReceiver", { getCapabilities: () => ({ codecs: [h264("42e01f"), h264("64001f")] }) });
    const { pc, t, receiver, addTransceiver } = peer();
    expect(offerVideoTrack(pc)).toBe(true);
    expect(addTransceiver).toHaveBeenCalledWith("video", { direction: "recvonly" });
    expect(t.setCodecPreferences).toHaveBeenCalledWith([h264("64001f"), h264("42e01f")]);
    expect(receiver.jitterBufferTarget).toBe(0);
    const old = peer();
    delete old.receiver.jitterBufferTarget;
    expect(offerVideoTrack(old.pc)).toBe(true);
    expect("jitterBufferTarget" in old.receiver).toBe(false);
  });
});

describe("playTrack", () => {
  const video = (more: object = {}) => {
    const addEventListener = vi.fn();
    return { el: Object.assign({ play: vi.fn(() => Promise.reject(new Error("no autoplay"))), addEventListener }, more) as unknown as HTMLVideoElement, addEventListener };
  };

  it("plays the track muted and inline, and calls back on its first frame", () => {
    vi.stubGlobal("MediaStream", class { constructor(readonly tracks: unknown[]) {} });
    let frame = () => {};
    const { el } = video({ requestVideoFrameCallback: (fn: () => void) => (frame = fn) });
    const onFrame = vi.fn();
    playTrack(el, { id: "t" } as MediaStreamTrack, onFrame);
    expect(el.muted).toBe(true);
    expect(el.playsInline).toBe(true);
    expect((el.srcObject as unknown as { tracks: unknown[] }).tracks).toEqual([{ id: "t" }]);
    expect(onFrame).not.toHaveBeenCalled();
    frame();
    expect(onFrame).toHaveBeenCalledTimes(1);
  });

  it("waits for loaded data where frame callbacks aren't there", () => {
    vi.stubGlobal("MediaStream", class { constructor(readonly tracks: unknown[]) {} });
    const { el, addEventListener } = video({ play: () => Promise.resolve() });
    const onFrame = vi.fn();
    playTrack(el, {} as MediaStreamTrack, onFrame);
    expect(addEventListener).toHaveBeenCalledWith("loadeddata", onFrame, { once: true });
  });
});
