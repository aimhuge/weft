#!/usr/bin/env node
// A worker card's way to GitHub (docs/architecture/connectors.md#connectors-on-a-worker-github-p1-as-built), run as
//   weft-connector-helper.cjs git-credential <get|store|erase>   git's credential helper for https://github.com
//   weft-connector-helper.cjs gh <args…>                          scripts/worker-bin/gh, the gh a card runs (the box's
//                                                                  own gh, untouched, when the connector has no token)
// Both ask the worker daemon's socket (lib/connector-socket.ts) for the card's token, by the capability in the card's
// env. git gets it on stdout, the way every credential helper answers, so it's in no environment. gh gets it as GH_TOKEN
// in one gh process whose env is built from scratch: no NODE_OPTIONS, GIT_*, PAGER, BROWSER, EDITOR or anything else of
// the card's, a PATH and the real gh named by the daemon, and a fresh empty folder for gh's config, data, state and
// cache (GH_CONFIG_DIR, GH_DATA_DIR and the XDG ones), so no alias or extension of the card's runs.
// Nothing is written to disk but that empty folder, removed when gh exits.
const net = require("node:net");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ASK_MS = 30_000;

/** One JSON line to the socket, one back. @returns {Promise<any>} */
function ask(socket, message, connect = net.createConnection) {
  return new Promise((resolve, reject) => {
    if (!socket) return reject(new Error("This isn't a Weft Worker card (no connector socket)."));
    const conn = connect(socket);
    let buf = "";
    const timer = setTimeout(() => conn.destroy(new Error("The worker didn't answer.")), ASK_MS);
    conn.setEncoding("utf8");
    conn.on("connect", () => conn.write(`${JSON.stringify(message)}\n`));
    conn.on("data", (chunk) => (buf += chunk));
    conn.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    conn.on("end", () => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(buf));
      } catch {
        reject(new Error("The worker's answer wasn't JSON."));
      }
    });
  });
}

/** git's key=value lines. */
function parseCredential(text) {
  const out = {};
  for (const line of String(text).split("\n")) {
    const i = line.indexOf("=");
    if (i > 0) out[line.slice(0, i)] = line.slice(i + 1);
  }
  return out;
}

/** git credential <op>: answers get for https://github.com only; erase drops the held token; store does nothing. */
async function gitCredential(op, input, env, io) {
  const want = parseCredential(input);
  if (want.protocol !== "https" || want.host !== "github.com") return 0;
  if (op === "erase") {
    await ask(env.WEFT_CONNECTOR_SOCKET, { cap: env.WEFT_CONNECTOR_CAP, op: "erase" }, io.connect).catch(() => undefined);
    return 0;
  }
  if (op !== "get") return 0;
  try {
    const got = await ask(env.WEFT_CONNECTOR_SOCKET, { cap: env.WEFT_CONNECTOR_CAP, op: "get" }, io.connect);
    if (got.error || !got.token) {
      io.err(`Weft: no GitHub token from the worker: ${got.error || "no answer"}\n`);
      return 0;
    }
    const expiry = Math.floor(Date.parse(got.expiresAt) / 1000);
    io.out(`username=x-access-token\npassword=${got.token}\n${Number.isFinite(expiry) ? `password_expiry_utc=${expiry}\n` : ""}`);
  } catch (err) {
    io.err(`Weft: no GitHub token from the worker: ${err.message}\n`);
  }
  return 0;
}

// gh's global flags that take a value, so the subcommand is found past them (`gh --hostname x auth token`).
const VALUE_FLAGS = new Set(["-R", "--repo", "--hostname"]);
// What a card's gh doesn't run: printing or changing the sign-in, and running code it was told to (aliases, extensions).
const REFUSED = new Set(["auth", "alias", "extension", "extensions", "ext", "config"]);

function firstCommand(args) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (VALUE_FLAGS.has(a)) i++;
    else if (!a.startsWith("-")) return a;
  }
  return null;
}

const KEEP = ["HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "LC_CTYPE", "TERM", "TZ", "TMPDIR", "NO_COLOR", "COLUMNS"];

/** gh's env, from scratch. */
function ghEnv(env, got, configDir) {
  const out = {};
  for (const k of KEEP) if (typeof env[k] === "string") out[k] = env[k];
  return {
    ...out,
    PATH: got.path || "/usr/bin:/bin",
    GH_TOKEN: got.token,
    GH_HOST: "github.com",
    GH_CONFIG_DIR: configDir,
    // gh finds extensions and their state under these: all in the empty folder, so no extension the card installed runs.
    GH_DATA_DIR: configDir,
    XDG_CONFIG_HOME: configDir,
    XDG_DATA_HOME: configDir,
    XDG_STATE_HOME: configDir,
    XDG_CACHE_HOME: configDir,
    GH_PROMPT_DISABLED: "1",
    GH_NO_UPDATE_NOTIFIER: "1",
    GH_SPINNER_DISABLED: "1",
    GH_PAGER: "cat",
    GIT_TERMINAL_PROMPT: "0",
  };
}

async function gh(args, env, io) {
  let got;
  try {
    got = await ask(env.WEFT_CONNECTOR_SOCKET, { cap: env.WEFT_CONNECTOR_CAP, op: "get" }, io.connect);
  } catch (err) {
    got = { error: err.message };
  }
  if (got.error || !got.token) {
    // No connector token (GitHub isn't turned on for this worker, weft.zip isn't set up, or the daemon is down): gh
    // works as it did before the connector, with the card's own env and the box's own sign-in, if any.
    const real = realGh(env, io.exists);
    if (!real) {
      io.err(`Weft: no GitHub token from the worker (${got.error || "no answer"}), and no gh on PATH.\n`);
      return 1;
    }
    return run(io, real, args, env);
  }
  // With the connector's token in use, nothing that prints or changes the sign-in, or runs code it was told to.
  const command = firstCommand(args);
  if (command && REFUSED.has(command)) {
    io.err(`Weft: \`gh ${command}\` isn't available in a worker card while GitHub is Weft's connector, signed in as you.\n`);
    return 1;
  }
  if (!got.gh) {
    io.err("Weft: gh isn't installed on this worker.\n");
    return 1;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-gh-"));
  try {
    return await run(io, got.gh, args, ghEnv(env, got, dir));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Runs gh and answers its exit code. */
function run(io, file, args, env) {
  return new Promise((resolve) => {
    const child = io.spawn(file, args, { stdio: "inherit", env });
    child.on("error", (err) => {
      io.err(`Weft: couldn't run gh: ${err.message}\n`);
      resolve(1);
    });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

const WRAPPER_DIR = path.join(__dirname, "worker-bin");
const executable = (file) => {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
};

/** The real gh on the card's PATH, past this wrapper's folder; null when there's none. */
function realGh(env, exists = executable) {
  for (const dir of String(env.PATH || "").split(path.delimiter)) {
    if (!dir || path.resolve(dir) === WRAPPER_DIR) continue;
    const file = path.join(dir, "gh");
    if (exists(file)) return file;
  }
  return null;
}

/* v8 ignore start -- the process entry */
async function main(argv = process.argv.slice(2), env = process.env) {
  const io = { out: (s) => process.stdout.write(s), err: (s) => process.stderr.write(s), spawn, connect: net.createConnection, exists: undefined };
  if (argv[0] === "git-credential") {
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    return gitCredential(argv[1], Buffer.concat(chunks).toString("utf8"), env, io);
  }
  if (argv[0] === "gh") return gh(argv.slice(1), env, io);
  io.err("Usage: weft-connector-helper.cjs git-credential <op> | gh <args>\n");
  return 2;
}

if (require.main === module) main().then((code) => process.exit(code));
/* v8 ignore stop */

module.exports = { ask, parseCredential, gitCredential, firstCommand, ghEnv, gh, realGh, REFUSED, WRAPPER_DIR };
