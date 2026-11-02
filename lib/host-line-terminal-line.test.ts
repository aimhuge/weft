// A worker's line terminal (lib/host-line.ts with lib/host-line-terminal.ts), with the peer connection faked: one
// terminal per line at a time, its place freed when it closes, and every one killed with the line.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHostLines, type HostLineDeps, type LineChannel } from "./host-line";
import type { LineEvent } from "./host-line-protocol";
import { newAnswerKey, type SealedAnswer } from "./rtc-signal";
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

describe("terminal with signed approvals", () => {
  it("opens one at a time per line, frees its place when it closes, and dies with the line", async () => {
    const kill = vi.fn();
    const shell = { onData: vi.fn(), onExit: vi.fn(), write: vi.fn(), resize: vi.fn(), kill };
    const { lines, peer } = setup({ terminal: { allow: () => Promise.resolve("/w/app"), spawn: () => shell } });
    await lines.open(sealed, run);
    const first = channel("terminal");
    peer.channels.terminal?.(first.c);
    first.msg({ t: "open", folder: "app", cols: 80, rows: 24, widen: {} });
    await new Promise((r) => setTimeout(r, 0));
    expect(first.sent).toEqual([{ t: "opened" }]);
    const second = channel("terminal");
    peer.channels.terminal?.(second.c);
    expect(second.c.close).toHaveBeenCalled();
    first.state("closed");
    expect(kill).toHaveBeenCalledTimes(1);
    const third = channel("terminal");
    peer.channels.terminal?.(third.c);
    expect(third.c.close).not.toHaveBeenCalled();
    third.msg({ t: "open", folder: "app", cols: 80, rows: 24, widen: {} });
    await new Promise((r) => setTimeout(r, 0));
    lines.closeAll();
    expect(kill).toHaveBeenCalledTimes(2);
  });
});
