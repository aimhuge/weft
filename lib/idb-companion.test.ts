import { EventEmitter } from "node:events";
import fs from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { idbFor } from "./idb-session";

const spawned = vi.hoisted((): { child: unknown; args: unknown[]; onSpawn: null | ((args: string[]) => void) } => ({ child: null, args: [], onSpawn: null }));
const bin = vi.hoisted((): { path: string | null } => ({ path: "/opt/idb_companion" }));
vi.mock("node:child_process", () => ({
  spawn: (file: string, args: string[], opts: unknown) => {
    spawned.args = [file, args, opts];
    spawned.onSpawn?.(args);
    return spawned.child;
  },
}));
vi.mock("./simulator-exec", () => ({ findBin: () => bin.path, TOOLS_DIR: "/t" }));

const { companionBin, evenScale, openIdb, screenPoints, sessionOver } = await import("./idb-companion");
type IdbClient = import("./idb-companion").IdbClient;

const SIZE = { target_description: { screen_dimensions: { width: 1206, height: 2622, density: 3 } } };

function fakeClient(over: Partial<IdbClient> = {}) {
  const writes: unknown[] = [];
  const video = Object.assign(new EventEmitter(), { write: vi.fn(), end: vi.fn(), cancel: vi.fn() });
  const client = {
    describe: (_req: object, done: (err: Error | null, res?: typeof SIZE) => void) => done(null, SIZE),
    hid: (done: (err: Error | null) => void) => ({ write: (e: unknown) => writes.push(e), end: () => done(null) }),
    video_stream: () => video,
    close: vi.fn(),
    ...over,
  } satisfies Record<string, unknown> as unknown as IdbClient;
  return { client, writes, video };
}

const child = () => Object.assign(new EventEmitter(), { exitCode: null as number | null, kill: vi.fn() });
const makeSocket = (args: string[]) => fs.writeFileSync(String(args[args.indexOf("--grpc-domain-sock") + 1]), "");
const noWait = () => Promise.resolve();

beforeEach(() => {
  bin.path = "/opt/idb_companion";
  spawned.child = child();
  spawned.onSpawn = makeSocket;
});

describe("screenPoints", () => {
  it("turns pixels into points", () => {
    expect(screenPoints(SIZE)).toEqual({ width: 402, height: 874 });
  });

  it("refuses a screen with no size", () => {
    expect(() => screenPoints({})).toThrow("size");
    expect(() => screenPoints(undefined)).toThrow("size");
  });
});

describe("companionBin", () => {
  it("is what findBin found", () => {
    expect(companionBin()).toBe("/opt/idb_companion");
  });
});

describe("sessionOver", () => {
  it("taps as a press and a release at the point, and swipes in seconds", async () => {
    const { client, writes } = fakeClient();
    const s = sessionOver(client, { width: 1, height: 1 }, vi.fn());
    await s.tap(10, 20);
    await s.swipe({ x: 1, y: 2 }, { x: 3, y: 4 }, 500);
    expect(writes).toEqual([
      { press: { action: { touch: { point: { x: 10, y: 20 } } }, direction: "DOWN" } },
      { press: { action: { touch: { point: { x: 10, y: 20 } } }, direction: "UP" } },
      { swipe: { start: { x: 1, y: 2 }, end: { x: 3, y: 4 }, duration: 0.5, delta: 0 } },
    ]);
  });

  it("rejects a tap the companion refused", async () => {
    const { client } = fakeClient({ hid: (done) => ({ write: vi.fn(), end: () => done(new Error("gone")) }) });
    await expect(sessionOver(client, { width: 1, height: 1 }, vi.fn()).tap(1, 1)).rejects.toThrow("gone");
  });

  it("streams H.264, skips log lines, and reports its end once", () => {
    const { client, video } = fakeClient();
    const frames: Buffer[] = [];
    const ended = vi.fn();
    sessionOver(client, { width: 1, height: 1 }, vi.fn()).video((f) => frames.push(f), ended);
    expect(video.write).toHaveBeenCalledWith({ start: expect.objectContaining({ format: "H264" }) as unknown });
    video.emit("data", { log_output: Buffer.from("hi") });
    video.emit("data", { payload: { data: Buffer.alloc(0) } });
    video.emit("data", { payload: { data: Buffer.from([1]) } });
    expect(frames).toHaveLength(1);
    video.emit("error", new Error("x"));
    video.emit("end");
    expect(ended).toHaveBeenCalledTimes(1);
  });

  it("encodes at the quality the board picked, on even sides", () => {
    const { client, video } = fakeClient();
    const session = sessionOver(client, { width: 1, height: 1 }, vi.fn(), { width: 1179, height: 2556 });
    session.video(vi.fn(), vi.fn(), "high");
    expect(video.write).toHaveBeenLastCalledWith({ start: expect.objectContaining({ fps: 60, avg_bitrate: 20_000_000, scale_factor: expect.closeTo(8 / 9, 4) as unknown }) as unknown });
    session.video(vi.fn(), vi.fn(), "low");
    expect(video.write).toHaveBeenLastCalledWith({ start: expect.objectContaining({ fps: 15, avg_bitrate: 2_000_000 }) as unknown });
    session.video(vi.fn(), vi.fn());
    expect(video.write).toHaveBeenLastCalledWith({ start: expect.objectContaining({ fps: 30 }) as unknown });
  });

  it("doesn't report an end the caller asked for", () => {
    const { client, video } = fakeClient();
    const ended = vi.fn();
    sessionOver(client, { width: 1, height: 1 }, vi.fn()).video(vi.fn(), ended)();
    expect(video.cancel).toHaveBeenCalled();
    video.emit("end");
    expect(ended).not.toHaveBeenCalled();
  });
});

describe("openIdb", () => {
  it("is null with no companion installed, so the watch stays on JPEGs", async () => {
    bin.path = null;
    await expect(openIdb("u")).resolves.toBeNull();
  });

  it("listens on a private socket and never a port, and registers the session", async () => {
    const { client } = fakeClient();
    const session = await openIdb("u1", () => Promise.resolve(client), noWait);
    const [file, args, opts] = spawned.args as [string, string[], { cwd: string }];
    expect(file).toBe("/opt/idb_companion");
    expect(args).toContain("--grpc-domain-sock");
    expect(args).not.toContain("--grpc-port");
    expect(opts.cwd).toBe("/opt");
    const socket = String(args[args.indexOf("--grpc-domain-sock") + 1]);
    expect(fs.statSync(socket.replace(/\/[^/]+$/, "")).mode & 0o077).toBe(0);
    expect(session?.size).toEqual({ width: 402, height: 874 });
    expect(idbFor("u1")).toBe(session);
    session?.close();
    expect(idbFor("u1")).toBeUndefined();
    expect(fs.existsSync(socket)).toBe(false);
    expect((spawned.child as { kill: () => void }).kill).toHaveBeenCalled();
  });

  it("forgets a session whose companion died", async () => {
    const { client } = fakeClient();
    await openIdb("u2", () => Promise.resolve(client), noWait);
    (spawned.child as EventEmitter).emit("exit");
    expect(idbFor("u2")).toBeUndefined();
  });

  it("cleans up when the companion won't describe the device", async () => {
    const { client } = fakeClient({ describe: (_, done) => done(new Error("no sim")) });
    await expect(openIdb("u3", () => Promise.resolve(client), noWait)).rejects.toThrow("no sim");
    expect((spawned.child as { kill: () => void }).kill).toHaveBeenCalled();
    expect(idbFor("u3")).toBeUndefined();
  });

  it("gives up when the companion exits, or never opens its socket", async () => {
    spawned.onSpawn = null;
    (spawned.child as { exitCode: number }).exitCode = 3;
    await expect(openIdb("u4", undefined, noWait)).rejects.toThrow("exited with 3");
    spawned.child = child();
    await expect(openIdb("u5", undefined, noWait)).rejects.toThrow("didn't start");
  });
});

describe("the live gesture and keyboard", () => {
  it("holds one stream from press to release, and presses keys by usage", () => {
    const { client, writes } = fakeClient();
    const close = vi.fn();
    const s = sessionOver(client, { width: 1, height: 1 }, close);
    s.touch("move", 9, 9);
    expect(writes).toEqual([]);
    s.touch("down", 1, 2);
    s.touch("move", 3, 4);
    s.touch("up", 3, 4);
    s.touch("move", 9, 9);
    s.key(4, true);
    expect(writes).toEqual([
      { press: { action: { touch: { point: { x: 1, y: 2 } } }, direction: "DOWN" } },
      { press: { action: { touch: { point: { x: 3, y: 4 } } }, direction: "DOWN" } },
      { press: { action: { touch: { point: { x: 3, y: 4 } } }, direction: "UP" } },
      { press: { action: { key: { keycode: 4 } }, direction: "DOWN" } },
    ]);
    s.close();
    expect(close).toHaveBeenCalled();
  });
});

describe("evenScale", () => {
  const sides = (w: number, h: number) => [Math.round(w * evenScale(w, h)), Math.round(h * evenScale(w, h))];

  it("lands on even sides near half, for the screens an odd scale silently breaks", () => {
    for (const [w, h] of [[1179, 2556], [1206, 2622], [1320, 2868], [1290, 2796]] as const) {
      const [x = 1, y = 1] = sides(w, h);
      expect(x % 2).toBe(0);
      expect(y % 2).toBe(0);
    }
    expect(evenScale(1320, 2868)).toBeCloseTo(0.5, 4);
    expect(evenScale(1179, 2556)).toBeCloseTo(4 / 9, 4);
  });

  it("never goes past full size, which an odd side can't take", () => {
    expect(evenScale(1179, 2556, 1)).toBeCloseTo(8 / 9, 4);
    expect(evenScale(1320, 2868, 1)).toBeCloseTo(1, 4);
  });
});
