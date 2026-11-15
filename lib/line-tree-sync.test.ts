// The board's part in a synced folder (lib/line-tree-sync.ts): a `tree` channel on the worker's line, its first text the
// signed open, then texts both ways between the channel and /api/tree-sync; keepSynced opens one each time the line is up.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionLine } from "./session-line";

const lines = vi.hoisted(() => ({ lineFor: vi.fn(), onLineFlips: vi.fn(() => () => {}), retainLine: vi.fn(() => () => {}) }));
vi.mock("./session-lines", () => lines);
vi.mock("./api-client", () => ({ apiFetch: vi.fn(), API_HEADERS: {} }));

const { keepSynced, pipe } = await import("./line-tree-sync");

type Fake = {
  label: string;
  readyState: string;
  bufferedAmount: number;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  onopen: (() => void) | null;
  onmessage: ((e: MessageEvent) => void) | null;
  onclose: (() => void) | null;
};

function fakeChannel(label = "tree"): Fake {
  const ch: Fake = {
    label,
    readyState: "connecting",
    bufferedAmount: 0,
    send: vi.fn(),
    close: vi.fn(() => {
      ch.readyState = "closed";
    }),
    onopen: null,
    onmessage: null,
    onclose: null,
  };
  return ch;
}

function fakeLine(ch: Fake | null, up = true) {
  const line = { channel: vi.fn(() => ch), up: vi.fn(() => up) };
  return line as unknown as SessionLine & { channel: typeof line.channel; up: typeof line.up };
}

const T = { workerId: "w1", folder: "weft", workerName: "Mini" };
const msg = (data: string) => ({ data }) as MessageEvent;
const tick = () => new Promise((r) => setTimeout(r, 0));
const until = async (ok: () => boolean) => {
  for (let i = 0; i < 100 && !ok(); i++) await tick();
};

// An api where `out` hands each queued batch once, then hangs until released.
function fakeApi(batches: string[][] = []) {
  let release: () => void = () => {};
  const api = vi.fn(async (body: Record<string, unknown>): Promise<Record<string, unknown>> => {
    if (body.op === "open") return { open: "SIGNED" };
    if (body.op === "out") {
      const next = batches.shift();
      if (next) return { texts: next };
      await new Promise<void>((r) => (release = r));
      return { texts: [] };
    }
    return { ok: true };
  });
  return { api, release: () => release() };
}

const ops = (api: ReturnType<typeof vi.fn>) => api.mock.calls.map(([b]) => (b as { op: string }).op);

afterEach(() => vi.useRealTimers());

describe("pipe", () => {
  it("ends closed at once when the line has no channel", async () => {
    const { api } = fakeApi();
    const p = pipe(T, { api, line: () => null });
    expect(await p.done).toBe("closed");
    p.stop();
    expect(api).not.toHaveBeenCalled();
  });

  it("sends the signed open first, on the tree channel", async () => {
    const ch = fakeChannel();
    const line = fakeLine(ch);
    const { api } = fakeApi();
    pipe(T, { api, line: () => line });
    expect(line.channel).toHaveBeenCalledWith("tree");
    ch.readyState = "open";
    ch.onopen?.();
    await until(() => ch.send.mock.calls.length > 0);
    expect(api).toHaveBeenCalledWith({ op: "open", ...T });
    expect(ch.send).toHaveBeenCalledWith("SIGNED");
  });

  it("doesn't send the open on a channel that ended meanwhile", async () => {
    const ch = fakeChannel();
    let resolve: (v: Record<string, unknown>) => void = () => {};
    const api = vi.fn(() => new Promise<Record<string, unknown>>((r) => (resolve = r)));
    const p = pipe(T, { api, line: () => fakeLine(ch) });
    ch.onopen?.();
    p.stop();
    resolve({ open: "late" });
    await tick();
    expect(ch.send).not.toHaveBeenCalled();
  });

  it("is refused when main won't sign", async () => {
    const ch = fakeChannel();
    const log = vi.fn();
    const api = vi.fn(() => Promise.reject(new Error("Sync isn't on for weft.")));
    const p = pipe(T, { api, line: () => fakeLine(ch), log });
    ch.onopen?.();
    expect(await p.done).toBe("refused");
    expect(log).toHaveBeenCalledWith("folder sync of weft: Sync isn't on for weft.");
    expect(ch.close).toHaveBeenCalled();
  });

  it("is refused when the worker says so, with or without why", async () => {
    for (const [reply, said] of [[{ t: "refused", message: "not paired" }, "not paired"], [{ t: "refused" }, "refused"]] as const) {
      const ch = fakeChannel();
      const log = vi.fn();
      const { api } = fakeApi();
      const p = pipe(T, { api, line: () => fakeLine(ch), log });
      ch.onmessage?.(msg(JSON.stringify(reply)));
      expect(await p.done).toBe("refused");
      expect(log).toHaveBeenCalledWith(`folder sync of weft: ${said}`);
      expect(ops(api)).not.toContain("close");
    }
  });

  it("ignores a first text that isn't a reply", async () => {
    const ch = fakeChannel();
    const { api } = fakeApi();
    pipe(T, { api, line: () => fakeLine(ch) });
    ch.onmessage?.(msg("not json"));
    ch.onmessage?.(msg(JSON.stringify({ t: "other" })));
    await tick();
    expect(api).not.toHaveBeenCalled();
  });

  it("is refused when the server's peer can't start", async () => {
    const ch = fakeChannel();
    const log = vi.fn();
    const api = vi.fn(() => Promise.reject(new Error("no checkout")));
    const p = pipe(T, { api, line: () => fakeLine(ch), log });
    ch.onmessage?.(msg(JSON.stringify({ t: "opened" })));
    expect(await p.done).toBe("refused");
    expect(log).toHaveBeenCalledWith("folder sync of weft: no checkout");
  });

  it("once opened, sends the server's texts and posts the worker's in order, then closes", async () => {
    const ch = fakeChannel();
    ch.readyState = "open";
    const { api, release } = fakeApi([["a", "b"], ["c"]]);
    const p = pipe(T, { api, line: () => fakeLine(ch) });
    ch.onmessage?.(msg(JSON.stringify({ t: "opened" })));
    await until(() => ch.send.mock.calls.length === 3);
    expect(ch.send.mock.calls.map(([t]) => t as string)).toEqual(["a", "b", "c"]);
    expect(api).toHaveBeenCalledWith({ op: "opened", ...T });
    ch.onmessage?.(msg("x1"));
    ch.onmessage?.(msg("x2"));
    ch.onmessage?.(msg("x3"));
    await until(() => api.mock.calls.filter(([b]) => (b as { op: string }).op === "in").length === 2);
    const ins = api.mock.calls.filter(([b]) => (b as { op: string }).op === "in").map(([b]) => (b as { texts: string[] }).texts);
    expect(ins).toEqual([["x1"], ["x2", "x3"]]);
    ch.onclose?.();
    release();
    expect(await p.done).toBe("closed");
    expect(api).toHaveBeenCalledWith({ op: "close", ...T });
  });

  it("logs a batch the server didn't take, and carries on", async () => {
    const ch = fakeChannel();
    ch.readyState = "open";
    const log = vi.fn();
    const { api } = fakeApi();
    const real = api.getMockImplementation()!;
    api.mockImplementation(async (b) => {
      if (b.op === "in") throw new Error("That folder isn't syncing right now.");
      if (b.op === "close") throw new Error("gone");
      return real(b);
    });
    const p = pipe(T, { api, line: () => fakeLine(ch), log });
    ch.onmessage?.(msg(JSON.stringify({ t: "opened" })));
    await until(() => ops(api).includes("out"));
    ch.onmessage?.(msg("x"));
    await until(() => log.mock.calls.length > 0);
    expect(log).toHaveBeenCalledWith("folder sync: That folder isn't syncing right now.");
    p.stop();
    expect(await p.done).toBe("closed");
  });

  it("waits a second after an out that failed, and for a full channel to drain", async () => {
    vi.useFakeTimers();
    const ch = fakeChannel();
    ch.readyState = "open";
    ch.bufferedAmount = 10;
    let outs = 0;
    const api = vi.fn(async (b: Record<string, unknown>): Promise<Record<string, unknown>> => {
      if (b.op !== "out") return { ok: true };
      outs++;
      if (outs === 1) throw new Error("offline");
      if (outs === 2) return { texts: "not a list" };
      if (outs === 3) return { texts: ["big"] };
      return new Promise(() => {});
    });
    const p = pipe(T, { api, line: () => fakeLine(ch), highWater: 5 });
    ch.onmessage?.(msg(JSON.stringify({ t: "opened" })));
    await vi.advanceTimersByTimeAsync(0);
    expect(outs).toBe(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(outs).toBe(3);
    await vi.advanceTimersByTimeAsync(100);
    expect(ch.send).not.toHaveBeenCalled();
    ch.bufferedAmount = 0;
    await vi.advanceTimersByTimeAsync(50);
    expect(ch.send).toHaveBeenCalledWith("big");
    p.stop();
  });

  it("drops what's left to send once the channel closes while it drains", async () => {
    vi.useFakeTimers();
    const ch = fakeChannel();
    ch.readyState = "open";
    ch.bufferedAmount = 10;
    const { api } = fakeApi([["big"]]);
    const p = pipe(T, { api, line: () => fakeLine(ch), highWater: 5 });
    ch.onmessage?.(msg(JSON.stringify({ t: "opened" })));
    await vi.advanceTimersByTimeAsync(10);
    p.stop();
    await vi.advanceTimersByTimeAsync(100);
    expect(ch.send).not.toHaveBeenCalled();
    expect(await p.done).toBe("closed");
  });

  it("stops once, and doesn't close a channel already closed", async () => {
    const ch = fakeChannel();
    ch.readyState = "closed";
    const p = pipe(T, { api: fakeApi().api, line: () => fakeLine(ch) });
    p.stop();
    p.stop();
    expect(ch.close).not.toHaveBeenCalled();
    expect(await p.done).toBe("closed");
  });
});

describe("keepSynced", () => {
  beforeEach(() => vi.clearAllMocks());

  function setup(up = true) {
    const chans: Fake[] = [];
    const line = { channel: vi.fn(() => (chans.push(fakeChannel()), chans.at(-1)!)), up: vi.fn(() => up) };
    const releases = new Map<string, ReturnType<typeof vi.fn>>();
    const retain = vi.fn((id: string) => {
      const r = vi.fn();
      releases.set(id, r);
      return r;
    });
    let flip: (workerId: string, direct: boolean) => void = () => {};
    const off = vi.fn();
    const flips = vi.fn((fn: typeof flip) => {
      flip = fn;
      return off;
    });
    const { api } = fakeApi();
    return { chans, line, releases, retain, flips, off, api, flip: (id: string, d: boolean) => flip(id, d), deps: { api, line: () => line as unknown as SessionLine, retain, flips } };
  }

  it("holds each worker's line, and opens a pipe on a line that's up", () => {
    const s = setup();
    const stop = keepSynced([T, { workerId: "w2", folder: "ling" }], s.deps);
    expect(s.retain.mock.calls.map(([id]) => id)).toEqual(["w1", "w2"]);
    expect(s.chans).toHaveLength(2);
    stop();
    expect(s.off).toHaveBeenCalled();
    expect(s.chans.every((c) => c.close.mock.calls.length === 1)).toBe(true);
    expect(s.releases.get("w1")).toHaveBeenCalled();
    expect(s.releases.get("w2")).toHaveBeenCalled();
  });

  it("waits for a line that's down, and opens when it flips direct", () => {
    const s = setup(false);
    const stop = keepSynced([T], s.deps);
    expect(s.chans).toHaveLength(0);
    s.line.up.mockReturnValue(true);
    s.flip("w1", false);
    s.flip("other", true);
    expect(s.chans).toHaveLength(0);
    s.flip("w1", true);
    s.flip("w1", true);
    expect(s.chans).toHaveLength(1);
    stop();
  });

  it("opens again after a pipe closes, but never after one is refused", async () => {
    const s = setup();
    const stop = keepSynced([T], s.deps);
    s.chans[0]?.onclose?.();
    await tick();
    s.flip("w1", true);
    expect(s.chans).toHaveLength(2);
    s.chans[1]?.onmessage?.(msg(JSON.stringify({ t: "refused" })));
    await tick();
    s.flip("w1", true);
    expect(s.chans).toHaveLength(2);
    stop();
  });

  it("uses the real line holders by default", () => {
    const stop = keepSynced([T], { api: fakeApi().api, line: () => null });
    expect(lines.retainLine).toHaveBeenCalledWith("w1");
    expect(lines.onLineFlips).toHaveBeenCalled();
    stop();
  });
});
