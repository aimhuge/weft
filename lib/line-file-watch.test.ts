// The editor's live reload over a worker's session line (lib/line-file-watch.ts): the watch is asked on a line that's up,
// again each time one comes up, its `file` events and its answered hash reach the editor, and the stop unwatches.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LineEvent } from "./host-line-protocol";

type FakeLine = { up: () => boolean; call: ReturnType<typeof vi.fn>; onEvent: (fn: (e: LineEvent) => void) => () => void; isUp: boolean };
const state = vi.hoisted(() => ({ line: null as object | null, change: new Set<() => void>(), listeners: new Set<(e: LineEvent) => void>() }));
vi.mock("./session-lines", () => ({
  lineFor: () => state.line,
  onLinesChange: (fn: () => void) => (state.change.add(fn), () => void state.change.delete(fn)),
}));
const { lineWatch } = await import("./line-file-watch");

function line(): FakeLine {
  const l: FakeLine = {
    isUp: true,
    up: () => l.isUp,
    call: vi.fn((verb: string) => Promise.resolve(verb === "files.watch" ? { ok: true, cardId: "c1", value: { path: "a.ts", hash: "h0" } } : { ok: true, cardId: "c1" })),
    onEvent: (fn) => (state.listeners.add(fn), () => void state.listeners.delete(fn)),
  };
  state.line = l;
  return l;
}
const changed = () => state.change.forEach((fn) => fn());
const hear = (e: LineEvent) => state.listeners.forEach((fn) => fn(e));
const settle = () => new Promise((done) => setTimeout(done, 0));

beforeEach(() => {
  state.line = null;
  state.change.clear();
  state.listeners.clear();
});

describe("lineWatch", () => {
  it("watches on a line that's up, passes on its hash and its file events, and unwatches on stop", async () => {
    const l = line();
    const seen = vi.fn();
    const stop = lineWatch("w1")("c1", "a.ts", seen);
    expect(l.call).toHaveBeenCalledWith("files.watch", { id: "c1", path: "a.ts" });
    await settle();
    expect(seen).toHaveBeenCalledWith("h0");
    hear({ t: "file", cardId: "c1", path: "a.ts", hash: "h1" });
    hear({ t: "file", cardId: "c1", path: "b.ts", hash: "hx" });
    hear({ t: "file", cardId: "c2", path: "a.ts", hash: "hx" });
    hear({ t: "card_deleted", id: "c1" });
    expect(seen.mock.calls).toEqual([["h0"], ["h1"]]);
    // A pong on the same line asks nothing again.
    changed();
    expect(l.call).toHaveBeenCalledTimes(1);
    stop();
    expect(l.call).toHaveBeenLastCalledWith("files.unwatch", { id: "c1", path: "a.ts" });
    expect(state.listeners.size).toBe(0);
    expect(state.change.size).toBe(0);
  });

  it("waits for a line, asks again when it comes back up, and ignores an answer from a line it left", async () => {
    const seen = vi.fn();
    const stop = lineWatch("w1")("c1", "a.ts", seen);
    const l = line();
    l.isUp = false;
    changed();
    expect(l.call).not.toHaveBeenCalled();
    l.isUp = true;
    changed();
    expect(l.call).toHaveBeenCalledTimes(1);
    // The line drops before the answer lands: that hash isn't passed on, and its events aren't heard.
    l.isUp = false;
    changed();
    await settle();
    expect(seen).not.toHaveBeenCalled();
    expect(state.listeners.size).toBe(0);
    l.isUp = true;
    changed();
    await settle();
    expect(l.call).toHaveBeenCalledTimes(2);
    expect(seen).toHaveBeenCalledWith("h0");
    // A refused watch or an answer without a hash says nothing; a stop on a line that's down sends nothing.
    l.call.mockRejectedValueOnce(new Error("holds credentials"));
    const quiet = vi.fn();
    lineWatch("w1")("c1", ".env", quiet)();
    l.call.mockResolvedValueOnce({ ok: true, cardId: "c1" });
    lineWatch("w1")("c1", "b.ts", quiet);
    await settle();
    expect(quiet).not.toHaveBeenCalled();
    l.isUp = false;
    const calls = l.call.mock.calls.length;
    stop();
    expect(l.call).toHaveBeenCalledTimes(calls);
  });

  it("shrugs off a failed unwatch", async () => {
    const l = line();
    const stop = lineWatch("w1")("c1", "a.ts", vi.fn());
    l.call.mockRejectedValueOnce(new Error("gone"));
    expect(() => stop()).not.toThrow();
    await settle();
  });
});
