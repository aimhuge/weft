import { spawn } from "node:child_process";
import type { SpawnedProcess, SpawnOptions } from "@anthropic-ai/claude-agent-sdk";
import { bindCap, dropCap } from "./connector-env";
import { globalSingleton } from "./global-singleton";
import { findDescendantGroups, signalGroups } from "./process-tree";
import { isWindows, killTree, spawnPlan } from "./win-command";

// Starts a thread's CLI in a process group of its own, so ending it ends everything it started.
// puku-cli is a `node` wrapper whose `Puku` child outlives it: killing only the wrapper (all the
// SDK's own spawn does) left `Puku` orphaned under PID 1, burning CPU until someone found it.

// How long the group gets after SIGTERM before SIGKILL.
export const KILL_GRACE_MS = 2_000;
// How much of the CLI's stderr is kept for the error a failed CLI shows.
const STDERR_TAIL = 2_000;

// The process groups of every CLI this server started that may still have a live process.
export const groups = globalSingleton("__weftCliGroups", () => new Set<number>());

// Signals the whole group; false once nothing in it is left. Windows has no process groups: taskkill ends the tree.
export function killGroup(pgid: number, signal: NodeJS.Signals): boolean {
  if (isWindows()) {
    if (killTree(pgid)) return true;
    groups.delete(pgid);
    return false;
  }
  try {
    process.kill(-pgid, signal);
    return true;
  } catch {
    groups.delete(pgid);
    return false;
  }
}

// SIGTERM now, SIGKILL whatever ignored it after the grace period. The groups the CLI's Bash commands run
// in go too (lib/process-tree.ts): found while the CLI is still alive, since they reparent once it's gone.
export function endGroup(pgid: number) {
  const children = findDescendantGroups(pgid);
  signalGroups(children, "SIGTERM");
  const alive = killGroup(pgid, "SIGTERM");
  // Windows' taskkill /F already ended the tree, and a second one later could hit a reused pid.
  if (isWindows()) {
    groups.delete(pgid);
    return;
  }
  if (!alive && !children.length) return;
  setTimeout(() => {
    signalGroups(children, "SIGKILL");
    if (alive && killGroup(pgid, "SIGKILL")) groups.delete(pgid);
  }, KILL_GRACE_MS).unref();
}

// On the server's way out (Next's SIGTERM/SIGINT handlers call process.exit), take every CLI with it.
// exit handlers run synchronously, so there's no grace: SIGKILL.
export function killAllGroups() {
  for (const pgid of [...groups]) {
    signalGroups(findDescendantGroups(pgid), "SIGKILL");
    killGroup(pgid, "SIGKILL");
  }
  groups.clear();
}

globalSingleton("__weftCliExitHook", () => process.on("exit", killAllGroups));

// The SDK's exit and error listeners, passed through to the child as they are.
type Listener = (...args: never[]) => void;
type ChildListener = (...args: unknown[]) => void;

export interface CliProcess extends SpawnedProcess {
  // Leads the CLI's process group; the Services drawer (lib/services-snapshot.ts) finds the thread by it.
  pid?: number;
  // The end of what the CLI wrote to stderr, for the error shown when it fails.
  stderrTail(): string;
}

// The SDK's spawnClaudeCodeProcess hook: its own spawn, plus `detached` for a process group of its own.
export function spawnCli(options: SpawnOptions, onStderr?: (text: string) => void): CliProcess {
  // An npm-installed CLI on Windows is a .cmd shim, which only cmd.exe runs (lib/win-command.ts).
  const plan = spawnPlan(options.command, options.args, { env: options.env });
  const child = spawn(plan.command, plan.args, {
    cwd: options.cwd,
    env: options.env as NodeJS.ProcessEnv,
    stdio: ["pipe", "pipe", "pipe"],
    detached: !isWindows(),
    windowsHide: true,
    windowsVerbatimArguments: plan.windowsVerbatimArguments,
  });
  const pgid = child.pid;
  if (pgid) groups.add(pgid);
  // On a worker, the connector capability in this env answers only this process tree, and ends with it (lib/connector-env.ts).
  bindCap(options.env, pgid);
  child.once("exit", () => dropCap(options.env));
  let tail = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (text: string) => {
    tail = (tail + text).slice(-STDERR_TAIL);
    onStderr?.(text);
  });
  child.stderr.on("error", () => {});
  // The wrapper may exit on its own (its input closed) and leave its children: end the rest of the group.
  child.once("exit", () => pgid && endGroup(pgid));
  // The SDK aborts this signal after its own graceful close (stdin EOF, ~2s).
  const abort = () => pgid && endGroup(pgid);
  if (options.signal.aborted) abort();
  else options.signal.addEventListener("abort", abort, { once: true });
  return {
    pid: child.pid,
    stdin: child.stdin,
    stdout: child.stdout,
    get killed() {
      return child.killed;
    },
    get exitCode() {
      return child.exitCode;
    },
    get signalCode() {
      return child.signalCode;
    },
    kill: (signal) => (pgid ? killGroup(pgid, signal) : child.kill(signal)),
    on: (event: "exit" | "error", listener: Listener) => void child.on(event, listener as ChildListener),
    once: (event: "exit" | "error", listener: Listener) => void child.once(event, listener as ChildListener),
    off: (event: "exit" | "error", listener: Listener) => void child.off(event, listener as ChildListener),
    stderrTail: () => tail.trim(),
  };
}

// The SDK puts the stderr tail in a failed CLI's error only from its own spawn; add it back, so a
// logged-out or rate-limited CLI still reads as one (lib/login.ts).
export function withStderr(message: string, tail: string | undefined) {
  if (!tail || message.includes(tail)) return message;
  return `${message}\n${tail}`;
}
