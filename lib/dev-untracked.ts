import path from "node:path";

// Dev servers Weft didn't start (docs/architecture/dev-servers.md#untracked-servers): a process listening on a port,
// running a dev server, whose folder is one of the board's. A thread that slipped past the Bash guard
// (lib/devserver-guard.ts), a server from your own terminal, one left over from before a restart. Pure: the loop
// (lib/dev-idle-loop.ts) supplies `ps`, the listeners from netstat and each listener's cwd.

export interface Proc {
  pid: number;
  ppid: number;
  command: string;
}

export interface Untracked {
  // "untracked:<root pid>".
  key: string;
  // The launcher the server runs under (`pnpm dev`, `npm exec expo start`), and what it started: stopped together.
  root: number;
  pids: number[];
  ports: number[];
  cwd: string;
  command: string;
}

// A process that is a dev server, or the package-manager / shell step that launched one.
const DEV = /next-server|\bnext(\.js)?\s+(dev|start)\b|\bvite\b|\bexpo\b.*\bstart\b|\bastro\b.*\bdev\b|\bnuxi?\b.*\bdev\b|webpack.*\bserve\b|webpack-dev-server|\bwrangler\b.*\bdev\b|\bstorybook\b|\bremix\b.*\bdev\b|react-native.*\bstart\b|\b(npm|pnpm|yarn|bun)\b.*\b(run\s+)?(dev|start|serve|develop|preview)\b/;
// Never climbed into, never stopped: a thread's CLI, a terminal or multiplexer, the login session, Weft itself.
const STOP = /(^|\/)(claude|codex|puku-cli|goose|login|launchd|tmux|screen|Terminal|iTerm2|Electron|Weft)(\s|$)|Electron\.app|Weft\.app/;
const SHELL = /^-?(\S*\/)?(zsh|bash|sh|dash|fish)(\s|$)/;

// Whether a parent is still part of the server's launch: node, a package manager, a `sh -c` an npm script runs; not an
// interactive shell, a CLI or Weft.
function launches(proc: Proc | undefined, weft: ReadonlySet<number>): proc is Proc {
  if (!proc || proc.pid <= 1 || weft.has(proc.pid) || STOP.test(proc.command)) return false;
  return !SHELL.test(proc.command) || /\s-[a-zA-Z]*c\b/.test(proc.command);
}

// The highest launcher above a listening process, and the commands on the way (one of them names the dev server).
function rootOf(pid: number, byPid: ReadonlyMap<number, Proc>, weft: ReadonlySet<number>): { root: number; chain: string[] } {
  let root = pid;
  const chain = [(byPid.get(pid) as Proc).command];
  for (let parent = byPid.get(pid); parent; ) {
    const up = byPid.get(parent.ppid);
    if (!launches(up, weft)) break;
    root = up.pid;
    chain.push(up.command);
    parent = up;
  }
  return { root, chain };
}

// The root and everything under it, parents first.
function tree(root: number, procs: readonly Proc[]): number[] {
  const out = [root];
  for (let i = 0; i < out.length; i++) for (const p of procs) if (p.ppid === out[i] && !out.includes(p.pid)) out.push(p.pid);
  return out;
}

const inside = (folder: string, dir: string) => {
  const rel = path.relative(folder, dir);
  return !rel.startsWith("..") && !path.isAbsolute(rel);
};

export interface Inputs {
  procs: readonly Proc[];
  listening: ReadonlyMap<number, number[]>;
  cwds: ReadonlyMap<number, string>;
  // The board's folders.
  folders: readonly string[];
  // Processes Weft tracks already (its runs' process groups): never listed again.
  tracked: ReadonlySet<number>;
  // Weft's own server, its `next dev` and Electron: never listed, never climbed into.
  weft: ReadonlySet<number>;
  // Weft's own folder and port: a next-server there on that port is the board, whatever its pid.
  self: { dir: string; port: number };
}

export function findUntracked(input: Inputs): Untracked[] {
  const byPid = new Map(input.procs.map((p) => [p.pid, p]));
  const found = new Map<number, Untracked>();
  for (const [pid, ports] of input.listening) {
    const cwd = input.cwds.get(pid);
    if (!cwd || input.tracked.has(pid) || input.weft.has(pid) || !byPid.has(pid)) continue;
    if (path.resolve(cwd) === path.resolve(input.self.dir) && ports.includes(input.self.port)) continue;
    if (!input.folders.some((f) => inside(f, cwd))) continue;
    const { root, chain } = rootOf(pid, byPid, input.weft);
    if (!chain.some((c) => DEV.test(c)) || STOP.test(chain[0] as string)) continue;
    const had = found.get(root);
    if (had) had.ports = [...new Set([...had.ports, ...ports])];
    else found.set(root, { key: `untracked:${root}`, root, pids: tree(root, input.procs), ports, cwd, command: (byPid.get(root) as Proc).command });
  }
  return [...found.values()];
}
