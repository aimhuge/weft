import { describe, expect, it, vi } from "vitest";
import { RTCPeerConnection } from "werift";
import { frameReader } from "./h264-frames";
import { newAnswerKey, openAnswer, sealAnswer } from "./rtc-signal";
import { inputChannel, sendFrame, videoChannel } from "./worker-fast-screen";
import { answerOffer, peerIce, type Channel } from "./worker-rtc";

describe("peerIce", () => {
  it("takes the board's servers, else Cloudflare's STUN", () => {
    expect(peerIce([{ urls: "turn:t" }])).toEqual([{ urls: "turn:t" }]);
    expect(peerIce([])).toEqual([{ urls: "stun:stun.cloudflare.com:3478" }]);
    expect(peerIce()).toEqual([{ urls: "stun:stun.cloudflare.com:3478" }]);
  });
});

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
      getTransceivers: () => [],
      close,
    };
    const out = await answerOffer("offer", {}, { make: () => peer, wait: 1 });
    expect(out.answer).toBe("answer");
    out.close();
    expect(close).toHaveBeenCalled();
  });

  it("hands the offered m-lines to media before answering, and answers once gathering completes", async () => {
    const subs: ((state: string) => void)[] = [];
    const transceivers = [{ kind: "video" }];
    const media = vi.fn();
    const peer = {
      onDataChannel: { subscribe: vi.fn() },
      iceGatheringStateChange: { subscribe: (fn: (state: string) => void) => subs.push(fn) },
      iceGatheringState: "gathering",
      setRemoteDescription: () => Promise.resolve(),
      getTransceivers: () => transceivers,
      createAnswer: () => {
        expect(media).toHaveBeenCalledWith(transceivers);
        return Promise.resolve({});
      },
      setLocalDescription: () => Promise.resolve(),
      localDescription: { sdp: "answer" },
      close: () => Promise.reject(new Error("gone")),
    };
    const answering = answerOffer("offer", {}, { media, make: () => peer as never, wait: 60_000 });
    await vi.waitFor(() => expect(subs).toHaveLength(1));
    subs[0]?.("gathering");
    subs[0]?.("complete");
    const out = await answering;
    expect(out.answer).toBe("answer");
    out.close();
  });

  it("routes a label with no handler to *, renegotiates the same peer, takes the board's ICE servers and says once when it closes", async () => {
    const dcs: ((c: Channel) => void)[] = [];
    const states: ((s: string) => void)[] = [];
    const remote: string[] = [];
    const peer = {
      onDataChannel: { subscribe: (fn: (c: Channel) => void) => dcs.push(fn) },
      iceGatheringStateChange: { subscribe: vi.fn() },
      iceGatheringState: "complete",
      setRemoteDescription: (d: { sdp: string }) => Promise.resolve(remote.push(d.sdp)),
      createAnswer: () => Promise.resolve({}),
      setLocalDescription: () => Promise.resolve(),
      localDescription: { sdp: "answer" },
      getTransceivers: () => [{ kind: "video" }],
      close: () => Promise.resolve(),
      connectionStateChange: { subscribe: (fn: (s: string) => void) => states.push(fn) },
    };
    const make = vi.fn(() => peer as never);
    const star = vi.fn();
    const host = vi.fn();
    const ice = [{ urls: "turn:t", username: "u", credential: "c" }];
    const out = await answerOffer("offer", { host, "*": star }, { make, ice });
    expect(make).toHaveBeenCalledWith(ice);
    dcs[0]?.({ label: "host" } as Channel);
    dcs[0]?.({ label: "input:sim:1" } as Channel);
    expect(host).toHaveBeenCalledTimes(1);
    expect(star).toHaveBeenCalledWith({ label: "input:sim:1" });
    const media = vi.fn();
    await expect(out.renegotiate("offer 2", media)).resolves.toBe("answer");
    expect(remote).toEqual(["offer", "offer 2"]);
    expect(media).toHaveBeenCalledWith([{ kind: "video" }]);
    const gone = vi.fn();
    out.onClosed(gone);
    states[0]?.("connected");
    states[0]?.("failed");
    states[0]?.("closed");
    expect(gone).toHaveBeenCalledTimes(1);
  });

  it("leaves a label nobody handles alone, and a peer with no state events never says it closed", async () => {
    const dcs: ((c: Channel) => void)[] = [];
    const peer = { onDataChannel: { subscribe: (fn: (c: Channel) => void) => dcs.push(fn) }, iceGatheringStateChange: { subscribe: vi.fn() }, iceGatheringState: "complete", setRemoteDescription: () => Promise.resolve(), createAnswer: () => Promise.resolve({}), setLocalDescription: () => Promise.resolve(), localDescription: { sdp: "a" }, getTransceivers: () => [], close: () => Promise.resolve() };
    const out = await answerOffer("offer", {}, { make: () => peer });
    expect(() => dcs[0]?.({ label: "x" } as Channel)).not.toThrow();
    expect(() => out.onClosed(vi.fn())).not.toThrow();
  });

  it("refuses to answer with nothing", async () => {
    const peer = { onDataChannel: { subscribe: vi.fn() }, iceGatheringStateChange: { subscribe: vi.fn() }, iceGatheringState: "complete", setRemoteDescription: () => Promise.resolve(), createAnswer: () => Promise.resolve({}), setLocalDescription: () => Promise.resolve(), localDescription: null, getTransceivers: () => [], close: vi.fn() };
    await expect(answerOffer("offer", {}, { make: () => peer })).rejects.toThrow("no answer");
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
