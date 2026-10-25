// Runs a command while holding a machine-wide lock, so parallel cards take turns at `pnpm typecheck` and
// `pnpm lint` (and the pre-commit hook's tsc) instead of all checking the whole repo at once. Five tsc runs
// side by side each take five times as long and pin every core; one after another they share the
// incremental cache. Usage: node scripts/one-at-a-time.mjs <name> "<command>" [args...]
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const POLL_MS = 500;

export function lockPath(name, dir = os.tmpdir()) {
  return path.join(dir, `weft-${name.replace(/[^\w.-]/g, "_")}.lock`);
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}

// Takes the lock if it's free or its holder is gone; false while a live process holds it.
export function tryLock(file, pid = process.pid) {
  try {
    fs.writeFileSync(file, String(pid), { flag: "wx" });
    return true;
  } catch (err) {
    if (err.code !== "EEXIST") throw err;
  }
  const holder = Number(fs.readFileSync(file, "utf8"));
  if (holder && alive(holder)) return false;
  fs.rmSync(file, { force: true });
  return tryLock(file, pid);
}

export function unlock(file, pid = process.pid) {
  try {
    if (Number(fs.readFileSync(file, "utf8")) === pid) fs.rmSync(file, { force: true });
  } catch {
    // Already gone.
  }
}

export async function waitForLock(file, { poll = POLL_MS, onWait = (_pid) => {} } = {}) {
  let told = false;
  while (!tryLock(file)) {
    if (!told) onWait(Number(fs.readFileSync(file, "utf8")));
    told = true;
    await new Promise((resolve) => setTimeout(resolve, poll));
  }
}

async function main([name, command, ...args]) {
  if (!name || !command) {
    console.error('usage: one-at-a-time.mjs <name> "<command>" [args...]');
    return 2;
  }
  const once = process.env.TSC_ONCE_ACTIVE ? null : onPath("tsc-once");
  const line = commandLine(command, args);
  if (once) return delegate(once, name, line);
  return runHolding(name, line);
}

// The command stays shell syntax (`typecheck` is `next typegen && tsc --noEmit`), but each extra arg is one
// word: a path like app/(admin)/layout.tsx or app/[orgSlug] reached /bin/sh bare and broke on the `(`.
// Both runHolding and tsc-once take one shell string, so quoting here covers either path.
export function commandLine(command, args = []) {
  return [command, ...args.map(shellQuote)].join(" ");
}

export function shellQuote(arg) {
  return /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, "'\\''")}'`;
}

// Waits for the lock named `name`, runs `command` holding it (through a shell, or as one program when `args`
// is given), and returns its exit code. A signal that ends
// this script (a thread's Bash command stopped or timed out) goes on to the command too: left running, a
// vitest run's workers outlived it under PID 1 (lib/orphan-guard.ts).
export async function runHolding(name, command, { args, dir = process.env.WEFT_LOCK_DIR || os.tmpdir(), poll = POLL_MS, watchdog } = {}) {
  const file = lockPath(name, dir);
  await waitForLock(file, {
    poll,
    onWait: (pid) => console.error(`${name}: another ${name} is running (pid ${pid}); waiting for it to finish…`),
  });
  const release = () => unlock(file);
  process.on("exit", release);
  const child = spawn(command, args ?? [], { stdio: "inherit", shell: !args });
  // An optional resident-memory cap on the command's whole process tree (scripts/test-watchdog.mjs), for a
  // job whose workers can outgrow the box: a whole-suite vitest run beside a live Weft, say. The watcher
  // SIGTERMs the child on breach; vitest's own limits only see V8's heap, not RSS.
  const stopWatchdog = watchdog?.start?.(child, watchdog.limitMb);
  const forward = (signal) => {
    release();
    child.kill(signal);
    process.exit(130);
  };
  const signals = ["SIGINT", "SIGTERM", "SIGHUP"];
  for (const signal of signals) process.on(signal, forward);
  return new Promise((resolve) =>
    child.on("exit", (code, signal) => {
      for (const s of signals) process.off(s, forward);
      process.off("exit", release);
      stopWatchdog?.();
      release();
      resolve(code ?? (signal ? 1 : 0));
    }),
  );
}

// The machine-wide tsc-once (github.com/fotoflo/zprofile bin/tsc-once), when installed, does this lock's job
// for every project on the Mac: one check per project, at most two at once overall, and a caller whose tree
// hasn't changed since the last check started gets that check's result instead of running it again.
export function onPath(bin, dirs = (process.env.PATH ?? "").split(path.delimiter)) {
  for (const dir of dirs) {
    const file = path.join(dir, bin);
    try {
      fs.accessSync(file, fs.constants.X_OK);
      return file;
    } catch {
      // Not here.
    }
  }
  return null;
}

function delegate(once, name, command) {
  // Keyed by this repo, so the pre-commit hook's check (run from a temp copy) takes turns with `pnpm typecheck`.
  const key = `${fs.realpathSync(path.resolve(import.meta.dirname, ".."))}::${name}`;
  const child = spawn(once, ["--name", name, "--key", key, "--", command], { stdio: "inherit" });
  return new Promise((resolve) => child.on("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0))));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = await main(process.argv.slice(2));
}
