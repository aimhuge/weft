import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { cliEnv } from "./env";
import { publish } from "./bus";
import type { Backend, LoginState, LoginTrial, LoginView } from "./types";
import { globalSingleton } from "./global-singleton";
import { openLoginInTerminal } from "./login-terminal";
import { authStatus } from "./login-status";
import { clean, errMessage, isNotLoggedInError, isRateLimitError, lastUrl, needsTty } from "./login-output";

// Runs `<cli> auth login` in the background when a thread finds its CLI logged out, streams the
// CLI's output to the board's login pop-up, and falls back to a Terminal window when the CLI
// needs a real TTY (the macOS Terminal path lives in ./login-terminal).

const COMMANDS: Record<Backend, string> = { claude: "claude", puku: "puku-cli", codex: "codex", goose: "goose" };
const OUTPUT_BYTES = 8 * 1024;
// Raw output kept for re-cleaning, so escape codes split across chunks still strip cleanly.
const RAW_BYTES = 32 * 1024;
const PUBLISH_MS = 200;
export const POLL_MS = 3_000;
// How long onExit keeps re-checking authStatus after `auth login` exits before giving up.
export const LOGIN_POLL_TIMEOUT_MS = 10_000;
export const TERMINAL_WAIT_MS = 10 * 60_000;

interface LoginRun {
  view: LoginView;
  raw: string;
  child?: ChildProcess;
  poll?: ReturnType<typeof setInterval>;
  polling: boolean;
  // Called once, when the CLI reports it's logged in.
  onDone: (() => void)[];
  publishTimer?: ReturnType<typeof setTimeout>;
  lastPublish: number;
}

// Kept on globalThis so dev-mode reloads don't lose a login in progress.
export const runs = globalSingleton("__weftLogins", () => new Map<Backend, LoginRun>());

const binaries = new Map<Backend, string>();

export function binary(backend: Backend) {
  let path = binaries.get(backend);
  if (!path) {
    const command = COMMANDS[backend];
    try {
      path = execFileSync("/usr/bin/which", [command], { encoding: "utf8" }).trim();
    } catch {
      path = "";
    }
    if (!path) throw new Error(`${command} isn't on this app's PATH, so it can't log in.`);
    binaries.set(backend, path);
  }
  return path;
}

// Exported for ./login-status, which reuses these helpers (kept as aliases so callers can keep importing from this module).
export { errMessage as message, clean as cleanOutput, isNotLoggedInError, isRateLimitError };

function refresh(run: LoginRun) {
  const text = clean(run.raw);
  run.view.output = text.length > OUTPUT_BYTES ? text.slice(-OUTPUT_BYTES) : text;
  const url = lastUrl(run.raw, text);
  if (url) run.view.url = url;
}

function snapshot(run: LoginRun): LoginView {
  refresh(run);
  return { ...run.view };
}

export function append(run: LoginRun, chunk: string) {
  run.raw += chunk;
  if (run.raw.length > RAW_BYTES) run.raw = run.raw.slice(-RAW_BYTES);
}

export function isCurrent(run: LoginRun) {
  return runs.get(run.view.backend) === run;
}

// Read fresh each time: the state can change across an await.
function stillRunning(run: LoginRun) {
  return isCurrent(run) && run.view.state === "running";
}

export function emit(run: LoginRun) {
  if (run.publishTimer) {
    clearTimeout(run.publishTimer);
    run.publishTimer = undefined;
  }
  run.lastPublish = Date.now();
  if (isCurrent(run)) publish({ type: "login", login: snapshot(run) });
}

// Output arrives in bursts; publish at most every PUBLISH_MS.
function emitSoon(run: LoginRun) {
  if (run.publishTimer) return;
  const wait = Math.max(0, PUBLISH_MS - (Date.now() - run.lastPublish));
  run.publishTimer = setTimeout(() => emit(run), wait);
}

// --- Lifecycle ------------------------------------------------------------------------------

export function stopPolling(run: LoginRun) {
  if (run.poll) clearInterval(run.poll);
  run.poll = undefined;
  run.polling = false;
}

// Re-checks `auth status` until it reports `loggedIn: true`, the run is no longer current, or the deadline passes.
function startPolling(run: LoginRun, deadline: number) {
  if (run.poll || run.polling) return;
  run.polling = true;
  // Do the first check now so we don't wait POLL_MS when the credential is already visible.
  const tick = () => {
    if (!stillRunning(run) || !run.polling) {
      stopPolling(run);
      return;
    }
    if (Date.now() >= deadline) {
      stopPolling(run);
      run.polling = false;
      failRun(run, "auth login exited but the CLI still reports logged out. Try logging in again.");
      return;
    }
    authStatus(run.view.backend)
      .then((status) => {
        if (!stillRunning(run) || !run.polling) {
          stopPolling(run);
          return;
        }
        if (status.loggedIn) {
          stopPolling(run);
          run.polling = false;
          succeed(run);
        }
      })
      .catch((err: unknown) => {
        // A status check erroring out isn't a login failure; try again next tick.
        if (stillRunning(run)) append(run, `\n${errMessage(err)}\n`);
      });
  };
  run.poll = setInterval(tick, POLL_MS);
  tick();
}

function killChild(run: LoginRun) {
  const child = run.child;
  run.child = undefined;
  if (child && child.exitCode === null && child.signalCode === null) child.kill();
}

// Stops whatever a run is doing and hands back the callbacks still waiting on a login.
function retire(run: LoginRun | undefined) {
  if (!run) return [];
  stopPolling(run);
  killChild(run);
  if (run.publishTimer) clearTimeout(run.publishTimer);
  run.publishTimer = undefined;
  return run.onDone.splice(0);
}

export function newRun(backend: Backend, state: LoginState, onDone?: () => void): LoginRun {
  const inherited = retire(runs.get(backend));
  const run: LoginRun = {
    view: { backend, state, output: "", startedAt: Date.now() },
    raw: "",
    polling: false,
    onDone: onDone ? [...inherited, onDone] : inherited,
    lastPublish: 0,
  };
  runs.set(backend, run);
  return run;
}

function setState(run: LoginRun, state: LoginState) {
  run.view.state = state;
  emit(run);
}

export function succeed(run: LoginRun) {
  stopPolling(run);
  killChild(run);
  setState(run, "done");
  for (const callback of run.onDone.splice(0)) {
    try {
      callback();
    } catch (err) {
      console.error("[login] onDone callback failed:", err);
    }
  }
}

export function failRun(run: LoginRun, note?: string) {
  stopPolling(run);
  killChild(run);
  if (note) append(run, `\n${note}\n`);
  setState(run, "failed");
}

export function addCallback(run: LoginRun, onDone?: () => void) {
  if (onDone) run.onDone.push(onDone);
  return snapshot(run);
}

async function onExit(run: LoginRun, child: ChildProcess, code: number | null, signal: NodeJS.Signals | null) {
  // Superseded, cancelled, or switched to Terminal while this process was running.
  if (run.child !== child || !isCurrent(run) || run.view.state !== "running") return;
  run.child = undefined;
  emit(run);

  const status = await authStatus(run.view.backend);
  if (!stillRunning(run)) return;

  if (status.loggedIn) {
    succeed(run);
  } else if (needsTty(clean(run.raw))) {
    append(run, "\nThe CLI needs a terminal for this login, so it's opening in Terminal.\n");
    openLoginInTerminal(run.view.backend);
  } else if (code === 0 && !signal) {
    // Clean exit but the credential isn't visible yet: poll before declaring the login failed.
    startPolling(run, Date.now() + LOGIN_POLL_TIMEOUT_MS);
  } else {
    failRun(run, signal ? `auth login stopped (${signal}).` : `auth login exited with code ${code ?? "unknown"}.`);
  }
}

export function startLogin(backend: Backend, onDone?: () => void): LoginView {
  const existing = runs.get(backend);
  if (existing && (existing.view.state === "running" || existing.view.state === "terminal")) {
    return addCallback(existing, onDone);
  }

  // Codex login requires an interactive terminal for browser/device authorization, and Goose's
  // `configure` is an interactive wizard: both need a real TTY, so they go to a Terminal window.
  if (backend === "codex" || backend === "goose") return openLoginInTerminal(backend, onDone);

  const bin = binary(backend);
  const run = newRun(backend, "running", onDone);
  const child = spawn(bin, ["auth", "login"], { env: cliEnv(), stdio: ["pipe", "pipe", "pipe"] });
  run.child = child;

  const onData = (chunk: Buffer) => {
    if (!isCurrent(run)) return;
    append(run, chunk.toString("utf8"));
    emitSoon(run);
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  // Writing a code after the CLI exits shouldn't crash the server.
  child.stdin.on("error", () => {});

  child.on("error", (err) => {
    if (run.child !== child || !isCurrent(run)) return;
    append(run, `\n${err.message}\n`);
    // The process never started, so no "close" follows.
    if (child.pid === undefined) {
      run.child = undefined;
      failRun(run);
    } else {
      emitSoon(run);
    }
  });
  child.on("close", (code, signal) => {
    void onExit(run, child, code, signal).catch((err: unknown) => {
      if (stillRunning(run)) failRun(run, errMessage(err));
    });
  });

  emit(run);
  return snapshot(run);
}

// Notes on the login in progress why Weft's Puku trial didn't cover it, so the pop-up can offer Weft sign-in.
export function noteTrial(backend: Backend, trial: LoginTrial): void {
  const run = runs.get(backend);
  if (!run) return;
  run.view.trial = trial;
  emit(run);
}

export function sendLoginInput(backend: Backend, text: string): void {
  const run = runs.get(backend);
  const stdin = run?.view.state === "running" ? run.child?.stdin : undefined;
  if (!stdin || !stdin.writable) throw new Error("No login is waiting for a code right now.");
  stdin.write(`${text}\n`);
}

export function cancelLogin(backend: Backend): void {
  const run = runs.get(backend);
  if (!run) return;
  retire(run);
  if (run.view.state === "running" || run.view.state === "terminal") setState(run, "cancelled");
}

export { openLoginInTerminal };
export { authStatus };

export function loginRuns(): LoginView[] {
  return [...runs.values()].map(snapshot);
}
