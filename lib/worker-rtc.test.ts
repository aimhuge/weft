import { describe, expect, it, vi } from "vitest";
import { RTCPeerConnection } from "werift";
import { frameReader } from "./h264-frames";
import { newAnswerKey, openAnswer, sealAnswer } from "./rtc-signal";
import { inputChannel, sendFrame, videoChannel } from "./worker-fast-screen";
import { answerOffer, type Channel } from "./worker-rtc";

describe("answerOffer", () => {
  it("answers with whatever a slow gather has so far, and closes", async () => {
    const close = vi.fn(() => Promise.resolve());
    const peer = {
      onDataChannel: { subscribe: vi.fn() },
      iceGatheringStateChange: { subscribe: vi.fn() },
      iceGatheringState: "gathering",
      setRemoteDescription: () => Promise.resolve(),
      createAnswer: () => Promise.resolve({}),
      setLocalDescription: () => Promise.resolve(),
      localDescription: { sdp: "answer" },
      close,
    };
    const out = await answerOffer("offer", {}, () => peer, 1);
    expect(out.answer).toBe("answer");
    out.close();
    expect(close).toHaveBeenCalled();
  });

  it("refuses to answer with nothing", async () => {
    const peer = { onDataChannel: { subscribe: vi.fn() }, iceGatheringStateChange: { subscribe: vi.fn() }, iceGatheringState: "complete", setRemoteDescription: () => Promise.resolve(), createAnswer: () => Promise.resolve({}), setLocalDescription: () => Promise.resolve(), localDescription: null, close: vi.fn() };
    await expect(answerOffer("offer", {}, () => peer)).rejects.toThrow("no answer");
  });
});

// Two real WebRTC peers on this machine: everything but idb and the network between them.
describe("a real line", () => {
  it("carries a key frame bigger than one message, and a gesture back, through a sealed answer", async () => {
    const board = new RTCPeerConnection({});
    const video = board.createDataChannel("video");
    const input = board.createDataChannel("input");
    const got: Uint8Array[] = [];
    const read = frameReader((f) => got.push(f.slice()));
    video.onMessage.subscribe((m) => read(new Uint8Array(m as Buffer)));
    await board.setLocalDescription(await board.createOffer());

    const touch = vi.fn();
    const big = Buffer.alloc(70_000, 7);
    big.set([0, 0, 1, 0x65]);
    const idb = { size: { width: 400, height: 800 }, touch, key: vi.fn(), video: (onFrame: (f: Buffer) => void) => (setTimeout(() => onFrame(big), 200), () => {}) };
    const worker = await answerOffer(board.localDescription?.sdp ?? "", { video: (c) => videoChannel(idb, c), input: (c) => inputChannel(idb, c) });

    const key = newAnswerKey();
    const sealed = await sealAnswer(key, worker.answer);
    await board.setRemoteDescription({ type: "answer", sdp: await openAnswer(key, sealed) } as never);

    await vi.waitFor(() => expect(got).toHaveLength(1), { timeout: 15_000 });
    expect(Buffer.from(got[0] as Uint8Array).equals(big)).toBe(true);
    await vi.waitFor(() => expect(input.readyState).toBe("open"), { timeout: 5_000 });
    input.send(JSON.stringify({ t: "down", x: 0.5, y: 0.25 }));
    await vi.waitFor(() => expect(touch).toHaveBeenCalledWith("down", 200, 200), { timeout: 5_000 });
    worker.close();
    await board.close();
  }, 30_000);
});

describe("the channels", () => {
  const events = () => {
    const subs: ((v: never) => void)[] = [];
    return { subscribe: (fn: (v: never) => void) => subs.push(fn), emit: (v: unknown) => subs.forEach((fn) => fn(v as never)) };
  };

  it("splits a frame so each message fits", () => {
    const sent: Buffer[] = [];
    sendFrame({ send: (b) => sent.push(b as Buffer) }, Buffer.alloc(40_000));
    expect(sent.length).toBe(3);
    expect(sent.every((b) => b.length <= 16_384)).toBe(true);
  });

  it("starts at a key frame, skips to the next one when behind, and stops when the board leaves", () => {
    const state = events();
    const stop = vi.fn();
    let frame: (f: Buffer) => void = () => {};
    const send = vi.fn();
    const channel = { send, bufferedAmount: 0, stateChanged: state } as unknown as Channel;
    videoChannel({ video: (f) => ((frame = f), stop) }, channel);
    const key = Buffer.from([0, 0, 1, 0x65]);
    const delta = Buffer.from([0, 0, 1, 0x41]);
    frame(delta);
    expect(send).not.toHaveBeenCalled();
    frame(key);
    frame(delta);
    expect(send).toHaveBeenCalledTimes(2);
    (channel as { bufferedAmount: number }).bufferedAmount = 3_000_000;
    frame(delta);
    expect(send).toHaveBeenCalledTimes(2);
    state.emit("open");
    expect(stop).not.toHaveBeenCalled();
    state.emit("closed");
    expect(stop).toHaveBeenCalled();
  });

  it("forgets a video that ended by itself", () => {
    const state = events();
    const stop = vi.fn();
    let end = () => {};
    videoChannel({ video: (_, e) => ((end = e), stop) }, { stateChanged: state } as unknown as Channel);
    end();
    state.emit("closed");
    expect(stop).not.toHaveBeenCalled();
  });

  it("turns fractions into points, presses keys, and ignores nonsense", () => {
    const msg = events();
    const touch = vi.fn();
    const key = vi.fn();
    inputChannel({ size: { width: 100, height: 200 }, touch, key }, { onMessage: msg } as never);
    msg.emit('{"t":"move","x":0.5,"y":0.5}');
    msg.emit(Buffer.from('{"t":"key","code":4,"down":true}'));
    msg.emit('{"t":"move","x":9,"y":0}');
    expect(touch).toHaveBeenCalledTimes(1);
    expect(touch).toHaveBeenCalledWith("move", 50, 100);
    expect(key).toHaveBeenCalledWith(4, true);
  });
});
