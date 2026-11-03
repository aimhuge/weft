// The editor's live reload on a worker's session line (lib/host-line-files.ts, wired in lib/host-line.ts): a watch starts
// only after files.watch ran, pushes `file` on the line's events, stops on unwatch or when the line closes, and a line
// takes at most MAX_WATCHES. lib/session-line.real.test.ts runs it over two real peers.
import { describe, expect, it, vi } from "vitest";
import { createHostLines, type LineChannel } from "./host-line";
import { lineFileWatches, MAX_WATCHES, TOO_MANY_WATCHES, type WatchFile } from "./host-line-files";
import { newAnswerKey } from "./rtc-signal";
import type { Channels } from "./worker-rtc";

const call = (verb: string, args: Record<string, unknown>) => ({ id: 1, verb, args });

function fakeWatch() {
  const live = new Map<string, (hash: string | null) => void>();
  const watch = vi.fn<WatchFile>((id, path, changed) => {
    live.set(`${id}:${path}`, changed);
    return () => void live.delete(`${id}:${path}`);
  });
  return { watch, live };
}

describe("lineFileWatches", () => {
  it("watches once per file after the verb ran, pushes its changes, and drops it on unwatch", () => {
    const { watch, live } = fakeWatch();
    const pushed: unknown[] = [];
    const files = lineFileWatches(watch, (e) => pushed.push(e));
    files.ran(call("files.watch", { id: "c1", path: "a.ts" }));
    files.ran(call("files.watch", { id: "c1", path: "a.ts" }));
    expect(watch).toHaveBeenCalledOnce();
    live.get("c1:a.ts")?.("h2");
    expect(pushed).toEqual([{ t: "file", cardId: "c1", path: "a.ts", hash: "h2" }]);
    files.ran(call("files.unwatch", { id: "c1", path: "a.ts" }));
    expect(live.size).toBe(0);
    expect(files.count()).toBe(0);
    // Other verbs and args with no file are nothing to it.
    files.ran(call("files.read", { id: "c1", path: "a.ts" }));
    files.ran(call("files.watch", { id: "c1" }));
    files.ran(call("files.unwatch", { id: "c1", path: "never.ts" }));
    expect(files.count()).toBe(0);
  });

  it("refuses a new watch past the cap, but not one already watched, and closeAll stops them all", () => {
    const { watch, live } = fakeWatch();
    const files = lineFileWatches(watch, () => {}, 2);
    files.ran(call("files.watch", { id: "c1", path: "a" }));
    files.ran(call("files.watch", { id: "c1", path: "b" }));
    expect(files.refusal(call("files.watch", { id: "c1", path: "c" }))).toBe(TOO_MANY_WATCHES);
    expect(files.refusal(call("files.watch", { id: "c1", path: "a" }))).toBeNull();
    expect(files.refusal(call("files.read", { id: "c1", path: "c" }))).toBeNull();
    expect(files.refusal(call("files.watch", {}))).toBeNull();
    files.closeAll();
    expect(live.size).toBe(0);
    expect(files.count()).toBe(0);
    expect(MAX_WATCHES).toBeGreaterThan(8);
  });

  it("runs the verb but watches nothing without a watcher", () => {
    const files = lineFileWatches(undefined, () => {});
    files.ran(call("files.watch", { id: "c1", path: "a" }));
    expect(files.count()).toBe(0);
  });
});

function emitter<T>() {
  const subs: ((v: T) => void)[] = [];
  return { subscribe: (fn: (v: T) => void) => subs.push(fn), emit: (v: T) => subs.forEach((fn) => fn(v)) };
}

function channel(label: string) {
  const sent: unknown[] = [];
  const c = { label, bufferedAmount: 0, send: (text: string) => sent.push(JSON.parse(text)), onMessage: emitter<string>(), stateChanged: emitter<string>(), close: vi.fn() };
  return { c: c as unknown as LineChannel, sent, msg: (v: unknown) => c.onMessage.emit(JSON.stringify(v)), state: (s: string) => c.stateChanged.emit(s) };
}

describe("a line's watches", () => {
  it("start after files.watch runs, push on the events channel, refuse past the cap and stop with the line", async () => {
    const { watch, live } = fakeWatch();
    const closed = emitter<undefined>();
    let channels: Channels = {};
    const answer = vi.fn((_: string, given: Channels) => {
      channels = given;
      return Promise.resolve({ answer: "a", close: vi.fn(), renegotiate: vi.fn(), onClosed: (fn: () => void) => closed.subscribe(fn) });
    });
    const offer = JSON.stringify({ sdp: "v=0", key: newAnswerKey(), topic: "worker-line:t", ice: [] });
    const lines = createHostLines({ unseal: () => offer, answerOn: () => Promise.resolve(), hear: () => () => {}, answer, watchFile: watch });
    const run = vi.fn((p: { verb: string; args: Record<string, unknown> }) =>
      p.args.path === "bad" ? Promise.reject(new Error("holds credentials")) : Promise.resolve({ cardId: "c1", result: { ok: true as const, cardId: "c1" } }),
    );
    await lines.open({} as never, run);
    const host = channel("host");
    const events = channel("events");
    channels.host?.(host.c);
    // A change before the events channel opens goes nowhere.
    host.msg({ id: 1, verb: "files.watch", args: { id: "c1", path: "a.ts" } });
    await vi.waitFor(() => expect(host.sent).toHaveLength(1));
    live.get("c1:a.ts")?.("h0");
    channels.events?.(events.c);
    live.get("c1:a.ts")?.("h1");
    expect(events.sent).toEqual([{ t: "file", cardId: "c1", path: "a.ts", hash: "h1" }]);
    // A refused verb watches nothing.
    host.msg({ id: 2, verb: "files.watch", args: { id: "c1", path: "bad" } });
    await vi.waitFor(() => expect(host.sent).toHaveLength(2));
    expect(host.sent[1]).toEqual({ id: 2, ok: false, error: "holds credentials" });
    expect(live.size).toBe(1);
    for (let i = 0; i < MAX_WATCHES; i++) host.msg({ id: 10 + i, verb: "files.watch", args: { id: "c1", path: `f${String(i)}` } });
    await vi.waitFor(() => expect(host.sent).toHaveLength(2 + MAX_WATCHES));
    expect(host.sent.at(-1)).toEqual({ id: 10 + MAX_WATCHES - 1, ok: false, error: TOO_MANY_WATCHES });
    expect(run).toHaveBeenCalledTimes(1 + 1 + MAX_WATCHES - 1);
    // The events channel closing stops the pushes; the line closing stops the watches.
    events.state("closed");
    live.get("c1:a.ts")?.("h2");
    expect(events.sent).toHaveLength(1);
    closed.emit(undefined);
    expect(live.size).toBe(0);
  });
});
