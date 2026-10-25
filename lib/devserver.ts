import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { DevServerStatus } from "./types";
import { cliEnv } from "./env";
import { recordExplore } from "./explore";
import { globalSingleton } from "./global-singleton";
import { restartTarget, weftProcess } from "./restart-guard";
import { devSecrets } from "./secret-run";
import { getCard } from "./store";
import { isolatedPort, withPort } from "./worktree-port";

// The dev server a card's review tour points at: started from the card's folder, kept running
// while the user reviews, and probed so the board can say whether the app really answers.
export interface Run {
  child: ChildProcess;
  command: string;
  cwd: string;
  // Optional, the plan's url: probed to read the run's state (lib/devserver-list.ts).
  url?: string;
  // Set when the card had a name at start time; the drawer shows it.
  title?: string;
  startedAt: number;
  // How many times restartDev started it again; the drawer says "Restarted ×2".
  restarts?: number;
  log: string;
  exited: boolean;
  failed: boolean;
}

const g = globalThis as unknown as { __weftDevExit?: boolean };
export const runs = globalSingleton("__weftDevServers", () => new Map<string, Run>());

const LOG_LIMIT = 4000;

// Anything that answers HTTP counts as up, a 404 or redirect included.
export async function reachable(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(2000), redirect: "manual" });
    return true;
  } catch {
    return false;
  }
}

export async function devStatus(cardId: string, url?: string): Promise<DevServerStatus> {
  const run = runs.get(cardId);
  const probe = url ?? run?.url;
  const up = probe ? await reachable(probe) : false;
  const state = !run ? (up ? "running" : "stopped") : run.exited ? (run.failed ? "failed" : "stopped") : up ? "running" : "starting";
  return { state, command: run?.command, reachable: up, log: run?.log.trim().split("\n").slice(-12).join("\n") ?? "" };
}

export function stopDev(cardId: string) {
  const run = runs.get(cardId);
  if (!run) return;
  runs.delete(cardId);
  if (run.exited) return;
  // The shell leads a process group, so one signal takes down the server and whatever it spawned.
  try {
    if (run.child.pid === undefined) run.child.kill("SIGTERM");
    else process.kill(-run.child.pid, "SIGTERM");
  } catch {
    run.child.kill("SIGTERM");
  }
}

// With a vault for the folder, the server gets its development values in its env (lib/secret-run.ts), never
// this server's or a thread's; the user approves the command the first time. An isolated card's server gets a port of
// its own (lib/worktree-port.ts); the url it answers on comes back, moved to that port.
export async function startDev(cardId: string, command: string, cwd: string, title?: string, givenUrl?: string): Promise<{ url?: string; port?: number }> {
  const refused = startsWeft(command, cwd);
  if (refused) throw new Error(refused);
  const port = await isolatedPort(getCard(cardId), command);
  const url = withPort(givenUrl, port);
  const existing = runs.get(cardId);
  if (existing && !existing.exited && existing.command === command) return { url: existing.url ?? url, port };
  const { launch, note } = await devSecrets(cardId, command, cwd, title);
  stopDev(cardId);
  // cliEnv() drops the pane's control-server token, which a dev server has no use for.
  const env = { ...cliEnv(), ...launch?.env, ...(port ? { PORT: String(port) } : {}) };
  // (A plain start ignores stdin, so its stdin is null; only the secrets launch writes to it.)
  // Without the vault launch, parse the command into argv and spawn without a shell so a
  // launcher the user picked from the project files (lib/dev-commands.ts) never travels through
  // a shell. The vault launch path already takes a structured { bin, args } from secret-run.
  const child = (
    launch
      ? spawn(launch.bin, launch.args, { cwd, env, detached: true, stdio: ["pipe", "pipe", "pipe"] })
      : spawnPlainCommand(command, { cwd, env, detached: true, stdio: ["ignore", "pipe", "pipe"] })
  ) as ChildProcessWithoutNullStreams;
  if (launch) child.stdin.end(launch.stdin);
  const run: Run = { child, command, cwd, ...(url && { url }), ...(title && { title }), startedAt: Date.now(), log: launch ? `With vault secrets: ${launch.names.join(", ")}\n` : note ? `${note}\n` : "", exited: false, failed: false };
  const collect = (chunk: Buffer) => {
    run.log = (run.log + chunk.toString()).slice(-LOG_LIMIT);
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  child.on("error", (err) => {
    run.log += `\n${err.message}`;
    run.exited = run.failed = true;
  });
  child.on("exit", (code) => {
    run.exited = true;
    run.failed = code !== 0 && code !== null && runs.get(cardId) === run;
  });
  runs.set(cardId, run);
  void recordExplore("devserver");
  return { url, port };
}

// Why a command can't start here, or null. Weft's own folder is the board itself: its dev script frees the board's
// port first, so a second one kills the server every card runs on (2026-10-23: one card's `mcp__devservers__start
// pnpm dev` restarted Weft seven times in half an hour). Bash has lib/restart-guard.ts; every way in here
// (the devservers tool, a review tour, the Services drawer's Start) comes through startDev.
export function startsWeft(command: string, cwd: string, weft = weftProcess()): string | null {
  const target = restartTarget(command, cwd, weft);
  if (!target) return null;
  const at = weft.port ? ` at http://127.0.0.1:${weft.port}` : "";
  return `Won't start \`${command}\` in ${cwd}: it would stop Weft itself (${target}). This folder's dev server is the board you're on${at}, already running; there's nothing to start.`;
}

// Splits a launcher command into argv and spawns it without a shell. Dev commands Weft detects
// (lib/dev-commands.ts) are simple launchers ("pnpm dev", "bin/rails server", "make dev") and
// don't carry shell metacharacters; if a project ships one that does, the launch is refused
// rather than silently falling back to a shell, so the L-4 narrowing sticks. Quotes are
// respected so a script body like `node -e "console.log('hi')"` still parses if a future
// detector ever produces one (none does today).
const SHELL_META = /[|&;<>`$(){}\\]/;
function spawnPlainCommand(command: string, opts: Parameters<typeof spawn>[2] & { cwd: string; env: NodeJS.ProcessEnv }) {
  if (SHELL_META.test(command)) {
    // Refuse the shell: write a clear error to stderr and run `false` so the run's exit handler
    // marks it failed. The user sees the reason in the Services drawer's log.
    return spawnWithError(opts, `Won't run dev command through a shell: ${command}`);
  }
  const argv = splitCommand(command);
  if (argv.length === 0) return spawnWithError(opts, `Empty dev command.`);
  const bin = argv[0];
  if (!bin) return spawnWithError(opts, `Empty dev command.`);
  return spawn(bin, argv.slice(1), { ...opts, shell: false });
}

// Returns a ChildProcess that immediately writes an error to stderr and exits non-zero. The
// drawer's log + the "failed" marker come from the same hooks a real run would feed.
function spawnWithError(opts: Parameters<typeof spawn>[2] & { cwd: string; env: NodeJS.ProcessEnv }, message: string) {
  // shell:false so the message doesn't get interpreted, and /bin/sh on macOS is the fallback
  // when echo is missing.
  return spawn("/bin/sh", ["-c", `echo ${shellEscape(message)} 1>&2; exit 1`], { ...opts, shell: false });
}

// Wraps a string in single quotes, escaping any embedded single quote, so a /bin/sh -c call
// above can pass the message through without shell expansion eating the punctuation.
function shellEscape(message: string): string {
  return `'${message.replace(/'/g, "'\\''")}'`;
}

// Splits a command string into argv, honouring single and double quotes. Unquoted text is split
// on whitespace; quoted text is kept as a single argv even when it contains spaces. No backslash
// escapes (shell metacharacters are refused above before this runs).
export function splitCommand(command: string): string[] {
  const out: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i] as string;
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (!inSingle && !inDouble && (ch === " " || ch === "\t")) {
      if (current) {
        out.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }
  if (current) out.push(current);
  return out;
}

// Stop the card's current run, then start it again with the same command/cwd/url/title. No-op when
// the card has no server right now.
export async function restartDev(cardId: string) {
  const run = runs.get(cardId);
  if (!run) return;
  const { command, cwd, url, title } = run;
  stopDev(cardId);
  await startDev(cardId, command, cwd, title, url);
  const next = runs.get(cardId);
  if (next && next !== run) next.restarts = (run.restarts ?? 0) + 1;
}

// Servers Weft started shouldn't outlive it.
if (!g.__weftDevExit) {
  g.__weftDevExit = true;
  process.on("exit", () => {
    for (const id of [...runs.keys()]) stopDev(id);
  });
}
