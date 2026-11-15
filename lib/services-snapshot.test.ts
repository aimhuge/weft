import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "./types";

const execFile = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execFile }));

const listDev = vi.hoisted(() => vi.fn());
vi.mock("./devserver-list", () => ({ listDev }));

const runs = vi.hoisted(() => new Map<string, unknown>());
vi.mock("./devserver", () => ({ runs }));

const sessions = vi.hoisted(() => new Map<string, unknown>());
const spares = vi.hoisted(() => new Map<string, unknown>());
vi.mock("./runner-state", () => ({ sessions, spares }));

const cards = vi.hoisted(() => new Map<string, Partial<Card>>());
const getCard = vi.hoisted(() => vi.fn((id: string) => cards.get(id)));
vi.mock("./store", () => ({ getCard }));

const footprints = vi.hoisted(() => vi.fn());
vi.mock("./dev-footprint", () => ({ footprints }));

const { idleState } = await import("./dev-idle-state");
const snap = await import("./services-snapshot");

type ExecCallback = (err: unknown, stdout: { stdout: string }, stderr: string) => void;

beforeEach(() => {
  execFile.mockReset();
  listDev.mockReset().mockResolvedValue([]);
  runs.clear();
  sessions.clear();
  spares.clear();
  cards.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("readProcs", () => {
  it("calls ps with the right args, parses stdout, and uses a 16MB buffer", async () => {
    execFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: ExecCallback) => {
      cb(null, { stdout: "  10  1 10  0.0  100  00:01  node" }, "");
    });
    const procs = await snap.readProcs();
    expect(execFile).toHaveBeenCalledWith(
      "/bin/ps",
      ["-axo", "pid=,ppid=,pgid=,%cpu=,rss=,etime=,command="],
      { maxBuffer: 16 * 1024 * 1024 },
      expect.any(Function),
    );
    expect(procs).toHaveLength(1);
    expect(procs[0]?.pid).toBe(10);
  });
});

describe("knownPids", () => {
  it("adds a session with its pid and by-session ids from sessionId and spec.sessionId", () => {
    sessions.set("c1", {
      process: { pid: 200 },
      sessionId: "sess-1",
      spec: { backend: "claude", cwd: "/repo", sessionId: "sess-spec" },
    });
    cards.set("c1", { id: "c1", title: "Fix the login page" });
    const { known, bySession } = snap.knownPids();
    expect(known.get(200)).toMatchObject({ kind: "cli", label: "Claude Code", cardId: "c1", cwd: "/repo", title: "Fix the login page" });
    expect(bySession.get("sess-1")?.cardId).toBe("c1");
    expect(bySession.get("sess-spec")?.cardId).toBe("c1");
  });

  it("marks a session without a card title", () => {
    sessions.set("c1", { process: { pid: 200 }, sessionId: "sess-1", spec: { backend: "claude", cwd: "/repo" } });
    cards.set("c1", { id: "c1" });
    expect(snap.knownPids().known.get(200)).not.toHaveProperty("title");
  });

  it("labels a spare as a warm spare and does not register session ids", () => {
    spares.set("sp1", { process: { pid: 201 }, spec: { backend: "puku", cwd: "/repo" } });
    const { known, bySession } = snap.knownPids();
    expect(known.get(201)).toMatchObject({ kind: "cli", label: "puku-cli", title: "Warm spare", cwd: "/repo" });
    expect([...bySession.keys()]).toEqual([]);
  });

  it("skips a session with no running process", () => {
    sessions.set("c1", { process: undefined, spec: { backend: "claude" } });
    expect(snap.knownPids().known.size).toBe(0);
  });

  it("adds a Weft dev server run that is still alive", () => {
    runs.set("c1", { child: { pid: 300 }, exited: false, command: "pnpm dev", cwd: "/repo", title: "Fix it", url: "http://localhost:4001" });
    const { known } = snap.knownPids();
    expect(known.get(300)).toMatchObject({ kind: "dev", label: "pnpm dev", cardId: "c1", cwd: "/repo", title: "Fix it", url: "http://localhost:4001" });
  });

  it("skips a dev run with no pid or that has exited", () => {
    runs.set("a", { child: {}, exited: false, command: "x" });
    runs.set("b", { child: { pid: 301 }, exited: true, command: "x" });
    expect(snap.knownPids().known.size).toBe(0);
  });

  it("omits title and url on a dev run without them", () => {
    runs.set("c1", { child: { pid: 300 }, exited: false, command: "pnpm dev", cwd: "/repo" });
    const known = snap.knownPids().known.get(300);
    expect(known).not.toHaveProperty("title");
    expect(known).not.toHaveProperty("url");
  });
});

describe("machineInfo", () => {
  it("gives this Mac's cores and RAM in KB", async () => {
    const os = await import("node:os");
    expect(snap.machineInfo()).toEqual({ cores: os.cpus().length, memKb: Math.round(os.totalmem() / 1024) });
  });
});

describe("listServices", () => {
  it("combines ps and dev list, marking thread dev servers as task and Weft runs as dev", async () => {
    execFile.mockImplementation((_c, _a, _o, cb: ExecCallback) => cb(null, { stdout: "  10  1 10  0.0  100  00:01  next-server" }, ""));
    listDev.mockResolvedValue([
      { cardId: "c1", command: "vite", cwd: "/repo", state: "running", startedAt: 50, source: "weft", url: "http://localhost:5173", title: "Fix" },
      { cardId: "c2", command: "next dev", cwd: "/repo2", state: "running", startedAt: 60, source: "thread", taskId: "t1", title: "Build" },
    ]);
    const all = await snap.listServices();
    const task = all.find((s) => s.kind === "task");
    const dev = all.find((s) => s.kind === "dev");
    expect(task).toMatchObject({ id: "task:c2:t1", kind: "task", cardId: "c2", taskId: "t1", cwd: "/repo2", title: "Build" });
    expect(task?.url).toBeUndefined();
    expect(dev).toMatchObject({ id: "dev:c1", kind: "dev", cardId: "c1", cwd: "/repo", url: "http://localhost:5173", title: "Fix" });
  });

  it("copies the probe's state into a live Weft run, including the 'starting' state", async () => {
    execFile.mockImplementation((_c, _a, _o, cb: ExecCallback) => cb(null, { stdout: "  10  1 10  0.0  100  00:01  next-server" }, ""));
    runs.set("c1", { child: { pid: 10 }, exited: false, command: "vite", cwd: "/repo" });
    listDev.mockResolvedValue([{ cardId: "c1", command: "vite", cwd: "/repo", state: "starting", startedAt: 50, source: "weft" }]);
    const all = await snap.listServices();
    const dev = all.find((s) => s.kind === "dev");
    expect(dev?.state).toBe("starting");
  });

  it("adds a non-live dev run as an extra so it can be restarted", async () => {
    execFile.mockImplementation((_c, _a, _o, cb: ExecCallback) => cb(null, { stdout: "  10  1 10  0.0  100  00:01  next-server" }, ""));
    listDev.mockResolvedValue([{ cardId: "c1", command: "vite", cwd: "/repo", state: "stopped", startedAt: 50, source: "weft", url: "http://localhost:5173", title: "Old" }]);
    const all = await snap.listServices();
    const dev = all.find((s) => s.kind === "dev" && s.id === "dev:c1");
    expect(dev).toMatchObject({ state: "stopped", cwd: "/repo", title: "Old", url: "http://localhost:5173" });
  });

  it("omits title and url when the dev entry has none", async () => {
    execFile.mockImplementation((_c, _a, _o, cb: ExecCallback) => cb(null, { stdout: "  10  1 10  0.0  100  00:01  next-server" }, ""));
    listDev.mockResolvedValue([{ cardId: "c1", command: "vite", cwd: "/repo", state: "running", startedAt: 50, source: "thread", taskId: "t1" }]);
    const all = await snap.listServices();
    const task = all.find((s) => s.kind === "task");
    expect(task).not.toHaveProperty("title");
    expect(task).not.toHaveProperty("url");
  });
});

describe("listServices: idle check and footprints", () => {
  // Weft's own server (this process) runs dev server 10, whose child 11 is a thread CLI; 40 is an untracked server.
  const self = process.pid;
  const PS = [`  ${self}  1 ${self}  0.0  10  00:10  node server.js`, `  10  ${self} 10  1.5  100  00:01  pnpm dev`, "  11 10 10  2.0  200  00:01  claude", "  40  1 40  0.5  300  01:00  pnpm dev", "  41 40 40  1.0  400  00:30  node next dev"].join("\n");
  const ps = (out = PS) => execFile.mockImplementation((_c, _a, _o, cb: ExecCallback) => cb(null, { stdout: out }, ""));
  const untracked = (over: Record<string, unknown> = {}) => ({ key: "untracked:40", root: 40, pids: [40, 41], ports: [3001], cwd: "/repo/app", command: "/usr/local/bin/pnpm dev", ...over });

  beforeEach(() => {
    idleState.activeAt = new Map();
    idleState.pending = new Map();
    idleState.untracked = [];
    footprints.mockReset().mockResolvedValue(new Map());
  });

  it("lists an untracked dev server with its processes, url and the time Weft will stop it", async () => {
    ps();
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    idleState.untracked = [untracked()];
    idleState.pending.set("untracked:40", { stopAt: 1_090_000 });
    idleState.activeAt.set("untracked:40", 5);
    const all = await snap.listServices();
    const row = all.find((s) => s.id === "untracked:40");
    expect(row).toMatchObject({ kind: "other", cwd: "/repo/app", url: "http://localhost:3001", state: "running", cpu: 1.5, memKb: 700, startedAt: 1_000_000 - 60_000, untracked: true, stopAt: 1_090_000, activeAt: 5 });
    expect(row?.procs.map((p) => p.pid)).toEqual([40, 41]);
    expect(footprints).not.toHaveBeenCalled();
  });

  it("leaves out url and stopAt when there's no port or pending stop, and starts now when its root is gone", () => {
    idleState.untracked = [untracked({ ports: [], root: 99, pids: [] })];
    const [row] = snap.untrackedEntries([], 500);
    expect(row).not.toHaveProperty("url");
    expect(row).not.toHaveProperty("stopAt");
    expect(row).toMatchObject({ cpu: 0, memKb: 0, startedAt: 500, procs: [] });
  });

  it("marks only running dev rows with when they were last active, and flags an idle-stopped run", async () => {
    ps();
    runs.set("c1", { child: { pid: 10 }, exited: false, command: "pnpm dev", cwd: "/repo" });
    runs.set("c2", { child: { pid: 20 }, exited: true, idleStopped: true, command: "pnpm dev", cwd: "/repo2" });
    sessions.set("c3", { process: { pid: 11 }, spec: { backend: "claude", cwd: "/repo" } });
    listDev.mockResolvedValue([
      { cardId: "c1", command: "pnpm dev", cwd: "/repo", state: "running", startedAt: 50, source: "weft" },
      { cardId: "c2", command: "pnpm dev", cwd: "/repo2", state: "stopped", startedAt: 50, source: "weft" },
    ]);
    for (const k of ["c1", "c2", "c3"]) idleState.activeAt.set(k, 7);
    const all = await snap.listServices();
    expect(all.find((s) => s.id === "dev:c1")?.activeAt).toBe(7);
    const stopped = all.find((s) => s.id === "dev:c2");
    expect(stopped).toMatchObject({ idleStopped: true });
    expect(stopped).not.toHaveProperty("activeAt");
    for (const s of all.filter((s) => s.kind !== "dev")) expect(s, s.id).not.toHaveProperty("activeAt");
  });

  it("doesn't flag a stopped run that wasn't stopped for idling", async () => {
    ps();
    listDev.mockResolvedValue([{ cardId: "c2", command: "pnpm dev", cwd: "/repo2", state: "stopped", startedAt: 50, source: "weft" }]);
    const all = await snap.listServices();
    expect(all.find((s) => s.id === "dev:c2")).not.toHaveProperty("idleStopped");
  });

  it("with footprint, sums each live dev server's real memory over its processes", async () => {
    ps();
    runs.set("c1", { child: { pid: 10 }, exited: false, command: "pnpm dev", cwd: "/repo" });
    runs.set("c2", { child: { pid: 20 }, exited: true, command: "vite", cwd: "/r2" });
    listDev.mockResolvedValue([
      { cardId: "c1", command: "pnpm dev", cwd: "/repo", state: "running", startedAt: 50, source: "weft" },
      { cardId: "c2", command: "vite", cwd: "/r2", state: "stopped", startedAt: 50, source: "weft" },
    ]);
    idleState.untracked = [untracked(), untracked({ key: "untracked:77", root: 77, pids: [77] })];
    footprints.mockResolvedValue(new Map([[10, 1000], [11, 24], [40, 5000]]));
    const all = await snap.listServices(true);
    const pids = footprints.mock.calls[0]?.[0] as number[];
    expect(pids).toEqual(expect.arrayContaining([10, 40, 41]));
    expect(pids).not.toContain(77);
    const dev = all.find((s) => s.id === "dev:c1");
    expect(dev?.procs.map((p) => p.pid)).toEqual([10, 11]);
    expect(dev?.footprintKb).toBe(1024);
    expect(all.find((s) => s.id === "untracked:40")?.footprintKb).toBe(5000);
    expect(all.find((s) => s.id === "dev:c2")).not.toHaveProperty("footprintKb");
  });

  it("leaves footprintKb off when top read nothing for a server", async () => {
    ps();
    idleState.untracked = [untracked()];
    const all = await snap.listServices(true);
    expect(all.find((s) => s.id === "untracked:40")).not.toHaveProperty("footprintKb");
  });
});
