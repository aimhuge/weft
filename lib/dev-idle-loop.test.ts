import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The idle check's tick runs on injected Deps (fake netstat text, ps rows, lsof output), so nothing here reads the
// machine; liveDeps' own commands go through a mocked execFile.

const execFile = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execFile }));

const runs = vi.hoisted(() => new Map<string, unknown>());
const idleStop = vi.hoisted(() => vi.fn());
vi.mock("./devserver", () => ({ runs, idleStop }));

const busyCards = vi.hoisted(() => vi.fn(() => [] as string[]));
vi.mock("./runner-state", () => ({ busyCards }));
const terminate = vi.hoisted(() => vi.fn());
vi.mock("./services-kill", () => ({ terminate }));
const readProcs = vi.hoisted(() => vi.fn());
vi.mock("./services-snapshot", () => ({ readProcs }));
const getCard = vi.hoisted(() => vi.fn());
const listCards = vi.hoisted(() => vi.fn(() => [{ id: "x" }]));
vi.mock("./store", () => ({ getCard, listCards }));
const workingFolders = vi.hoisted(() => vi.fn(() => ["/repo"]));
vi.mock("./dev-launchers", () => ({ workingFolders }));
const weftProcess = vi.hoisted(() => vi.fn(() => ({ pids: [1], dir: "/weft", port: "3000" })));
vi.mock("./restart-guard", () => ({ weftProcess }));

const { GRACE_MS, IDLE_MS } = await import("./dev-idle");
const { idleState, keep } = await import("./dev-idle-state");
const loop = await import("./dev-idle-loop");
type Deps = import("./dev-idle-loop").Deps;
type P = { pid: number; ppid: number; pgid: number; command: string };

const row = (local: string, foreign: string, state: string, proc: string) =>
  `tcp4       0      0  ${local}  ${foreign}  ${state}         7072     74341581  405248 4194304             ${proc}    00102 00000104 0000000009995b86 00000081 01000800      2      0 000000`;
const listen = (port: number, pid: number) => row(`*.${port}`, "*.*", "LISTEN", `node:${pid}`);
// A browser (pid 900) connected to port on pid: both ends of the localhost connection.
const visit = (port: number, pid: number, from = 900) =>
  [row(`127.0.0.1.${port}`, "127.0.0.1.60001", "ESTABLISHED", `node:${pid}`), row("127.0.0.1.60001", `127.0.0.1.${port}`, "ESTABLISHED", `browser:${from}`)].join("\n");

// A tracked run: its shell 500 leads group 500, `next dev` 501 listens on 4002.
const TRACKED: P[] = [
  { pid: 500, ppid: 1, pgid: 500, command: "pnpm dev" },
  { pid: 501, ppid: 500, pgid: 500, command: "node /repo/node_modules/.bin/next dev" },
];
// An untracked server from a terminal: -zsh 10 → pnpm dev 11 → next dev 12, listening on 3001 in /repo/app.
const UNTRACKED: P[] = [
  { pid: 10, ppid: 1, pgid: 10, command: "-zsh" },
  { pid: 11, ppid: 10, pgid: 11, command: "pnpm dev" },
  { pid: 12, ppid: 11, pgid: 11, command: "node /x/node_modules/.bin/next dev" },
];

function deps(over: Partial<Deps> & { net?: string; ps?: P[]; lsof?: string } = {}): Deps & { [K in "cwds" | "idleStop" | "terminate" | "procs"]: ReturnType<typeof vi.fn> } {
  const { net = listen(4002, 501), ps = TRACKED, lsof = "", ...rest } = over;
  return {
    netstat: vi.fn(() => Promise.resolve(net)),
    procs: vi.fn(() => Promise.resolve(ps)),
    cwds: vi.fn(() => Promise.resolve(lsof)),
    folders: () => ["/repo"],
    busy: () => [],
    cardCwd: () => undefined,
    idleStop: vi.fn(),
    terminate: vi.fn(),
    weft: { pids: [1], dir: "/weft", port: "3000" },
    ...rest,
  } as never;
}

const T0 = 1_000_000;

beforeEach(() => {
  runs.clear();
  idleState.activeAt = new Map();
  idleState.pending = new Map();
  idleState.kept = new Set();
  idleState.untracked = [];
  idleState.cwds = new Map();
  execFile.mockReset();
  readProcs.mockReset();
});

describe("parseCwds", () => {
  it("reads lsof -Fpn into pid → cwd, skipping lines before a pid and other fields", () => {
    expect(loop.parseCwds("n/orphan\np12\nfcwd\nn/repo/app\np13\nn/other\n")).toEqual(
      new Map([
        [12, "/repo/app"],
        [13, "/other"],
      ]),
    );
  });
});

describe("tick", () => {
  it("does nothing when netstat reads no sockets, or fails", async () => {
    const empty = deps({ net: "" });
    await loop.tick(empty, T0);
    expect(empty.procs).not.toHaveBeenCalled();
    const failing = deps({ netstat: () => Promise.reject(new Error("nope")) });
    await loop.tick(failing, T0);
    expect(failing.procs).not.toHaveBeenCalled();
    expect(idleState.activeAt.size).toBe(0);
  });

  it("keeps a run with a visitor active, and stops it after IDLE_MS without one", async () => {
    runs.set("c1", { child: { pid: 500 }, cwd: "/repo", exited: false });
    const d = deps({ net: [listen(4002, 501), visit(4002, 501)].join("\n") });
    await loop.tick(d, T0);
    expect(idleState.activeAt.get("c1")).toBe(T0);
    const quiet = deps();
    await loop.tick(quiet, T0 + IDLE_MS - 1);
    expect(quiet.idleStop).not.toHaveBeenCalled();
    await loop.tick(quiet, T0 + IDLE_MS);
    expect(quiet.idleStop).toHaveBeenCalledWith("c1");
    // The run's own pids are tracked, never listed as untracked.
    expect(idleState.untracked).toEqual([]);
  });

  it("doesn't count Weft's own probe as a visitor", async () => {
    runs.set("c1", { child: { pid: 500 }, cwd: "/repo", exited: false });
    idleState.activeAt.set("c1", T0 - IDLE_MS);
    const d = deps({ net: [listen(4002, 501), visit(4002, 501, 1)].join("\n") });
    await loop.tick(d, T0);
    expect(d.idleStop).toHaveBeenCalledWith("c1");
  });

  it("keeps a run active while its card runs a turn", async () => {
    runs.set("c1", { child: { pid: 500 }, cwd: "/repo", exited: false });
    idleState.activeAt.set("c1", T0 - IDLE_MS);
    const d = deps({ busy: () => ["c1"] });
    await loop.tick(d, T0);
    expect(d.idleStop).not.toHaveBeenCalled();
    expect(idleState.activeAt.get("c1")).toBe(T0);
  });

  it("keeps a run active while a busy card works in or around its folder", async () => {
    runs.set("folder:/repo", { child: { pid: 500 }, cwd: "/repo", exited: false });
    for (const cwd of ["/repo/sub", "/", undefined]) {
      idleState.activeAt.set("folder:/repo", T0 - IDLE_MS);
      const d = deps({ busy: () => ["c2", "c3"], cardCwd: (id) => (id === "c2" ? cwd : "/elsewhere") });
      await loop.tick(d, T0);
      if (cwd) expect(d.idleStop, cwd).not.toHaveBeenCalled();
      else expect(d.idleStop).toHaveBeenCalledWith("folder:/repo");
    }
  });

  it("skips exited, idle-stopped and pid-less runs", async () => {
    runs.set("a", { child: { pid: 500 }, cwd: "/repo", exited: true });
    runs.set("b", { child: { pid: 500 }, cwd: "/repo", exited: false, idleStopped: true });
    runs.set("c", { child: {}, cwd: "/repo", exited: false });
    for (const k of ["a", "b", "c"]) idleState.activeAt.set(k, T0 - IDLE_MS);
    const d = deps();
    await loop.tick(d, T0);
    expect(d.idleStop).not.toHaveBeenCalled();
    expect(idleState.activeAt.size).toBe(0);
  });

  it("announces an idle untracked server in a board folder, then stops it after the grace", async () => {
    const d = deps({ net: listen(3001, 12), ps: UNTRACKED, lsof: "p12\nfcwd\nn/repo/app\n" });
    await loop.tick(d, T0);
    expect(idleState.untracked).toEqual([expect.objectContaining({ key: "untracked:11", root: 11, pids: [11, 12], ports: [3001], cwd: "/repo/app", command: "pnpm dev" })]);
    expect(idleState.pending.size).toBe(0);
    await loop.tick(d, T0 + IDLE_MS);
    expect(idleState.pending.get("untracked:11")).toEqual({ stopAt: T0 + IDLE_MS + GRACE_MS });
    expect(d.idleStop).not.toHaveBeenCalled();
    expect(d.terminate).not.toHaveBeenCalled();
    await loop.tick(d, T0 + IDLE_MS + GRACE_MS);
    expect(d.terminate).toHaveBeenCalledWith([11, 12]);
    expect(idleState.untracked).toEqual([]);
    expect(idleState.pending.size).toBe(0);
  });

  it("keeps an untracked server a visitor or a busy card in its folder is using", async () => {
    idleState.activeAt.set("untracked:11", T0 - IDLE_MS);
    const d = deps({ net: [listen(3001, 12), visit(3001, 12)].join("\n"), ps: UNTRACKED, lsof: "p12\nn/repo/app" });
    await loop.tick(d, T0);
    expect(idleState.activeAt.get("untracked:11")).toBe(T0);
    const busy = deps({ net: listen(3001, 12), ps: UNTRACKED, busy: () => ["c9"], cardCwd: () => "/repo" });
    await loop.tick(busy, T0 + IDLE_MS);
    expect(idleState.pending.size).toBe(0);
  });

  it("never stops a kept untracked server, and forgets the keep once it's gone", async () => {
    const d = deps({ net: listen(3001, 12), ps: UNTRACKED, lsof: "p12\nn/repo/app" });
    await loop.tick(d, T0);
    keep("untracked:11", T0 - IDLE_MS);
    idleState.activeAt.set("untracked:11", T0 - IDLE_MS);
    await loop.tick(d, T0 + GRACE_MS * 3);
    expect(idleState.pending.size).toBe(0);
    expect(d.terminate).not.toHaveBeenCalled();
    expect(idleState.kept).toEqual(new Set(["untracked:11"]));
    // Gone: something else still listens so the tick runs.
    await loop.tick(deps({ net: listen(4002, 501) }), T0 + GRACE_MS * 4);
    expect(idleState.kept.size).toBe(0);
  });

  it("looks up the cwd only of runtime-looking listeners, once, and forgets pids that are gone", async () => {
    const ps: P[] = [...UNTRACKED, { pid: 20, ppid: 1, pgid: 20, command: "/usr/sbin/sshd -D" }];
    const net = [listen(3001, 12), listen(22, 20), listen(5000, 77)].join("\n");
    const d = deps({ net, ps, lsof: "p12\nn/repo/app" });
    await loop.tick(d, T0);
    expect(d.cwds).toHaveBeenCalledTimes(1);
    expect(d.cwds).toHaveBeenCalledWith([12]);
    expect(idleState.cwds).toEqual(new Map([[12, "/repo/app"]]));
    await loop.tick(d, T0 + 1);
    expect(d.cwds).toHaveBeenCalledTimes(1);
    // 12 exits: its cached cwd goes.
    await loop.tick(deps({ net: listen(22, 20), ps: [ps[3] as P] }), T0 + 2);
    expect(idleState.cwds.size).toBe(0);
  });
});

describe("liveDeps", () => {
  type Cb = (err: unknown, out?: { stdout: string; stderr: string }) => void;

  it("runs netstat and lsof, keeping lsof's partial output when it exits non-zero", async () => {
    execFile.mockImplementation((bin: string, _a: string[], _o: unknown, cb: Cb) => {
      if (bin === "/usr/sbin/netstat") cb(null, { stdout: "NET", stderr: "" });
      else cb(Object.assign(new Error("exit 1"), { stdout: "p12\nn/repo" }));
    });
    const d = loop.liveDeps();
    expect(await d.netstat()).toBe("NET");
    expect(execFile).toHaveBeenCalledWith("/usr/sbin/netstat", ["-anv", "-p", "tcp"], { maxBuffer: 8 * 1024 * 1024 }, expect.any(Function));
    expect(await d.cwds([12, 13])).toBe("p12\nn/repo");
    expect(execFile).toHaveBeenCalledWith("/usr/sbin/lsof", ["-a", "-d", "cwd", "-Fpn", "-p", "12,13"], expect.anything(), expect.any(Function));
  });

  it("answers empty when a command fails with no output", async () => {
    execFile.mockImplementation((_b: string, _a: string[], _o: unknown, cb: Cb) => cb(new Error("ENOENT")));
    expect(await loop.liveDeps().netstat()).toBe("");
  });

  it("wires the board's folders, busy cards, card folders and stop functions", () => {
    getCard.mockImplementation((id: string) => (id === "c1" ? { cwd: "/repo" } : undefined));
    busyCards.mockReturnValue(["c1"]);
    const d = loop.liveDeps();
    expect(d.procs).toBe(readProcs);
    expect(d.folders()).toEqual(["/repo", process.cwd()]);
    expect(workingFolders).toHaveBeenCalledWith([{ id: "x" }]);
    expect(d.busy()).toEqual(["c1"]);
    expect(d.cardCwd("c1")).toBe("/repo");
    expect(d.cardCwd("nope")).toBeUndefined();
    expect(d.idleStop).toBe(idleStop);
    expect(d.terminate).toBe(terminate);
    expect(d.weft).toEqual({ pids: [1], dir: "/weft", port: "3000" });
  });
});

describe("startDevIdle", () => {
  afterEach(() => {
    loop.stopDevIdle();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("ticks on its interval once, logging a failed tick instead of throwing", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    execFile.mockImplementation((_b: string, _a: string[], _o: unknown, cb: (e: unknown, o: { stdout: string }) => void) => cb(null, { stdout: listen(4002, 501) }));
    readProcs.mockRejectedValue(new Error("ps died"));
    loop.startDevIdle(1000);
    loop.startDevIdle(1000);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(readProcs).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("Dev server idle check: ps died");
    loop.stopDevIdle();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("defaults to one tick a minute", () => {
    vi.useFakeTimers();
    loop.startDevIdle();
    expect(loop.TICK_MS).toBe(60_000);
    expect(vi.getTimerCount()).toBe(1);
  });
});
