import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { track, plan, type Watch } from "./dev-idle";
import { idleState } from "./dev-idle-state";
import { workingFolders } from "./dev-launchers";
import { hasVisitor, listeners, parseNetstat } from "./dev-traffic";
import { findUntracked, type Proc } from "./dev-untracked";
import { idleStop, runs } from "./devserver";
import { globalSingleton } from "./global-singleton";
import { weftProcess } from "./restart-guard";
import { busyCards } from "./runner-state";
import { terminate } from "./services-kill";
import { readProcs } from "./services-snapshot";
import { getCard, listCards } from "./store";

// Weft's idle check (docs/architecture/dev-servers.md#idle-stop). Once a minute: one `netstat -anv -p tcp` and one `ps`
// (~10 ms together), and an `lsof` for the cwd of a listener seen for the first time. A dev server Weft runs that has
// had no visitor and no turn on its card for 30 minutes is stopped (lib/devserver.ts idleStop) and starts again on
// demand. A dev server Weft didn't start, listening in a board folder, is listed in the Services drawer and, once idle,
// announced with a toast whose Undo keeps it, then stopped 90 s later. Weft's own server and Electron are never touched.

export const TICK_MS = 60_000;
const run = promisify(execFile);

export interface Deps {
  netstat: () => Promise<string>;
  procs: () => Promise<(Proc & { pgid: number })[]>;
  // The cwd of each pid, from one lsof.
  cwds: (pids: number[]) => Promise<string>;
  folders: () => string[];
  // Cards running a turn, and each one's folder.
  busy: () => string[];
  cardCwd: (id: string) => string | undefined;
  idleStop: (key: string) => void;
  terminate: (pids: number[]) => void;
  weft: { pids: number[]; dir: string; port: string };
}

// lsof -Fpn: "p123", "fcwd", "n/path" per process.
export function parseCwds(out: string): Map<number, string> {
  const cwds = new Map<number, string>();
  let pid = 0;
  for (const line of out.split("\n")) {
    if (line.startsWith("p")) pid = Number(line.slice(1));
    else if (line.startsWith("n") && pid) cwds.set(pid, line.slice(1));
  }
  return cwds;
}

// A process a dev server could be: worth one lsof for its folder.
const RUNTIME = /node|next-server|\bbun\b|\bdeno\b|python|ruby|vite|expo/;

async function lookupCwds(pids: number[], procs: readonly Proc[], deps: Deps) {
  const commands = new Map(procs.map((p) => [p.pid, p.command]));
  const fresh = pids.filter((p) => !idleState.cwds.has(p) && RUNTIME.test(commands.get(p) ?? ""));
  if (fresh.length) for (const [pid, cwd] of parseCwds(await deps.cwds(fresh))) idleState.cwds.set(pid, cwd);
  for (const pid of idleState.cwds.keys()) if (!commands.has(pid)) idleState.cwds.delete(pid);
}

const inside = (folder: string, dir: string) => {
  const rel = path.relative(folder, dir);
  return !rel.startsWith("..") && !path.isAbsolute(rel);
};

// Weft's live runs, each with its process group (a run is spawned detached, leading its own), and whether it's active.
function watchRuns(procs: readonly (Proc & { pgid: number })[], active: (key: string, cwd: string, group: Set<number>) => boolean) {
  const watches: Watch[] = [];
  const tracked = new Set<number>();
  for (const [key, r] of runs) {
    const leader = r.child.pid;
    if (r.exited || r.idleStopped || !leader) continue;
    const group = new Set([leader, ...procs.filter((p) => p.pgid === leader).map((p) => p.pid)]);
    for (const pid of group) tracked.add(pid);
    watches.push({ key, active: active(key, r.cwd, group) });
  }
  return { watches, tracked };
}

export async function tick(deps: Deps = liveDeps(), now = Date.now()) {
  const sockets = parseNetstat(await deps.netstat().catch(() => ""));
  // No sockets read means no evidence: never stop anything on that.
  if (!sockets.length) return;
  const procs = await deps.procs();
  const listening = listeners(sockets);
  const busy = new Set(deps.busy());
  const busyDirs = [...busy].flatMap((id) => deps.cardCwd(id) ?? []);
  const working = (dir: string) => busyDirs.some((d) => inside(d, dir) || inside(dir, d));
  const ignore = new Set(deps.weft.pids);
  const { watches, tracked } = watchRuns(procs, (key, cwd, group) => busy.has(key) || working(cwd) || hasVisitor(sockets, group, ignore));
  await lookupCwds([...listening.keys()], procs, deps);
  const self = { dir: deps.weft.dir, port: Number(deps.weft.port) };
  const found = findUntracked({ procs, listening, cwds: idleState.cwds, folders: deps.folders(), tracked, weft: ignore, self });
  for (const u of found) watches.push({ key: u.key, active: working(u.cwd) || hasVisitor(sockets, new Set(u.pids), ignore) });
  const { activeAt, idle } = track(idleState.activeAt, watches, now);
  idleState.activeAt = activeAt;
  for (const key of idle) if (!key.startsWith("untracked:")) deps.idleStop(key);
  const { pending, stop } = plan(idle.filter((k) => k.startsWith("untracked:")), idleState.pending, idleState.kept, now);
  idleState.pending = pending;
  for (const u of found) if (stop.includes(u.key)) deps.terminate(u.pids);
  idleState.untracked = found.filter((u) => !stop.includes(u.key));
  idleState.kept = new Set([...idleState.kept].filter((k) => idleState.untracked.some((u) => u.key === k)));
}

export function liveDeps(): Deps {
  const out = async (bin: string, args: string[]) => {
    try {
      return (await run(bin, args, { maxBuffer: 8 * 1024 * 1024 })).stdout;
    } catch (err) {
      // lsof exits 1 when one of the pids is gone; what it read is still good.
      return (err as { stdout?: string }).stdout ?? "";
    }
  };
  return {
    netstat: () => out("/usr/sbin/netstat", ["-anv", "-p", "tcp"]),
    procs: readProcs,
    cwds: (pids) => out("/usr/sbin/lsof", ["-a", "-d", "cwd", "-Fpn", "-p", pids.join(",")]),
    folders: () => [...workingFolders(listCards()), process.cwd()],
    busy: busyCards,
    cardCwd: (id) => getCard(id)?.cwd,
    idleStop,
    terminate,
    weft: weftProcess(),
  };
}

const loop = globalSingleton("__weftDevIdleLoop", () => ({ timer: undefined as ReturnType<typeof setInterval> | undefined }));

// Started with the server's background work (lib/copilot.ts); once per process.
export function startDevIdle(every = TICK_MS) {
  if (loop.timer) return;
  loop.timer = setInterval(() => void tick().catch((err: unknown) => console.warn(`Dev server idle check: ${(err as Error).message}`)), every);
  loop.timer.unref();
}

export function stopDevIdle() {
  clearInterval(loop.timer);
  loop.timer = undefined;
}
