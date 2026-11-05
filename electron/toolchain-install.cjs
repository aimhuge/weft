// Keeps the shipped toolchain's on-disk dependency trees installed.
//
// What an auto-update actually brings down (Squirrel.Mac replaces the whole .app bundle):
//
//   Resources/app.asar         Electron main's packages, in the derived allow-list — already installed.
//   Resources/server            The Next standalone bundle — already installed.
//   Resources/toolchain/pnpm    A self-contained pnpm — no install needed.
//   Resources/toolchain/npm     npm plus its own node_modules — no install needed.
//   Resources/toolchain/puku    puku-cli's tree, installed at build time — the one tree on disk
//                               whose dependencies are installed separately from the bundle itself.
//
// The puku tree is the gap: scripts/bundle-toolchain.mjs installs it with npm, from a caret range,
// with no lockfile, then prunes packages out of it (telemetry, other platforms' native builds).
// A build that pruned too much, or a registry that moved, leaves a tree that looks installed and
// isn't. Running pnpm install against it re-materialises the tree from its manifest.
//
// This is also the check that the shipped pnpm works at all: the same binary that installs puku's
// tree is the one threads call to install their own dependencies, so an install here proves it.
//
// Not run against the app's own tree: app.asar's packages are already inside the archive, and
// `pnpm install` next to an asar would write a node_modules folder the app never reads.
const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");

// How long an install gets before it's called a failure.
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;
// A tree is "installed" when the package's own bin file is there.
const PUKU_BIN = path.join("node_modules", "@puku", "puku-cli", "bin", "puku-cli");

/**
 * Whether the toolchain's puku tree is present and looks complete.
 *
 * @param {string} toolchainDir the Resources/toolchain directory.
 * @returns {boolean}
 */
function pukuInstalled(toolchainDir) {
  if (!toolchainDir) return false;
  return fs.existsSync(path.join(toolchainDir, "puku", PUKU_BIN));
}

/**
 * The bundled pnpm's entry file, and the Electron binary to run it with.
 *
 * The toolchain's wrappers run on Weft Helper as Node (ELECTRON_RUN_AS_NODE), so macOS shows no
 * second Dock icon and quitting by name still works. The install runs the same way.
 *
 * @param {{ toolchainDir: string, contentsDir: string, execPath?: string }} options
 * @returns {{ bin: string, args: string[] } | null} null when the bundle has no pnpm to run.
 */
function pnpmCommand({ toolchainDir, contentsDir, execPath = process.execPath }) {
  const cli = path.join(toolchainDir, "pnpm", "bin", "pnpm.cjs");
  if (!fs.existsSync(cli)) return null;
  // The Helper app, when it's there: same binary the wrappers use.
  const helper = path.join(contentsDir, "Frameworks", "Weft Helper.app", "Contents", "MacOS", "Weft Helper");
  const bin = fs.existsSync(helper) ? helper : execPath;
  return { bin, args: [cli] };
}

/**
 * Runs the bundled pnpm in a directory, and resolves with what it did.
 *
 * @param {{ toolchainDir: string, contentsDir: string, cwd: string, args: string[], timeoutMs?: number,
 *   spawn?: Function }} options
 * @returns {Promise<PnpmResult>}
 */
function runPnpm({ toolchainDir, contentsDir, cwd, args, timeoutMs = INSTALL_TIMEOUT_MS, spawn }) {
  const spawnFn = spawn || execFile;
  const command = pnpmCommand({ toolchainDir, contentsDir });
  if (!command) return Promise.resolve({ ok: false, code: null, output: "", reason: "the bundled pnpm is missing" });
  return new Promise((resolve) => {
    const child = spawnFn(command.bin, [...command.args, ...args], {
      cwd,
      timeout: timeoutMs,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    });
    let output = "";
    child.stdout?.on("data", (d) => {
      output += String(d);
    });
    child.stderr?.on("data", (d) => {
      output += String(d);
    });
    child.on("error", (err) => resolve({ ok: false, code: null, output, reason: err.message }));
    child.on("close", (code) => resolve({ ok: code === 0, code, output }));
  });
}

/**
 * Installs the toolchain's puku tree with the bundled pnpm.
 *
 * @param {{ toolchainDir: string, contentsDir: string, pnpmRunner: Function, say: Function }} options
 * @returns {Promise<boolean>} whether the tree is installed afterwards.
 */
async function installPukuTree({ toolchainDir, contentsDir, pnpmRunner, say }) {
  say("installing the toolchain's dependencies");
  const result = await pnpmRunner({
    toolchainDir,
    contentsDir,
    cwd: path.join(toolchainDir, "puku"),
    args: ["install", "--prod", "--no-audit", "--no-fund", "--reporter=append-only"],
  });
  const installed = result.ok && pukuInstalled(toolchainDir);
  if (!installed) say(`the toolchain's install failed: ${result.reason || result.output || `exit ${result.code}`}`);
  else say("the toolchain's dependencies are installed");
  return installed;
}

/**
 * What a pnpm run reports back.
 * @typedef {{ ok: boolean, code: number | null, output: string, reason?: string }} PnpmResult
 */

/**
 * Installs the toolchain's puku tree, and checks the bundled pnpm and npm still run.
 *
 * Idempotent: a complete tree is left alone. The install is what the user asked for on update —
 * after Squirrel swaps the bundle, the tree that ships with it is repaired here rather than
 * assumed.
 *
 * @param {{ toolchainDir: string, contentsDir: string, force?: boolean, log?: (text: string) => void,
 *   runPnpm?: (options: { toolchainDir: string, contentsDir: string, cwd: string, args: string[] }) => Promise<PnpmResult> }} options
 * @returns {Promise<{ installed: boolean, needed: boolean, puku: boolean, pnpm: boolean, npm: boolean,
 *   messages: string[] }>}
 */
async function installToolchain({ toolchainDir, contentsDir, force = false, log = () => {}, runPnpm: run }) {
  const messages = [];
  const say = (text) => {
    messages.push(text);
    log(text);
  };

  if (!toolchainDir || !fs.existsSync(toolchainDir)) {
    return { installed: false, needed: false, puku: false, pnpm: false, npm: false, messages: ["the app bundle has no toolchain"] };
  }

  const pnpmRunner = run || ((options) => runPnpm(options));
  const needed = force || !pukuInstalled(toolchainDir);

  // pnpm itself, first: if it doesn't run, the install can't work either, and that is the finding.
  const version = await pnpmRunner({ toolchainDir, contentsDir, cwd: toolchainDir, args: ["--version"] });
  const pnpmOk = version.ok;
  if (!pnpmOk) say(`the bundled pnpm didn't run: ${version.reason || version.output || `exit ${version.code}`}`);

  let installed = false;
  if (pnpmOk && needed) {
    installed = await installPukuTree({ toolchainDir, contentsDir, pnpmRunner, say });
  } else if (pnpmOk) {
    installed = true;
  }

  const npmCli = path.join(toolchainDir, "npm", "bin", "npm-cli.js");
  const npmOk = fs.existsSync(npmCli);

  return { installed, needed, puku: pukuInstalled(toolchainDir), pnpm: pnpmOk, npm: npmOk, messages };
}

module.exports = { installToolchain, installPukuTree, runPnpm, pnpmCommand, pukuInstalled, PUKU_BIN, INSTALL_TIMEOUT_MS };
