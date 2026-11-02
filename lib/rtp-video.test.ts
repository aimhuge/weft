import { describe, expect, it, vi } from "vitest";
import { RTCPeerConnection, type RtpPacket } from "werift";
import { H264_CODECS, packetizer, rtpVideo, takeVideo, type VideoSender, type VideoTransceiver } from "./rtp-video";
import { newAnswerKey, openAnswer, sealAnswer } from "./rtc-signal";
import { answerOffer } from "./worker-rtc";

const events = <T,>() => {
  const subs: ((v: T) => void)[] = [];
  return { subscribe: (fn: (v: T) => void) => subs.push(fn), emit: (v: T) => subs.forEach((fn) => fn(v)) };
};

// SPS (High, level 5.1), PPS, then an IDR slice of the given size.
const keyFrame = (slice = 10) => Buffer.concat([Buffer.from([0, 0, 0, 1, 0x67, 0x64, 0, 0x33, 0xac, 0, 0, 0, 1, 0x68, 0xee, 0x3c, 0x80, 0, 0, 0, 1, 0x65]), Buffer.alloc(slice, 9)]);
const delta = Buffer.from([0, 0, 0, 1, 0x41, 1, 2, 3]);

describe("H264_CODECS", () => {
  it("offers High first, then Constrained Baseline, both in packetization-mode 1", () => {
    const codecs = H264_CODECS();
    expect(codecs.map((c) => c.mimeType)).toEqual(["video/H264", "video/H264"]);
    expect(codecs[0]?.parameters).toContain("profile-level-id=64001f");
    expect(codecs[1]?.parameters).toContain("profile-level-id=42e01f");
    expect(codecs.every((c) => c.parameters?.includes("packetization-mode=1"))).toBe(true);
  });
});

describe("takeVideo", () => {
  const transceiver = (kind: string, codecs: unknown[], replaceTrack = vi.fn(() => Promise.resolve())) => {
    const setDirection = vi.fn();
    return { t: { kind, codecs, setDirection, sender: { replaceTrack } } as unknown as VideoTransceiver, setDirection };
  };

  it("leaves an offer with no video, or no shared H.264, to the channel", () => {
    expect(takeVideo([])).toBeNull();
    expect(takeVideo([transceiver("audio", [{}]).t, transceiver("video", []).t])).toBeNull();
  });

  it("takes the video m-line for sending, with a track for the answer's msid", async () => {
    const failing = vi.fn(() => Promise.reject(new Error("no")));
    const { t, setDirection } = transceiver("video", [{}], failing);
    expect(takeVideo([t])).toBe(t.sender);
    expect(setDirection).toHaveBeenCalledWith("sendonly");
    expect(failing).toHaveBeenCalledWith(expect.objectContaining({ kind: "video" }));
    await Promise.resolve();
  });
});

describe("packetizer", () => {
  it("stamps each access unit on the 90 kHz clock from the start, and marks its last packet", () => {
    const packets = packetizer(1_000);
    const small = packets(delta, 1_100);
    expect(small).toHaveLength(1);
    expect(small[0]?.header.timestamp).toBe(9_000);
    expect(small[0]?.header.marker).toBe(true);
    const big = packets(keyFrame(5_000), 1_200);
    expect(big.length).toBeGreaterThan(4);
    expect(big.every((p) => p.payload.length <= 1_100)).toBe(true);
    expect(big.map((p) => p.header.marker)).toEqual([...Array<boolean>(big.length - 1).fill(false), true]);
    expect(big.every((p) => p.header.timestamp === 18_000)).toBe(true);
    // Sequence numbers run on across frames.
    expect(big[0]?.header.sequenceNumber).toBe(((small[0]?.header.sequenceNumber ?? 0) + 1) & 0xffff);
    expect(packets(delta)).toHaveLength(1);
  });
});

describe("rtpVideo", () => {
  const setup = () => {
    let t = 0;
    const ready = events<undefined>();
    const rtcp = events<Parameters<Parameters<VideoSender["onRtcp"]["subscribe"]>[0]>[0]>();
    const sendRtp = vi.fn(() => Promise.resolve());
    const sender: VideoSender = { sendRtp, onRtcp: rtcp, onReady: ready, ssrc: 5 };
    const streams: { onFrame: (f: Buffer) => void; onEnd: () => void; stop: ReturnType<typeof vi.fn>; bitrate?: number; quality?: string }[] = [];
    const idb = {
      video: vi.fn((onFrame: (f: Buffer) => void, onEnd: () => void, quality?: string, bitrate?: number) => {
        const stop = vi.fn();
        streams.push({ onFrame, onEnd, stop, quality, bitrate });
        return stop;
      }),
    };
    const stop = rtpVideo(idb, sender, "low", () => t);
    const pli = () => rtcp.emit({ type: 206, feedback: { count: 1 } });
    return { ready, rtcp, sendRtp, streams, stop, pli, tick: (ms: number) => (t += ms) };
  };

  it("starts the stream when DTLS connects, at the quality's rate, and sends each frame as RTP", () => {
    const { ready, streams, sendRtp, pli } = setup();
    pli();
    expect(streams).toHaveLength(0);
    ready.emit(undefined);
    ready.emit(undefined);
    expect(streams).toHaveLength(1);
    expect(streams[0]).toMatchObject({ quality: "low", bitrate: 2_000_000 });
    streams[0]?.onFrame(keyFrame(3_000));
    expect(sendRtp.mock.calls.length).toBeGreaterThan(2);
  });

  it("swallows a packet the transport refused", async () => {
    const { ready, streams, sendRtp } = setup();
    sendRtp.mockReturnValue(Promise.reject(new Error("closed")));
    ready.emit(undefined);
    streams[0]?.onFrame(delta);
    await Promise.resolve();
    expect(sendRtp).toHaveBeenCalled();
  });

  it("restarts the stream for a key frame on a PLI or FIR, at most once a second", () => {
    const { ready, rtcp, streams, pli, tick } = setup();
    tick(5_000);
    ready.emit(undefined);
    pli();
    expect(streams).toHaveLength(2);
    expect(streams[0]?.stop).toHaveBeenCalled();
    tick(500);
    pli();
    expect(streams).toHaveLength(2);
    tick(500);
    rtcp.emit({ type: 206, feedback: { count: 4 } });
    expect(streams).toHaveLength(3);
  });

  it("restarts the stream at a lower rate when the board reports sustained loss", () => {
    const { ready, rtcp, streams, tick } = setup();
    ready.emit(undefined);
    const rr = (packetsLost: number, highestSequence: number) => rtcp.emit({ type: 201, reports: [{ ssrc: 5, packetsLost, highestSequence }] });
    rr(0, 0);
    tick(5_000);
    rr(30, 100);
    expect(streams).toHaveLength(2);
    expect(streams[1]?.bitrate).toBe(1_200_000);
  });

  it("forgets a stream that ended by itself, but not one replaced since", () => {
    const { ready, streams, pli, tick } = setup();
    ready.emit(undefined);
    tick(2_000);
    pli();
    streams[0]?.onEnd();
    tick(2_000);
    pli();
    expect(streams).toHaveLength(3);
    streams[2]?.onEnd();
    tick(2_000);
    pli();
    expect(streams).toHaveLength(3);
  });

  it("stops the stream and starts no other once the line closes", () => {
    const { ready, streams, stop } = setup();
    stop();
    ready.emit(undefined);
    expect(streams).toHaveLength(0);
    const second = setup();
    second.ready.emit(undefined);
    second.stop();
    expect(second.streams[0]?.stop).toHaveBeenCalled();
    second.stop();
  });
});

// Two real WebRTC peers on this machine: the board offers a receive-only H.264 m-line, the worker answers with the track.
describe("a real line with a video track", () => {
  it("negotiates High profile H.264 and delivers the screen as RTP, the channel left unused", async () => {
    const board = new RTCPeerConnection({ codecs: { video: H264_CODECS() } });
    board.addTransceiver("video", { direction: "recvonly" });
    const video = board.createDataChannel("video");
    const onChannel = vi.fn();
    video.onMessage.subscribe(onChannel);
    const got: RtpPacket[] = [];
    board.onTrack.subscribe((track) => track.onReceiveRtp.subscribe((p) => got.push(p)));
    await board.setLocalDescription(await board.createOffer());

    let frame: ((f: Buffer) => void) | null = null;
    const idb = { video: (onFrame: (f: Buffer) => void) => ((frame = onFrame), () => (frame = null)) };
    let stop = () => {};
    const worker = await answerOffer(board.localDescription?.sdp ?? "", { video: () => {} }, {
      media: (transceivers) => {
        const sender = takeVideo(transceivers);
        if (sender) stop = rtpVideo(idb, sender);
      },
    });
    expect(worker.answer).toMatch(/a=sendonly/);
    expect(worker.answer).toMatch(/profile-level-id=64001f/);

    const key = newAnswerKey();
    await board.setRemoteDescription({ type: "answer", sdp: await openAnswer(key, await sealAnswer(key, worker.answer)) } as never);
    await vi.waitFor(() => expect(frame).not.toBeNull(), { timeout: 15_000 });
    const timer = setInterval(() => frame?.(keyFrame(4_000)), 50);
    await vi.waitFor(() => expect(got.some((p) => p.header.marker)).toBe(true), { timeout: 10_000 });
    clearInterval(timer);
    expect(onChannel).not.toHaveBeenCalled();
    stop();
    expect(frame).toBeNull();
    worker.close();
    await board.close();
  }, 30_000);
});
