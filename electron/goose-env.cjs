// Runs Goose with a provider's key in its env, for the server's Goose runner (docs/architecture/goose.md).
//
// The Next server starts this script with Electron as node and writes one line of JSON to its stdin: the control
// server's url and token, the one-time grant, and the command as argv. It claims the grant from Electron main,
// runs Goose with the key in its env (no shell), and passes its output on with the key swapped for ‹NAME›.
//
// The key never crosses the control server and never sits in the Next server: it goes from main's Keychain into
// this process's env and into Goose's env, and nowhere else. The token and the grant come over stdin, so they
// never sit in a process's environment either.
const { spawn } = require("node:child_process");
const { redactor } = require("./secret-redact.cjs");
const { baseEnv } = require("./secret-run.cjs");

// A partial line waits for the rest of it (a key could straddle two chunks), unless it grows past this.
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
async function main({
  stdin = process.stdin,
  stdout = process.stdout,
  stderr = process.stderr,
  env = process.env,
  fetchImpl = fetch,
  spawnImpl = spawn,
  exit = process.exit,
  onSignal = (sig, fn) => process.on(sig, fn),
} = {}) {
  let request;
  try {
    request = await readStdin(stdin);
    const res = await fetchImpl(`${request.url}/goose/env-claim`, {
      method: "POST",
      headers: { authorization: `Bearer ${request.token}`, "content-type": "application/json" },
      body: JSON.stringify({ grant: request.grant }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    request.values = data.env;
  } catch (err) {
    stderr.write(`Weft couldn't get the Goose provider key: ${err.message}\n`);
    exit(1);
    return;
  }
  const redact = redactor(Object.entries(request.values).map(([name, value]) => ({ name, value })));
  const out = lineRedactor(redact, stdout);
  const errOut = lineRedactor(redact, stderr);
  const child = spawnImpl(request.argv[0], request.argv.slice(1), {
    env: { ...baseEnv(env), ...request.env, ...request.values },
    // `goose run` has no working-directory flag: it takes the folder from the process it runs in.
    // So the card's folder is the child's cwd, or Goose works in the wrong place.
    ...(request.cwd ? { cwd: request.cwd } : {}),
    stdio: ["ignore", "pipe", "pipe"],
  });
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
