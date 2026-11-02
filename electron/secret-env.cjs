// Starts a card's dev server with the vault's development values (lib/devserver.ts, docs/architecture/secrets.md).
// The Next server starts this script with Electron as node and writes one line of JSON to its stdin: the control
// server's url and token, a one-time grant, and the command as argv. It claims the grant from Electron main, runs
// the command with the values in its env (no shell), and passes its output on with every value swapped for
// ‹NAME›. The token and grant come over stdin so they never sit in a process's environment.
const { spawn } = require("node:child_process");
const { redactor } = require("./secret-redact.cjs");
const { baseEnv } = require("./secret-run.cjs");

// A partial line waits for the rest of it (a value could straddle two chunks), unless it grows past this.
const HOLD_CHARS = 8192;

/** @param {NodeJS.ReadableStream} stdin */
function readStdin(stdin) {
  return new Promise((resolve, reject) => {
    let text = "";
    stdin.setEncoding("utf8");
    stdin.on("data", (chunk) => (text += chunk));
    stdin.on("end", () => {
      try {
        resolve(JSON.parse(text));
      } catch (err) {
        reject(err);
      }
    });
  });
}

// Writes redacted whole lines to out, holding a trailing partial line until it's finished.
/** @param {(text: string) => string} redact @param {{ write(chunk: string): unknown }} out */
function lineRedactor(redact, out) {
  let held = "";
  return {
    write(chunk) {
      held += chunk.toString();
      const cut = held.length > HOLD_CHARS ? held.length : held.lastIndexOf("\n") + 1;
      if (!cut) return;
      out.write(redact(held.slice(0, cut)));
      held = held.slice(cut);
    },
    flush() {
      if (held) out.write(redact(held));
      held = "";
    },
  };
}

/**
 * @typedef {{ write(chunk: string): unknown }} Sink
 * @typedef {{ stdout: NodeJS.EventEmitter, stderr: NodeJS.EventEmitter, kill(sig: string): unknown, on(event: string, fn: (...args: any[]) => void): unknown }} Child
 * @param {{
 *   stdin?: NodeJS.ReadableStream, stdout?: Sink, stderr?: Sink, env?: Record<string, string | undefined>,
 *   fetchImpl?: (url: string, init: object) => Promise<{ ok: boolean, statusText?: string, json(): Promise<any> }>,
 *   spawnImpl?: (command: string, args: string[], options: object) => Child,
 *   exit?: (code: number) => unknown, onSignal?: (sig: string, fn: () => void) => unknown,
 * }} [options]
 */
async function main({ stdin = process.stdin, stdout = process.stdout, stderr = process.stderr, env = process.env, fetchImpl = fetch, spawnImpl = spawn, exit = process.exit, onSignal = (sig, fn) => process.on(sig, fn) } = {}) {
  const io = { stdout, stderr, env, spawnImpl, exit, onSignal };
  let request;
  try {
    request = await readStdin(stdin);
    // A Weft Worker's daemon hands the values straight in (lib/worker-dev-env.ts): they came to it sealed from the Mac.
    if (handedIn(request)) return runWith(request, io);
    const res = await fetchImpl(`${request.url}/secrets/claim`, {
      method: "POST",
      headers: { authorization: `Bearer ${request.token}`, "content-type": "application/json" },
      body: JSON.stringify({ grant: request.grant }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    request.values = data.env;
  } catch (err) {
    stderr.write(`Weft couldn't get the vault's secrets: ${err.message}\n`);
    exit(1);
    return;
  }
  runWith(request, io);
}

// Values a Weft Worker's daemon handed in, with no grant to claim.
const handedIn = (request) => !request.grant && Boolean(request.values) && typeof request.values === "object";

// Runs the command with the values in its env only, its output redacted line by line.
function runWith(request, { stdout, stderr, env, spawnImpl, exit, onSignal }) {
  const redact = redactor(Object.entries(request.values).map(([name, value]) => ({ name, value })));
  const out = lineRedactor(redact, stdout);
  const errOut = lineRedactor(redact, stderr);
  const child = spawnImpl(request.argv[0], request.argv.slice(1), { env: { ...baseEnv(env), ...request.env, ...request.values }, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (c) => out.write(c));
  child.stderr.on("data", (c) => errOut.write(c));
  for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"]) onSignal(sig, () => child.kill(sig));
  child.on("error", (err) => {
    stderr.write(`${err.message}\n`);
    exit(1);
  });
  child.on("close", (code, sig) => {
    out.flush();
    errOut.flush();
    exit(code ?? (sig ? 1 : 0));
  });
}

if (require.main === module) main();

module.exports = { main, lineRedactor, readStdin, HOLD_CHARS };
