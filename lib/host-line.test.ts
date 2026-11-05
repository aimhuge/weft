// A worker's session lines (lib/host-line.ts), with the peer connection faked: what each channel does, the terminal's
// refusal, the screen on the line, and when a line closes. lib/session-line.real.test.ts runs two real peers.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHostLines, type HostLineDeps, type LineChannel } from "./host-line";
import { TERMINAL_REFUSAL, type LineEvent } from "./host-line-protocol";
import { newAnswerKey, openAnswer, type SealedAnswer } from "./rtc-signal";
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

let bus: Set<(e: LineEvent) => void>;
let answers: { topic: string; sealed: SealedAnswer }[];

function setup(over: Partial<HostLineDeps> = {}) {
  const { peer, answer } = fakePeer();
  const unseal = vi.fn(() => offer());
  const deps: HostLineDeps = {
    unseal,
    answerOn: vi.fn((topic: string, sealed: SealedAnswer) => Promise.resolve(answers.push({ topic, sealed }))),
    hear: (fn) => (bus.add(fn), () => void bus.delete(fn)),
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

  it("hands the answer to the caller's answerOn instead of the topic, for an offer that came over the LAN", async () => {
    const { lines } = setup();
    const lan = vi.fn<(topic: string, sealed: SealedAnswer) => Promise<void>>(() => Promise.resolve());
    await lines.open(sealed, run, lan);
    expect(answers).toEqual([]);
    expect(lan.mock.calls[0]![0]).toBe("worker-line:t");
    await expect(openAnswer(key, lan.mock.calls[0]![1])).resolves.toBe("answer");
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

describe("host on a closing channel", () => {
  it("keeps running verbs after a reply couldn't be sent", async () => {
    const { lines, peer } = setup();
    await lines.open(sealed, run);
    const host = channel("host");
    let fail = true;
    const sent: unknown[] = [];
    (host.c as { send: (t: string) => void }).send = (t) => {
      if (fail) {
        fail = false;
        throw new Error("closed");
      }
      sent.push(JSON.parse(t));
    };
    peer.channels.host?.(host.c);
    host.msg({ id: 1, verb: "card.stop", args: { id: "c1" } });
    host.msg({ id: 2, verb: "card.stop", args: { id: "c1" } });
    await vi.waitFor(() => expect(sent).toEqual([{ id: 2, ok: true, result: { ok: true, cardId: "c1" } }]));
  });
});

describe("events", () => {
  it("sends what the publisher ships until the channel closes", async () => {
    const { lines, peer } = setup();
    await lines.open(sealed, run);
    const events = channel("events");
    peer.channels.events?.(events.c);
    bus.forEach((fn) => fn({ t: "card", card: { id: "c1" } as never }));
    expect(events.sent).toEqual([{ t: "card", card: { id: "c1" } }]);
    events.state("open");
    events.state("closed");
    expect(bus.size).toBe(0);
  });
});

describe("channels", () => {
  it("takes one channel per fixed label, and closes a second one or a label nobody handles", async () => {
    const { lines, peer } = setup();
    await lines.open(sealed, run);
    for (const label of ["host", "events", "line"]) {
      const first = channel(label);
      const second = channel(label);
      peer.channels[label]?.(first.c);
      peer.channels[label]?.(second.c);
      expect(first.c.close).not.toHaveBeenCalled();
      expect(second.c.close).toHaveBeenCalled();
    }
    const odd = channel("shell");
    peer.channels["*"]?.(odd.c);
    expect(odd.c.close).toHaveBeenCalled();
    expect(() => peer.channels.host?.(channel("host", false).c)).not.toThrow();
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

  it("renegotiates one offer at a time, and refuses offers past the rate", async () => {
    let t = 0;
    const { lines, peer } = setup({ now: () => t });
    await lines.open(sealed, run);
    const releases: (() => void)[] = [];
    let running = 0;
    let most = 0;
    peer.renegotiate.mockImplementation(() => {
      running += 1;
      most = Math.max(most, running);
      return new Promise<string>((done) => {
        releases.push(() => {
          running -= 1;
          done("a");
        });
      });
    });
    const ctl = channel("line");
    peer.channels.line?.(ctl.c);
    for (let i = 0; i < 6; i++) ctl.msg({ t: "offer", sdp: `o${i}` });
    expect(ctl.sent).toEqual([{ t: "error", message: "Too many offers on this line. Wait a moment." }]);
    for (let i = 0; i < 5; i++) {
      await vi.waitFor(() => expect(releases.length).toBe(i + 1));
      releases[i]?.();
    }
    await vi.waitFor(() => expect(ctl.sent.filter((m) => (m as { t: string }).t === "answer")).toHaveLength(5));
    expect(most).toBe(1);
    t = 10_000;
    ctl.msg({ t: "offer", sdp: "later" });
    await vi.waitFor(() => expect(releases.length).toBe(6));
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
  it("attaches a watched device's screen named by a well-formed channel, for a card of its own", async () => {
    const stop = vi.fn();
    const fast = { attach: vi.fn(() => stop), input: vi.fn() };
    const { lines, peer } = setup({ screen: () => fast as never, watcher: () => ({ id: "c1" }) as never });
    await lines.open(sealed, run);
    peer.renegotiate.mockImplementation((_, media) => (media?.([{ kind: "video" }] as never), Promise.resolve("a")));
    const ctl = channel("line");
    peer.channels.line?.(ctl.c);
    ctl.msg({ t: "offer", sdp: "o", screen: { device: "sim", channel: "input:sim:0123abcd" } });
    await vi.waitFor(() => expect(fast.attach).toHaveBeenCalled());
    lines.closeAll();
    expect(stop).toHaveBeenCalled();
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
