// This Mac's end of a synced folder (lib/mac-tree-sync.ts): open signs through main, opened starts the peer and its
// watcher, in/out move texts between the board window and the peer, close stops it all.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PeerDeps, SyncStatus } from "./tree-sync-peer";

const real = vi.hoisted(() => ({
  shell: vi.fn<(route: string, body: Record<string, unknown>) => Promise<Record<string, unknown>>>(() => Promise.resolve({ key: "k" })),
  macTwin: vi.fn<(p: string) => string | null>(() => "/dev/weft"),
  deviceId: vi.fn(() => "dev-1"),
  folderPrio: vi.fn((_dir: string, busy: () => string[]) => busy().length),
  busyCards: vi.fn(() => ["c1", "c2"]),
  getCard: vi.fn((id: string) => (id === "c1" ? { cwd: "/dev/weft" } : undefined)),
  execFileSync: vi.fn<(...a: unknown[]) => string>(() => ".git\n"),
  peerDeps: [] as unknown[],
}));
vi.mock("./browser-shell", () => ({ shell: real.shell }));
vi.mock("./worker-twin-mac", () => ({ macTwin: real.macTwin }));
vi.mock("./device-id", () => ({ deviceId: real.deviceId }));
vi.mock("./worker-tree-sync", () => ({ folderPrio: real.folderPrio }));
vi.mock("./runner-state", () => ({ busyCards: real.busyCards }));
vi.mock("./store", () => ({ getCard: real.getCard }));
vi.mock("./tree-sync-fs", () => ({ treeFs: (dir: string) => ({ dir }) }));
vi.mock("node:child_process", () => ({ execFileSync: real.execFileSync }));
vi.mock("./tree-sync-peer", () => ({
  createPeer: (deps: unknown) => {
    real.peerDeps.push(deps);
    return { start: async () => {}, receive: () => {}, touched: async () => {}, stop: () => {} };
  },
}));
vi.mock("./tree-sync-watch", () => ({ watchFolder: () => () => {} }));

const { createMacSync, macSync, POLL_MS, LEAD_PRIO, LEAD_MS } = await import("./mac-tree-sync");

const T = { workerId: "AB-CD", folder: "weft", workerName: "Mini" };

function fakePeer() {
  let deps: PeerDeps | null = null;
  const spies = { start: vi.fn(async () => {}), receive: vi.fn(), touched: vi.fn(async () => {}), stop: vi.fn() };
  const factory = vi.fn((d: PeerDeps) => {
    deps = d;
    return spies as never;
  });
  return { factory, spies, deps: () => deps as unknown as PeerDeps };
}

function make(twin: string | null = "/dev/weft", now?: () => number) {
  const peer = fakePeer();
  const unwatch = vi.fn();
  let onPaths: ((p: string[]) => void) | null = null;
  const watch = vi.fn((_dir: string, fn: (p: string[]) => void) => {
    onPaths = fn;
    return unwatch;
  });
  const shell = vi.fn(() => Promise.resolve({ key: "k", sig: "s", issuedAt: 1, nonce: "n" }));
  const sync = createMacSync({
    shell,
    twin: () => twin,
    self: () => ({ id: "mac-1", label: "Mac" }),
    prio: () => 7,
    ...(now ? { now } : {}),
    watch: watch as never,
    peer: peer.factory,
    gitDir: (dir) => `${dir}/.git`,
  });
  return { sync, peer, unwatch, watch, shell, paths: (p: string[]) => onPaths?.(p) };
}

beforeEach(() => vi.clearAllMocks());

describe("open", () => {
  it("refuses a folder this Mac has no checkout of", async () => {
    const { sync, shell } = make(null);
    await expect(sync.open(T)).rejects.toThrow("no checkout of weft");
    expect(shell).not.toHaveBeenCalled();
  });

  it("answers the channel's first text, with main's signature", async () => {
    const { sync, shell } = make();
    const text = await sync.open(T);
    expect(shell).toHaveBeenCalledWith("/tree-sync/sign", { workerId: "AB-CD", folder: "weft" });
    expect(JSON.parse(text)).toEqual({ t: "open", folder: "weft", mac: { key: "k", sig: "s", issuedAt: 1, nonce: "n" } });
  });
});

describe("opened", () => {
  it("refuses a folder this Mac has no checkout of", async () => {
    await expect(make(null).sync.opened(T)).rejects.toThrow("no checkout");
  });

  it("starts the peer on the twin, and the watcher touches it", async () => {
    const m = make();
    await m.sync.opened(T);
    expect(m.peer.spies.start).toHaveBeenCalled();
    const d = m.peer.deps();
    expect(d.self).toEqual({ id: "mac-1", label: "Mac" });
    expect(d.other).toEqual({ id: "ab-cd", label: "Mini" });
    expect(d.gitDir).toBe("/dev/weft/.git");
    expect(d.prio()).toBe(7);
    expect(m.watch).toHaveBeenCalledWith("/dev/weft", expect.any(Function));
    m.paths(["a.ts"]);
    expect(m.peer.spies.touched).toHaveBeenCalledWith(["a.ts"]);
    expect(m.sync.count()).toBe(1);
  });

  it("names the worker for you when it has no name", async () => {
    const m = make();
    await m.sync.opened({ workerId: "w", folder: "weft" });
    expect(m.peer.deps().other.label).toBe("your worker");
  });

  it("closes the session before a second opened", async () => {
    const m = make();
    await m.sync.opened(T);
    await m.sync.opened(T);
    expect(m.unwatch).toHaveBeenCalledTimes(1);
    expect(m.peer.spies.stop).toHaveBeenCalledTimes(1);
    expect(m.peer.factory).toHaveBeenCalledTimes(2);
    expect(m.sync.count()).toBe(1);
  });
});

describe("receive", () => {
  it("throws when the folder isn't syncing", () => {
    expect(() => make().sync.receive(T, ["x"])).toThrow("isn't syncing");
  });

  it("hands each text to the peer, under any case of the worker id", async () => {
    const m = make();
    await m.sync.opened(T);
    m.sync.receive({ ...T, workerId: "ab-cd" }, ["a", "b"]);
    expect(m.peer.spies.receive.mock.calls).toEqual([["a"], ["b"]]);
  });
});

describe("out", () => {
  it("is empty with no session", async () => {
    expect(await make().sync.out(T, 1)).toEqual({ texts: [], status: null });
  });

  it("answers held texts at once, with the status", async () => {
    const m = make();
    await m.sync.opened(T);
    m.peer.deps().send("one");
    m.peer.deps().send("two");
    expect(await m.sync.out(T)).toEqual({ texts: ["one", "two"], status: { kind: "connecting" } });
  });

  it("waits, and a send wakes it", async () => {
    const m = make();
    await m.sync.opened(T);
    const poll = m.sync.out(T, 60_000);
    m.peer.deps().send("late");
    expect((await poll).texts).toEqual(["late"]);
  });

  it("answers empty after the wait", async () => {
    const m = make();
    await m.sync.opened(T);
    expect(await m.sync.out(T, 5)).toEqual({ texts: [], status: { kind: "connecting" } });
    expect(POLL_MS).toBe(15_000);
  });

  it("drops a session whose window stopped polling", async () => {
    const m = make();
    await m.sync.opened(T);
    for (let i = 0; i < 4_000; i++) m.peer.deps().send(`t${i}`);
    expect(m.sync.count()).toBe(1);
    m.peer.deps().send("one too many");
    expect(m.sync.count()).toBe(0);
    expect(m.peer.spies.stop).toHaveBeenCalled();
  });
});

describe("close and status", () => {
  it("is null before anything, follows the peer, and says paused after close", async () => {
    const m = make();
    expect(m.sync.status(T)).toBeNull();
    await m.sync.opened(T);
    const synced: SyncStatus = { kind: "synced", at: 1, sent: 2, took: 3, copies: [] };
    m.peer.deps().onStatus?.(synced);
    expect(m.sync.status(T)).toEqual(synced);
    expect((await m.sync.out(T, 1)).status).toEqual(synced);
    m.sync.close(T);
    m.sync.close(T);
    expect(m.unwatch).toHaveBeenCalledTimes(1);
    expect(m.sync.status(T)).toEqual({ kind: "paused", reason: "Not connected to the worker right now." });
    expect(m.sync.count()).toBe(0);
  });

  it("wakes a waiting poll on close", async () => {
    const m = make();
    await m.sync.opened(T);
    const poll = m.sync.out(T, 60_000);
    m.sync.close(T);
    expect((await poll).texts).toEqual([]);
  });
});

describe("macSync", () => {
  it("is one manager on the real main, twins, device and folders", async () => {
    const sync = macSync();
    expect(macSync()).toBe(sync);
    await sync.open(T);
    expect(real.macTwin).toHaveBeenCalledWith("worker://AB-CD/weft");
    expect(real.shell).toHaveBeenCalledWith("/tree-sync/sign", { workerId: "AB-CD", folder: "weft" });
    await sync.opened(T);
    const d = real.peerDeps.at(-1) as PeerDeps;
    expect(d.self).toEqual({ id: "dev-1", label: "Mac" });
    expect(d.gitDir).toBe("/dev/weft/.git");
    expect(d.prio()).toBe(1);
    real.execFileSync.mockImplementationOnce(() => {
      throw new Error("not a repo");
    });
    await sync.opened(T);
    expect((real.peerDeps.at(-1) as PeerDeps).gitDir).toBe("/dev/weft/.git");
    sync.close(T);
  });
});

describe("lead", () => {
  it("wins every clash of the next catch-up, then counts as usual", async () => {
    let t = 1_000;
    const m = make("/dev/weft", () => t);
    m.sync.lead(T);
    await m.sync.opened(T);
    expect(m.peer.deps().prio()).toBe(LEAD_PRIO);
    m.peer.deps().onStatus?.({ kind: "connecting" });
    expect(m.peer.deps().prio()).toBe(LEAD_PRIO);
    m.peer.deps().onStatus?.({ kind: "synced", at: t, sent: 0, took: 0, copies: [] });
    expect(m.peer.deps().prio()).toBe(7);
    m.sync.lead(T);
    t += LEAD_MS + 1;
    expect(m.peer.deps().prio()).toBe(7);
  });
});
