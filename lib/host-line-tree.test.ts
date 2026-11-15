// The `tree` channel on a worker's session line (lib/host-line-tree.ts): it opens only on a signed open, then hands
// every message to a sync peer fed by a watcher, until the channel closes.
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { macIdOf, treeChannel, type TreeDeps } from "./host-line-tree";
import type { PeerDeps } from "./tree-sync-peer";

const NONCE = "0123456789abcdef0123456789abcdef";
const OPEN = { t: "open", folder: "my-app", mac: { key: "a2V5", sig: "c2ln", issuedAt: 1, nonce: NONCE } };

function fakeChannel() {
  const onMsg: ((raw: string | Buffer) => void)[] = [];
  const onState: ((s: string) => void)[] = [];
  const channel = {
    label: "tree",
    bufferedAmount: 0,
    send: vi.fn(),
    onMessage: { subscribe: (fn: (raw: string | Buffer) => void) => void onMsg.push(fn) },
    stateChanged: { subscribe: (fn: (s: string) => void) => void onState.push(fn) },
    close: vi.fn(),
  };
  return { channel, message: (raw: string | Buffer) => onMsg.forEach((f) => f(raw)), state: (s: string) => onState.forEach((f) => f(s)) };
}

function setup(over: { allow?: () => Promise<{ dir: string; gitDir: string }> } = {}) {
  const peer = { start: vi.fn(() => Promise.resolve()), receive: vi.fn(), touched: vi.fn(() => Promise.resolve()), stop: vi.fn() };
  let peerDeps: PeerDeps | undefined;
  let onPaths: ((paths: string[]) => void) | undefined;
  const unwatch = vi.fn();
  const spies = {
    allow: over.allow ?? vi.fn(() => Promise.resolve({ dir: "/work/my-app", gitDir: "/work/my-app/.git" })),
    prio: vi.fn(() => 2),
    watch: vi.fn((_dir: string, fn: (paths: string[]) => void) => {
      onPaths = fn;
      return unwatch;
    }),
    peer: vi.fn((d: PeerDeps) => {
      peerDeps = d;
      return peer;
    }),
  };
  const deps = { ...spies, self: { id: "w1", label: "Box" } } as unknown as TreeDeps;
  const ch = fakeChannel();
  const log = vi.fn();
  const stop = treeChannel(ch.channel as never, deps, log);
  return { ...ch, spies, peer, log, stop, unwatch, peerDeps: () => peerDeps!, onPaths: () => onPaths! };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const sent = (send: ReturnType<typeof vi.fn>): unknown[] => send.mock.calls.map((c): unknown => JSON.parse(c[0] as string));

describe("macIdOf", () => {
  it("is a stable, prefixed hash of the key", () => {
    const want = `mac-${createHash("sha256").update("k").digest("hex").slice(0, 16)}`;
    expect(macIdOf("k")).toBe(want);
    expect(macIdOf("k")).toBe(macIdOf("k"));
    expect(macIdOf("other")).not.toBe(want);
    expect(macIdOf("k")).toMatch(/^mac-[0-9a-f]{16}$/);
  });
});

describe("treeChannel", () => {
  it("refuses a first message that isn't an open, and closes", () => {
    const t = setup();
    t.message("hello");
    expect(sent(t.channel.send)).toEqual([{ t: "refused", message: "A synced folder opens with your Mac's signed request." }]);
    expect(t.channel.close).toHaveBeenCalled();
    expect(t.spies.allow).not.toHaveBeenCalled();
    t.message(JSON.stringify(OPEN));
    expect(t.spies.allow).not.toHaveBeenCalled();
  });

  it("refuses when allow() rejects, clipping the message", async () => {
    const t = setup({ allow: vi.fn(() => Promise.reject(new Error("x".repeat(400)))) });
    t.message(JSON.stringify(OPEN));
    await flush();
    expect(sent(t.channel.send)).toEqual([{ t: "refused", message: "x".repeat(300) }]);
    expect(t.channel.close).toHaveBeenCalled();
    expect(t.spies.peer).not.toHaveBeenCalled();
  });

  it("refuses on a channel without close()", () => {
    const t = fakeChannel();
    const bare = { ...t.channel, close: undefined };
    treeChannel(bare as never, { allow: vi.fn(), self: { id: "w", label: "W" }, prio: () => 1, watch: () => () => {} });
    t.message("nope");
    expect(t.channel.send).toHaveBeenCalledTimes(1);
  });

  it("opens: replies opened, starts the peer, feeds it the watcher and later messages", async () => {
    const t = setup();
    t.message(Buffer.from(JSON.stringify(OPEN)));
    await flush();
    expect(t.spies.allow).toHaveBeenCalledWith(OPEN);
    expect(sent(t.channel.send)).toEqual([{ t: "opened" }]);
    expect(t.peer.start).toHaveBeenCalled();
    const d = t.peerDeps();
    expect(d.self).toEqual({ id: "w1", label: "Box" });
    expect(d.other).toEqual({ id: macIdOf(OPEN.mac.key), label: "your Mac" });
    expect(d.gitDir).toBe("/work/my-app/.git");
    expect(d.prio()).toBe(2);
    expect(t.spies.prio).toHaveBeenCalledWith("/work/my-app");
    d.send("frame");
    expect(t.channel.send).toHaveBeenLastCalledWith("frame");
    expect(t.spies.watch).toHaveBeenCalledWith("/work/my-app", expect.any(Function));
    t.onPaths()(["a.ts"]);
    expect(t.peer.touched).toHaveBeenCalledWith(["a.ts"]);
    expect(t.log).toHaveBeenCalledWith("Weft Worker: syncing my-app over a line");
    t.message("data");
    expect(t.peer.receive).toHaveBeenCalledWith("data");
  });

  it("logs a paused status only", async () => {
    const t = setup();
    t.message(JSON.stringify(OPEN));
    await flush();
    const { onStatus } = t.peerDeps();
    if (!onStatus) throw new Error("no onStatus");
    onStatus({ kind: "connecting" });
    onStatus({ kind: "synced", at: 1, sent: 0, took: 0, copies: [] });
    expect(t.log).not.toHaveBeenCalledWith(expect.stringContaining("paused"));
    onStatus({ kind: "paused", reason: "branch differs" });
    expect(t.log).toHaveBeenCalledWith("Weft Worker: sync of my-app paused: branch differs");
  });

  it("stops the peer and the watcher when the channel closes", async () => {
    const t = setup();
    t.message(JSON.stringify(OPEN));
    await flush();
    t.state("open");
    expect(t.peer.stop).not.toHaveBeenCalled();
    t.state("closed");
    expect(t.peer.stop).toHaveBeenCalled();
    expect(t.unwatch).toHaveBeenCalled();
    t.message("data");
    expect(t.peer.receive).not.toHaveBeenCalled();
  });

  it("the returned stop does the same", async () => {
    const t = setup();
    t.message(JSON.stringify(OPEN));
    await flush();
    t.stop();
    expect(t.peer.stop).toHaveBeenCalled();
    expect(t.unwatch).toHaveBeenCalled();
  });

  it("doesn't start a peer when the channel closes while allow() is pending", async () => {
    let resolve!: (v: { dir: string; gitDir: string }) => void;
    const t = setup({ allow: vi.fn(() => new Promise<{ dir: string; gitDir: string }>((r) => (resolve = r))) });
    t.message(JSON.stringify(OPEN));
    t.state("closed");
    resolve({ dir: "/d", gitDir: "/d/.git" });
    await flush();
    expect(t.spies.peer).not.toHaveBeenCalled();
    expect(t.channel.send).not.toHaveBeenCalled();
  });

  it("ignores messages while opening", async () => {
    let resolve!: (v: { dir: string; gitDir: string }) => void;
    const t = setup({ allow: vi.fn(() => new Promise<{ dir: string; gitDir: string }>((r) => (resolve = r))) });
    t.message(JSON.stringify(OPEN));
    t.message(JSON.stringify(OPEN));
    t.message("junk");
    expect(t.spies.allow).toHaveBeenCalledTimes(1);
    expect(t.channel.send).not.toHaveBeenCalled();
    resolve({ dir: "/d", gitDir: "/d/.git" });
    await flush();
    expect(sent(t.channel.send)).toEqual([{ t: "opened" }]);
  });

  it("refuses when the peer fails to start", async () => {
    const t = setup();
    t.peer.start.mockRejectedValueOnce(new Error("no git"));
    t.message(JSON.stringify(OPEN));
    await flush();
    expect(sent(t.channel.send)).toEqual([{ t: "opened" }, { t: "refused", message: "no git" }]);
    expect(t.peer.stop).toHaveBeenCalled();
    expect(t.channel.close).toHaveBeenCalled();
  });

  it("uses the real createPeer when none is injected", async () => {
    vi.resetModules();
    const createPeer = vi.fn(() => ({ start: () => Promise.resolve(), receive: vi.fn(), touched: vi.fn(), stop: vi.fn() }));
    vi.doMock("./tree-sync-peer", () => ({ createPeer }));
    const mod = await import("./host-line-tree");
    const ch = fakeChannel();
    mod.treeChannel(ch.channel as never, { allow: () => Promise.resolve({ dir: "/d", gitDir: "/d/.git" }), self: { id: "w", label: "W" }, prio: () => 1, watch: () => () => {} });
    ch.message(JSON.stringify(OPEN));
    await flush();
    expect(createPeer).toHaveBeenCalled();
    vi.doUnmock("./tree-sync-peer");
  });
});
