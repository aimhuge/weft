// What a thread is told about the machine it runs on (docs/architecture/thread-env.md): this Mac or a Weft Worker by
// name, the OS, Weft's version and commit, and how far behind origin/main the checkout is. Read once and cached: the
// commit and the behind count come from one async `git` each, started at server or daemon start (warmHostFacts) and
// never on a turn. Nothing here fetches: a worker's update loop already does (lib/worker-update.ts), and tells us what
// it found through noteUpstream; a Mac counts against its own origin/main as of its last fetch.
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { cleanTz, type ClientHint } from "@weft/client";

export interface HostFacts {
  worker: boolean;
  name: string;
  os: string;
  version: string;
  commit?: string;
  // Commits origin/main has that this checkout doesn't, and when that was last known (a fetch).
  behind?: number;
  checkedAt?: number;
}

type Env = Record<string, string | undefined>;

export type Git = (args: string[], cwd: string) => Promise<string>;

const execGit = promisify(execFile);
const runGit: Git = async (args, cwd) => (await execGit("git", args, { cwd, timeout: 10_000 })).stdout;

// A Mac re-counts the behind (local refs only) when the last count is this old; a worker's update loop keeps its own.
export const RECOUNT_MS = 10 * 60_000;

interface State {
  base?: Omit<HostFacts, "behind" | "checkedAt" | "commit">;
  commit?: string;
  upstream?: { behind: number; at: number };
  workerName?: string;
  countedAt: number;
  counting: boolean;
  warmed?: Promise<void>;
}

const fresh = (): State => ({ countedAt: 0, counting: false });
let st = fresh();

/** Tests: forget what's cached. */
export function resetHostFacts() {
  st = fresh();
}

/** The worker's enrolled name (worker.json), set at daemon start. */
export function setWorkerName(name: string) {
  st.workerName = name;
  st.base = undefined;
}

export function osLabel(platform: string = process.platform, release: string = os.release(), arch: string = os.arch()) {
  if (platform === "darwin") return `macOS (Darwin ${release}, ${arch})`;
  if (platform === "linux") return `Linux ${release} (${arch})`;
  return `${platform} ${release} (${arch})`;
}

function readVersion(dir: string, env: Env): string {
  try {
    const { version } = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as { version?: unknown };
    if (typeof version === "string" && version) return version;
  } catch {}
  return env.NEXT_PUBLIC_APP_VERSION?.split("+")[0] || "unknown";
}

// A packaged build has no .git; its version may carry the commit it patches (0.6.7+abc1234).
const envCommit = (env: Env) => env.NEXT_PUBLIC_APP_VERSION?.split("+")[1] || undefined;

/** What's known now. Never waits: the git parts fill in once warmHostFacts's reads land. */
export function hostFacts(env: Env = process.env, dir: string = process.cwd(), now: number = Date.now(), git: Git = runGit): HostFacts {
  const worker = env.WEFT_WORKER === "1";
  st.base ??= {
    worker,
    name: (worker && st.workerName) || os.hostname().replace(/\.local$/, ""),
    os: osLabel(),
    version: readVersion(dir, env),
  };
  // A Mac recounts now and then; a worker's count comes from its update loop, after each fetch.
  if (!worker && now - st.countedAt > RECOUNT_MS) void countBehind(dir, git, now);
  const commit = st.commit ?? envCommit(env);
  const up = st.upstream;
  return { ...st.base, ...(commit && { commit }), ...(up && { behind: up.behind, checkedAt: up.at }) };
}

/** After a fetch (the worker's update loop): how many commits origin/main is ahead of this checkout. */
export function noteUpstream(behind: number, at: number = Date.now()) {
  st.upstream = { behind, at };
}

// The checkout's commit and its distance to origin/main as of the last fetch (FETCH_HEAD's time). Local reads only.
export async function countBehind(dir: string, git: Git = runGit, now: number = Date.now()) {
  if (st.counting) return;
  st.counting = true;
  st.countedAt = now;
  try {
    st.commit = (await git(["rev-parse", "--short=7", "HEAD"], dir)).trim() || undefined;
    const behind = Number((await git(["rev-list", "--count", "HEAD..origin/main"], dir)).trim());
    if (Number.isFinite(behind)) noteUpstream(behind, fetchedAt(dir) ?? now);
  } catch {
    // Not a git checkout (a packaged app), or no origin/main: the block just says less.
  } finally {
    st.counting = false;
  }
}

function fetchedAt(dir: string): number | undefined {
  try {
    return fs.statSync(path.join(dir, ".git", "FETCH_HEAD")).mtimeMs;
  } catch {
    return undefined;
  }
}

/** At server or daemon start, off the card path: reads the commit and the behind count, once per process. */
export function warmHostFacts(dir: string = process.cwd(), git: Git = runGit): Promise<void> {
  if (st.warmed) return st.warmed;
  hostFacts(process.env, dir, 0, git);
  st.warmed = countBehind(dir, git);
  return st.warmed;
}

/** This host's IANA time zone. */
export const hostTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** What this Mac's server stamps on a row it sends a worker for its desktop board (lib/worker-board.ts insert). */
export function macHint(): ClientHint {
  const tz = cleanTz(hostTz());
  return { app: "desktop", name: hostFacts().name, ...(tz && { tz }), via: "relay" };
}
