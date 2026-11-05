// Running one command with vault values in its env, and the reply a thread gets back (docs/architecture/secrets.md).
// Shared by Electron main's runs (electron/secret-run.cjs) and a Weft Worker's (lib/worker-secret-run.ts), so both
// spawn the same way: no shell, the values in the child's env only, the output redacted, then cut to the reply's size.
const { redactor } = require("./secret-redact.cjs");

// Output kept while a command runs, and what goes back to the thread.
const KEEP_CHARS = 1_000_000;
const REPLY_CHARS = 20_000;
// After SIGTERM on a timeout, how long before SIGKILL.
const KILL_GRACE_MS = 3000;
// Weft's own variables don't go to the commands it runs.
const INTERNAL = /^(WEFT_SHELL_|ELECTRON_RUN_AS_NODE$)/;

function baseEnv(env) {
  return Object.fromEntries(Object.entries(env).filter(([k]) => !INTERNAL.test(k)));
}

/**
 * @typedef {{ exitCode: number | null, signal: string | null, timedOut: boolean, output: string, cut: boolean, ms: number }} ExecResult
 * @param {{ spawn: Function, env?: Record<string, string | undefined>, now?: () => number, setTimer?: Function, clearTimer?: Function, killGraceMs?: number }} deps
 */
function createExec({ spawn, env = process.env, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, killGraceMs = KILL_GRACE_MS }) {
  /**
   * @param {{ argv: string[], cwd: string, env?: Record<string, string>, values: Record<string, string>, timeoutMs: number }} request
   * @returns {Promise<ExecResult>}
   */
  function execute({ argv, cwd, env: extra, values, timeoutMs }) {
    return new Promise((resolve) => {
      const started = now();
      let out = "";
      let cut = false;
      let timedOut = false;
      let child;
      const add = (chunk) => {
        out += chunk.toString();
        if (out.length > KEEP_CHARS) {
          out = out.slice(-KEEP_CHARS);
          cut = true;
        }
      };
      const signal = (sig) => {
        try {
          process.kill(-child.pid, sig);
        } catch {
          child.kill(sig);
        }
      };
      let killTimer;
      const timer = setTimer(() => {
        timedOut = true;
        signal("SIGTERM");
        killTimer = setTimer(() => signal("SIGKILL"), killGraceMs);
      }, timeoutMs);
      const finish = (exitCode, sig) => {
        clearTimer(timer);
        clearTimer(killTimer);
        resolve({ exitCode, signal: sig, timedOut, output: out, cut, ms: now() - started });
      };
      try {
        child = spawn(argv[0], argv.slice(1), { cwd, env: { ...baseEnv(env), ...extra, ...values }, detached: true, stdio: ["ignore", "pipe", "pipe"] });
      } catch (err) {
        out = err.message;
        finish(null, null);
        return;
      }
      child.stdout.on("data", add);
      child.stderr.on("data", add);
      child.on("error", (err) => {
        add(`${err.message}\n`);
        finish(null, null);
      });
      child.on("close", (code, sig) => finish(code, sig));
    });
  }
  return { execute };
}

// Redacted first, then cut to the reply's size; a cut start drops its first line, which could hold part of a value.
/** @param {ExecResult} result @param {{ name: string, value: string }[]} entries @param {string} label */
function reply(result, entries, label) {
  let output = redactor(entries)(result.output);
  let truncated = result.cut;
  if (output.length > REPLY_CHARS) {
    output = output.slice(-REPLY_CHARS);
    truncated = true;
  }
  if (truncated) output = output.slice(output.indexOf("\n") + 1);
  return { label, exitCode: result.exitCode, signal: result.signal, timedOut: result.timedOut, output, truncated, ms: result.ms };
}

module.exports = { createExec, reply, baseEnv, KEEP_CHARS, REPLY_CHARS, KILL_GRACE_MS };
