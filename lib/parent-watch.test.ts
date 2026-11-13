import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isAlive, parentPid, TERM_GRACE_MS, watchParent, WATCH_MS } from "./parent-watch";

const ELECTRON = 500;
const envOf = (env: Record<string, string>) => env as NodeJS.ProcessEnv;

function fakeServer(env = envOf({ WEFT_PARENT_PID: String(ELECTRON) })) {
  const alive = new Set([ELECTRON]);
  const proc = Object.assign(new EventEmitter(), {
    pid: 4242,
    ppid: ELECTRON,
    env,
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    alive,
    kill: vi.fn((pid: number) => {
      if (!alive.has(pid)) throw Object.assign(new Error("ESRCH"), { code: "ESRCH" });
      return true;
    }),
    exit: vi.fn() as unknown as (code?: number) => never,
  });
  return proc;
}

describe("isAlive", () => {
  it("reads ESRCH as gone and EPERM as alive", () => {
    const kill = (code: string) => () => {
      throw Object.assign(new Error(code), { code });
    };
    expect(isAlive({ kill: kill("ESRCH") }, 1)).toBe(false);
    expect(isAlive({ kill: kill("EPERM") }, 1)).toBe(true);
    expect(isAlive({ kill: () => true }, 1)).toBe(true);
  });
});

describe("watchParent", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("does nothing for a server Electron didn't start", () => {
    expect(watchParent(fakeServer(envOf({})))).toBe(false);
    expect(watchParent(fakeServer(envOf({ WEFT_PARENT_PID: "1" })))).toBe(false);
    expect(watchParent(fakeServer(envOf({ WEFT_PARENT_PID: "nope" })))).toBe(false);
  });

  it("recognizes a server an older Weft.app started without WEFT_PARENT_PID", () => {
    const env = envOf({ ELECTRON_RUN_AS_NODE: "1", WEFT_PLUGIN_DIR: "/Applications/Weft.app/Contents/Resources/plugin" });
    expect(parentPid({ env, ppid: ELECTRON })).toBe(ELECTRON);
    expect(parentPid({ env: envOf({ ELECTRON_RUN_AS_NODE: "1" }), ppid: ELECTRON })).toBeNaN();
    const proc = fakeServer(env);
    expect(watchParent(proc, WATCH_MS, vi.fn())).toBe(true);
    proc.ppid = 1;
    vi.advanceTimersByTime(WATCH_MS);
    expect(proc.exit).toHaveBeenCalledWith(1);
  });

  it("watches once, and keeps the pid from its descendants", () => {
    const proc = fakeServer();
    expect(watchParent(proc, WATCH_MS, vi.fn())).toBe(true);
    expect(proc.env.WEFT_PARENT_PID).toBeUndefined();
    expect(watchParent(proc, WATCH_MS, vi.fn())).toBe(false);
  });

  it("stays up while Electron lives", () => {
    const proc = fakeServer();
    watchParent(proc, WATCH_MS, vi.fn());
    vi.advanceTimersByTime(WATCH_MS * 5);
    expect(proc.exit).not.toHaveBeenCalled();
  });

  it("ends the CLIs and itself once it's reparented to launchd", () => {
    const proc = fakeServer();
    const endGroups = vi.fn();
    watchParent(proc, WATCH_MS, endGroups);
    proc.ppid = 1;
    vi.advanceTimersByTime(WATCH_MS);
    expect(endGroups).toHaveBeenCalled();
    expect(proc.exit).toHaveBeenCalledWith(1);
  });

  it("ends when Electron is gone though the direct parent (next dev's launcher) lives", () => {
    const proc = fakeServer();
    proc.ppid = 777;
    watchParent(proc, WATCH_MS, vi.fn());
    proc.alive.delete(ELECTRON);
    vi.advanceTimersByTime(WATCH_MS);
    expect(proc.exit).toHaveBeenCalledWith(1);
  });

  it("ends on a broken log pipe instead of looping on uncaught EPIPEs", () => {
    const proc = fakeServer();
    watchParent(proc, WATCH_MS, vi.fn());
    proc.stderr.emit("error", Object.assign(new Error("write EPIPE"), { code: "EPIPE" }));
    expect(proc.exit).toHaveBeenCalledWith(1);
  });

  it("swallows other write errors while Electron lives", () => {
    const proc = fakeServer();
    watchParent(proc, WATCH_MS, vi.fn());
    expect(() => proc.stdout.emit("error", Object.assign(new Error("EAGAIN"), { code: "EAGAIN" }))).not.toThrow();
    expect(proc.exit).not.toHaveBeenCalled();
  });

  it("exits even if Next's SIGTERM cleanup never finishes", () => {
    const proc = fakeServer();
    const endGroups = vi.fn();
    watchParent(proc, 60 * WATCH_MS, endGroups);
    proc.emit("SIGTERM");
    vi.advanceTimersByTime(TERM_GRACE_MS - 1);
    expect(proc.exit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(endGroups).toHaveBeenCalled();
    expect(proc.exit).toHaveBeenCalledWith(143);
  });

  it("exits 130 after an unfinished SIGINT cleanup, and still exits if ending the CLIs throws", () => {
    const proc = fakeServer();
    watchParent(proc, 60 * WATCH_MS, () => {
      throw new Error("ps failed");
    });
    proc.emit("SIGINT");
    expect(() => vi.advanceTimersByTime(TERM_GRACE_MS)).toThrow("ps failed");
    expect(proc.exit).toHaveBeenCalledWith(130);
  });
});
