import { execFile } from "node:child_process";
import type { Backend, LoginView } from "./types";
import {
  addCallback,
  append,
  authStatus,
  binary,
  emit,
  failRun,
  isCurrent,
  newRun,
  POLL_MS,
  runs,
  stopPolling,
  succeed,
  TERMINAL_WAIT_MS,
} from "./login";

// When the CLI's `auth login` needs a real TTY (Ink-based login, or the user wants a Terminal
// window) we shell out to Terminal.app on macOS via osascript. The AppleScript launches a new
// Terminal window that runs `<cli> auth login`, and we poll `auth status` until it reports
// `loggedIn: true` (or the user cancels, or the deadline passes).

// AppleScript string literal: backslashes and double quotes need escaping.
function appleScriptString(text: string) {
  return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

// POSIX shell single-quoting, for the command Terminal runs.
function shellQuote(text: string) {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

function snapshot(run: { view: LoginView }): LoginView {
  return { ...run.view };
}

export function openLoginInTerminal(backend: Backend, onDone?: () => void): LoginView {
  const existing = runs.get(backend);
  if (existing && existing.view.state === "terminal") return addCallback(existing, onDone);

  // Keep the output so far, so the pop-up still shows why Terminal opened.
  const previous = existing?.raw ?? "";
  const run = newRun(backend, "terminal", onDone);
  run.raw = previous;

  if (process.platform !== "darwin") {
    failRun(run, "Logging in through Terminal only works on macOS.");
    return snapshot(run);
  }

  let bin: string;
  try {
    bin = binary(backend);
  } catch (err) {
    failRun(run, err instanceof Error ? err.message : String(err));
    return snapshot(run);
  }

  // Each CLI's own login command: Codex has device auth, Goose has an interactive `configure`
  // wizard, and the rest have `auth login`.
  const command = backend === "codex"
    ? `${shellQuote(bin)} login --device-auth`
    : backend === "goose"
      ? `${shellQuote(bin)} configure`
      : `${shellQuote(bin)} auth login`;
  const script = ["tell application \"Terminal\"", `do script ${appleScriptString(command)}`, "activate", "end tell"];
  append(run, `\nOpened Terminal to run: ${command}\n`);
  execFile(
    "/usr/bin/osascript",
    script.flatMap((line) => ["-e", line]),
    { timeout: 30_000 },
    (err, _stdout, stderr) => {
      if (!err || !isCurrent(run) || run.view.state !== "terminal") return;
      failRun(run, `Couldn't open Terminal: ${stderr.trim() || err.message}`);
    },
  );

  const deadline = Date.now() + TERMINAL_WAIT_MS;
  run.poll = setInterval(() => {
    if (!isCurrent(run) || run.view.state !== "terminal") {
      stopPolling(run);
      return;
    }
    if (Date.now() > deadline) {
      failRun(run, "Stopped waiting for the Terminal login after 10 minutes.");
      return;
    }
    if (run.polling) return;
    run.polling = true;
    void authStatus(backend)
      .then((status) => {
        if (status.loggedIn && isCurrent(run) && run.view.state === "terminal") succeed(run);
      })
      .finally(() => {
        run.polling = false;
      });
  }, POLL_MS);

  emit(run);
  return snapshot(run);
}
