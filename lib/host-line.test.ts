// A worker's session lines (lib/host-line.ts), with the peer connection faked: what each channel does, the terminal's
// refusal, the screen on the line, and when a line closes. lib/session-line.real.test.ts runs two real peers.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHostLines, type HostLineDeps, type LineChannel } from "./host-line";
import { TERMINAL_REFUSAL } from "./host-line-protocol";
import { newAnswerKey, openAnswer, type SealedAnswer } from "./rtc-signal";
import type { BoardEvent } from "./types";
import type { Channels } from "./worker-rtc";

function emitter<T>() {
  const subs: ((v: T) => void)[] = [];
  return { subscribe: (fn: (v: T) => void) => subs.push(fn), emit: (v: T) => subs.forEach((fn) => fn(v)) };
}

function channel(label: string, withClose = true) {
  const sent: unknown[] = [];
  const c = {
    label,
    bufferedAmount: 0,
    send: (text: string) => sent.push(JSON.parse(text)),
    onMessage: emitter<string>(),
    stateChanged: emitter<string>(),
    ...(withClose ? { close: vi.fn() } : {}),
  };
  return { c: c as unknown as LineChannel & { close?: () => void }, sent, msg: (v: unknown) => c.onMessage.emit(JSON.stringify(v)), state: (s: string) => c.stateChanged.emit(s) };
}

const key = newAnswerKey();
const offer = (over: Record<string, unknown> = {}) => JSON.stringify({ sdp: "v=0", key, topic: "worker-line:t", ice: [{ urls: "turn:t" }], ...over });

function fakePeer() {
  const closed = emitter<undefined>();
  const peer = {
    channels: {} as Channels,
    options: null as unknown,
    close: vi.fn(),
    renegotiate: vi.fn((_: string, media?: (t: never[]) => void) => (media?.([]), Promise.resolve("answer 2"))),
    closed,
  };
  const answer = vi.fn((_: string, channels: Channels, options: unknown) => {
    peer.channels = channels;
    peer.options = options;
    return Promise.resolve({ answer: "answer", close: peer.close, renegotiate: peer.renegotiate, onClosed: (fn: () => void) => closed.subscribe(fn) });
  });
  return { peer, answer: answer as unknown as HostLineDeps["answer"] };
}

let bus: Set<(e: BoardEvent) => void>;
let answers: { topic: string; sealed: SealedAnswer }[];

function setup(over: Partial<HostLineDeps> = {}) {
  const { peer, answer } = fakePeer();
  const unseal = vi.fn(() => offer());
  const deps: HostLineDeps = {
    unseal,
    answerOn: vi.fn((topic: string, sealed: SealedAnswer) => Promise.resolve(answers.push({ topic, sealed }))),
    hear: (fn) => (bus.add(fn), () => void bus.delete(fn)),
    project: (e) => Promise.resolve(e.type === "card" ? { t: "card", card: e.card } : null),
    answer,
    ...over,
  };
  const lines = createHostLines(deps);
  return { lines, peer, deps, unseal };
}

const sealed = { v: 1, epk: "a", iv: "b", ct: "c", tag: "d" } as never;
const run = vi.fn((payload: { verb: string; args: Record<string, unknown> }) => Promise.resolve({ cardId: String(payload.args.id), result: { ok: true as const, cardId: String(payload.args.id) } }));

beforeEach(() => {
  bus = new Set();
  answers = [];
  run.mockClear();
});
afterEach(() => vi.useRealTimers());

describe("opening a line", () => {
  it("answers under the board's key on its topic, with the board's ICE servers, and counts it", async () => {
    const { lines, peer, unseal } = setup();
    await lines.open(sealed, run);
    expect(unseal).toHaveBeenCalledWith(sealed, "rtc-line");
    expect(peer.options).toMatchObject({ ice: [{ urls: "turn:t" }] });
    expect(answers[0]?.topic).toBe("worker-line:t");
    await expect(openAnswer(key, answers[0]!.sealed)).resolves.toBe("answer");
    expect(lines.count()).toBe(1);
    peer.closed.emit(undefined);
    expect(lines.count()).toBe(0);
    expect(peer.close).toHaveBeenCalledTimes(1);
    peer.closed.emit(undefined);
    expect(peer.close).toHaveBeenCalledTimes(1);
  });

  it("refuses an offer that isn't whole", async () => {
    const { lines } = setup({ unseal: () => JSON.stringify({ sdp: "v=0" }) });
    await expect(lines.open(sealed, run)).rejects.toThrow("incomplete");
  });

  it("closes the line when the answer can't be sent", async () => {
    const { lines, peer } = setup({ answerOn: () => Promise.reject(new Error("offline")) });
    await expect(lines.open(sealed, run)).rejects.toThrow("offline");
    expect(peer.close).toHaveBeenCalled();
    expect(lines.count()).toBe(0);
  });

  it("closes the oldest past the cap, and a line pushed out while it answered", async () => {
    const { lines, peer } = setup({ maxLines: 1, log: vi.fn() });
    await lines.open(sealed, run);
    await lines.open(sealed, run);
    expect(lines.count()).toBe(1);
    expect(peer.close).toHaveBeenCalledTimes(1);

    let release: () => void = () => {};
    const slow = fakePeer();
    const gate = new Promise<void>((done) => (release = done));
    const answer = vi.fn(async (...args: Parameters<NonNullable<HostLineDeps["answer"]>>) => (await gate, slow.answer!(...args)));
    const two = setup({ maxLines: 1, answer: answer });
    const first = two.lines.open(sealed, run);
    const second = two.lines.open(sealed, run);
    release();
    await Promise.all([first, second]);
    expect(slow.peer.close).toHaveBeenCalledTimes(1);
    expect(two.lines.count()).toBe(1);
    two.lines.closeAll();
    expect(two.lines.count()).toBe(0);
  });

  it("closes a line no board has pinged for a while", async () => {
    vi.useFakeTimers();
    let t = 0;
    const { lines, peer } = setup({ quietMs: 1_000, now: () => t });
    await lines.open(sealed, run);
    const ctl = channel("line");
    peer.channels.line?.(ctl.c);
    t = 900;
    ctl.msg({ t: "ping", at: 1 });
    vi.advanceTimersByTime(1_000);
    expect(lines.count()).toBe(1);
    t = 2_500;
    vi.advanceTimersByTime(500);
    expect(lines.count()).toBe(0);
  });
});

describe("host", () => {
  it("runs each verb through the host command's path, in order, and says how it went", async () => {
    const { lines, peer } = setup();
    await lines.open(sealed, run);
    const host = channel("host");
    peer.channels.host?.(host.c);
    run.mockRejectedValueOnce(new Error("A shell command only runs from Weft's own window, not from the web."));
    host.msg({ id: 1, verb: "card.shell", args: { id: "c1", command: "ls" } });
    host.msg({ id: 2, verb: "card.stop", args: { id: "c1" } });
    host.c.onMessage.subscribe(() => {});
    (host.c.onMessage as unknown as { emit: (v: string) => void }).emit("not json");
    await vi.waitFor(() => expect(host.sent).toHaveLength(2));
    expect(host.sent).toEqual([
      { id: 1, ok: false, error: "A shell command only runs from Weft's own window, not from the web." },
      { id: 2, ok: true, result: { ok: true, cardId: "c1" } },
    ]);
    expect(run).toHaveBeenNthCalledWith(1, { verb: "card.shell", args: { id: "c1", command: "ls" } });
  });
});

describe("events", () => {
  it("pushes what the relay would mirror, in order, until the channel closes", async () => {
    const project = vi.fn((e: BoardEvent) => (e.type === "card_deleted" ? Promise.reject(new Error("x")) : Promise.resolve(e.type === "card" ? ({ t: "card", card: e.card } as never) : null)));
    const { lines, peer } = setup({ project });
    await lines.open(sealed, run);
    const events = channel("events");
    peer.channels.events?.(events.c);
    bus.forEach((fn) => fn({ type: "card_deleted", id: "x" }));
    bus.forEach((fn) => fn({ type: "account" }));
    bus.forEach((fn) => fn({ type: "card", card: { id: "c1" } as never }));
    await vi.waitFor(() => expect(events.sent).toEqual([{ t: "card", card: { id: "c1" } }]));
    events.state("open");
    events.state("closed");
    expect(bus.size).toBe(0);
  });
});

describe("line", () => {
  it("pongs a ping, renegotiates an offer, says why one failed, and ignores the rest", async () => {
    const { lines, peer } = setup();
    await lines.open(sealed, run);
    const ctl = channel("line");
    peer.channels.line?.(ctl.c);
    ctl.msg({ t: "ping", at: 42 });
    ctl.msg({ t: "pong", at: 1 });
    ctl.msg({ t: "nonsense" });
    ctl.msg({ t: "offer", sdp: "o2" });
    await vi.waitFor(() => expect(ctl.sent).toEqual([{ t: "pong", at: 42 }, { t: "answer", sdp: "answer 2" }]));
    peer.renegotiate.mockRejectedValueOnce(new Error("bad sdp"));
    ctl.msg({ t: "offer", sdp: "o3" });
    await vi.waitFor(() => expect(ctl.sent.at(-1)).toEqual({ t: "error", message: "bad sdp" }));
  });

  it("ignores an offer that arrives before the line has answered", async () => {
    let channels: Channels = {};
    let release: () => void = () => {};
    const gate = new Promise<void>((done) => (release = done));
    const { peer, answer } = fakePeer();
    const slow = vi.fn(async (sdp: string, c: Channels, o: never) => ((channels = c), await gate, answer!(sdp, c, o)));
    const { lines } = setup({ answer: slow as never });
    const opening = lines.open(sealed, run);
    await vi.waitFor(() => expect(channels.line).toBeDefined());
    const ctl = channel("line");
    channels.line?.(ctl.c);
    ctl.msg({ t: "offer", sdp: "early" });
    release();
    await opening;
    expect(peer.renegotiate).not.toHaveBeenCalled();
  });
});

describe("the screen on the line", () => {
  const screen = (stop: (() => void) | null) => ({ attach: vi.fn(() => stop), input: vi.fn() });

  it("sends a watched device on the new m-line, stops it when its input channel closes, and replaces it", async () => {
    const stops = [vi.fn(), vi.fn()];
    let n = 0;
    const fast = { attach: vi.fn(() => stops[n++]!), input: vi.fn() };
    const { lines, peer } = setup({ screen: (d) => (d === "sim" ? (fast as never) : null) });
    await lines.open(sealed, run);
    const initial = (peer.options as { media: (t: unknown[]) => void }).media;
    const old = { kind: "video" };
    initial([old]);
    const fresh = { kind: "video" };
    peer.renegotiate.mockImplementation((_, media) => (media?.([old, fresh] as never), Promise.resolve("a")));
    const ctl = channel("line");
    peer.channels.line?.(ctl.c);
    ctl.msg({ t: "offer", sdp: "o", screen: { device: "sim", quality: "low", channel: "input:sim:1" } });
    await vi.waitFor(() => expect(fast.attach).toHaveBeenCalledWith([fresh], "low"));
    ctl.msg({ t: "offer", sdp: "o", screen: { device: "sim", channel: "input:sim:1" } });
    await vi.waitFor(() => expect(stops[0]).toHaveBeenCalled());

    const input = channel("input:sim:1");
    peer.channels["*"]?.(input.c);
    expect(fast.input).toHaveBeenCalledWith(input.c);
    input.state("closed");
    expect(stops[1]).toHaveBeenCalled();
    input.state("closed");
    expect(stops[1]).toHaveBeenCalledTimes(1);
  });

  it("keys a screen with no channel by its device, and stops every screen when the line closes", async () => {
    const stop = vi.fn();
    const { lines, peer } = setup({ screen: () => screen(stop) as never });
    await lines.open(sealed, run);
    peer.renegotiate.mockImplementation((_, media) => (media?.([{ kind: "video" }] as never), Promise.resolve("a")));
    const ctl = channel("line");
    peer.channels.line?.(ctl.c);
    ctl.msg({ t: "offer", sdp: "o", screen: { device: "sim" } });
    await vi.waitFor(() => expect(ctl.sent).toHaveLength(1));
    lines.closeAll();
    expect(stop).toHaveBeenCalled();
  });

  it("carries nothing for a device it isn't watching, a box with no screens, or a screen that can't attach", async () => {
    for (const deps of [{}, { screen: () => null }, { screen: () => ({}) as never }, { screen: () => screen(null) as never }]) {
      const { lines, peer } = setup(deps);
      await lines.open(sealed, run);
      const ctl = channel("line");
      peer.channels.line?.(ctl.c);
      ctl.msg({ t: "offer", sdp: "o", screen: { device: "sim" } });
      ctl.msg({ t: "offer", sdp: "o" });
      await vi.waitFor(() => expect(ctl.sent).toHaveLength(2));
      const input = channel("input:sim:1");
      peer.channels["*"]?.(input.c);
      input.state("closed");
      peer.channels["*"]?.(channel("other").c);
      lines.closeAll();
    }
  });
});

describe("terminal", () => {
  it("is refused once it opens, with or without a way to close it", async () => {
    const { lines, peer } = setup();
    await lines.open(sealed, run);
    const term = channel("terminal");
    peer.channels.terminal?.(term.c);
    term.state("connecting");
    expect(term.sent).toEqual([]);
    term.state("open");
    expect(term.sent).toEqual([{ t: "refused", message: TERMINAL_REFUSAL }]);
    expect(term.c.close).toHaveBeenCalled();
    const bare = channel("terminal", false);
    peer.channels.terminal?.(bare.c);
    bare.state("open");
    expect(bare.sent).toHaveLength(1);
  });
});
