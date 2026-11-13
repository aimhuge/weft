import { killAllGroups } from "./cli-process";

// Ends Weft's server when the Electron app that started it is gone, and makes sure a SIGTERM ends it.
// On 2026-11-13 a packaged server ran under PID 1 for four days at ~100% CPU with 17 claude CLIs:
// - Electron spawns it with piped stdout/stderr. Once Electron is gone every log line fails with EPIPE,
//   which nothing handled, so Next's uncaughtException logger wrote the error to stderr, which failed
//   again: a loop of tens of thousands of exceptions a second.
// - Next's SIGTERM handler waits for server.close() and ignores every later SIGTERM, so a close that
//   never finishes keeps the process alive. Its exit hook (lib/cli-process.ts killAllGroups) never ran,
//   so the claude CLIs lived on too.
// The packaged server runs as Electron's Node (ELECTRON_RUN_AS_NODE) with Weft's plugin dir, so its
// parent is Electron. WEFT_PARENT_PID names another pid to watch (a launcher that wants one); a server
// started any other way (Vercel, a terminal, `next dev` from source) isn't watched.

// How often the server checks its parent is still there.
export const WATCH_MS = 2_000;
// How long Next's own SIGTERM cleanup gets before the server ends itself.
export const TERM_GRACE_MS = 5_000;

export interface WatchedProcess {
  pid: number;
  ppid: number;
  env: NodeJS.ProcessEnv;
  stdout: NodeJS.EventEmitter;
  stderr: NodeJS.EventEmitter;
  on(event: "SIGTERM" | "SIGINT", listener: () => void): unknown;
  kill(pid: number, signal: NodeJS.Signals | 0): unknown;
  exit(code?: number): never;
}

const FLAG = "__weftParentWatch";

// True while `pid` names a live process (EPERM still means it exists).
export function isAlive(proc: Pick<WatchedProcess, "kill">, pid: number): boolean {
  try {
    proc.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

// Ends the server: the CLIs' process groups first (SIGKILL), then the server itself.
function end(proc: WatchedProcess, code: number, endGroups: () => void) {
  try {
    endGroups();
  } finally {
    proc.exit(code);
  }
}

// The Electron pid to watch, or NaN. Needs no change to Electron main, so a server patch
// (electron/server-patch.cjs) brings it to apps already installed.
export function parentPid(proc: Pick<WatchedProcess, "env" | "ppid">): number {
  if (proc.env.WEFT_PARENT_PID) return Number(proc.env.WEFT_PARENT_PID);
  return proc.env.ELECTRON_RUN_AS_NODE && proc.env.WEFT_PLUGIN_DIR ? proc.ppid : NaN;
}

// Starts watching once per process; false when there's no Electron parent to watch or it's already on.
export function watchParent(proc: WatchedProcess = process, every = WATCH_MS, endGroups = killAllGroups): boolean {
  const flags = proc as unknown as Record<string, unknown>;
  const parent = parentPid(proc);
  if (flags[FLAG] || !Number.isInteger(parent) || parent <= 1) return false;
  flags[FLAG] = true;
  // Only this server watches Electron: a card's dev server or CLI it starts mustn't inherit the pid.
  delete proc.env.WEFT_PARENT_PID;
  // The direct parent: Electron for the packaged server, `next dev`'s launcher from source.
  const ppid = proc.ppid;
  const gone = () => proc.ppid !== ppid || !isAlive(proc, parent);
  // A broken pipe means nobody reads the log any more: Electron is gone. Any other write error is
  // swallowed too, so it can't turn into an uncaughtException that logs to the same broken pipe.
  for (const stream of [proc.stdout, proc.stderr]) {
    stream.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EPIPE" || gone()) end(proc, 1, endGroups);
    });
  }
  setInterval(() => {
    if (gone()) end(proc, 1, endGroups);
  }, every).unref();
  // Next's handler starts a graceful close; this one ends the server if that close never finishes.
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    proc.on(signal, () => {
      setTimeout(() => end(proc, signal === "SIGTERM" ? 143 : 130, endGroups), TERM_GRACE_MS).unref();
    });
  }
  return true;
}
