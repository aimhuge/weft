// A connector's CLI on a Weft Worker, run with its token (docs/architecture/project-hosts.md#the-vault-and-connectors-on-a-worker-t2-as-built).
// The daemon writes a shim for gog or gh into connectors/bin on the cards' PATH (lib/worker-connectors.ts); the shim runs
// this with plain node. It opens the token the daemon stored sealed to the box's key, and runs the real CLI it recorded
// (never one the caller names) with the token in that process's env only. The CLI's own ways to print it or run other
// code with it are refused: `auth` (gh auth token, git-credential), aliases and extensions; gh and gog also get a
// config and data folder of their own in the sealed home, so an alias or extension a thread planted elsewhere never runs.
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { CONNECTORS } = require("./connector-wire.cjs");
const { open } = require("./worker-seal.cjs");

// gog's flags that take a value, so the subcommand after them can be found.
const VALUE_FLAGS = new Set(["-a", "--account", "--client", "--home", "--access-token", "--quota-project", "--enable-commands", "--enable-commands-exact", "--disable-commands", "--select", "--color"]);
const REFUSED = new Set(["auth", "alias", "extension", "ext", "config"]);

/** The CLI's subcommand: the first word that isn't a flag or a flag's value. @param {string[]} args */
function subcommand(args) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith("-")) return a;
    if (VALUE_FLAGS.has(a)) i++;
  }
  return "";
}

/** Why this run is refused, or null. @param {string} connector @param {string[]} args */
function refusal(connector, args) {
  const sub = subcommand(args);
  if (!REFUSED.has(sub)) return null;
  return `${CONNECTORS[connector].bin} ${sub} isn't available to a card on this worker: its sign-in comes from your Mac (Settings → Devices), and the token stays out of threads.`;
}

// The token the daemon stored for a connector, opened, or a string that says why there's none to use.
function storedToken(home, connector, spec, now) {
  let entry;
  let keys;
  try {
    entry = JSON.parse(fs.readFileSync(path.join(home, "connectors.json"), "utf8"))[connector];
    keys = JSON.parse(fs.readFileSync(path.join(home, "seal-key.json"), "utf8"));
  } catch {
    entry = null;
  }
  if (!entry?.sealed || !entry.bin) return `${spec.label} is off for this worker. Turn it on from your Mac: Settings → Devices.`;
  if (!(entry.expiresAt > now)) return `${spec.label}'s token on this worker has expired. Your Mac sends a fresh one while it's on and signed in to Weft.`;
  try {
    return { bin: entry.bin, token: JSON.parse(open(keys, entry.sealed, `connector-store:${connector}`)) };
  } catch {
    return `${spec.label}'s token on this worker won't open. Turn it off and on again from your Mac.`;
  }
}

// The CLI's variables: the token (and gog's account), and a config and data folder of its own in the sealed home.
function childVars(base, home, connector, spec, token) {
  const own = path.join(home, "connectors", connector);
  const isolated = connector === "gh" ? { GH_CONFIG_DIR: path.join(own, "config"), XDG_DATA_HOME: path.join(own, "data") } : { GOG_HOME: own };
  return { ...base, ...isolated, [spec.env]: token.token, ...(spec.accountEnv && token.account ? { [spec.accountEnv]: token.account } : {}) };
}

/**
 * @param {{ argv?: string[], env?: Record<string, string | undefined>, spawnImpl?: typeof spawn, exit?: (code: number) => unknown, stderr?: { write: (s: string) => unknown }, now?: () => number }} [options]
 */
function main({ argv = process.argv.slice(2), env = process.env, spawnImpl = spawn, exit = process.exit, stderr = process.stderr, now = Date.now } = {}) {
  const fail = (message) => {
    stderr.write(`${message}\n`);
    exit(1);
  };
  const [home = "", connector = "", ...args] = argv;
  const spec = Object.hasOwn(CONNECTORS, connector) ? CONNECTORS[connector] : null;
  if (!spec) return fail("Unknown connector.");
  const why = refusal(connector, args);
  if (why) return fail(why);
  const found = storedToken(home, connector, spec, now());
  if (typeof found === "string") return fail(found);
  const child = spawnImpl(found.bin, args, { stdio: "inherit", env: childVars(env, home, connector, spec, found.token) });
  child.on("error", (err) => fail(err.message));
  child.on("exit", (code, sig) => exit(code ?? (sig ? 1 : 0)));
}

if (require.main === module) main();

module.exports = { main, refusal, subcommand };
