// Knows whether the app is running in a bundle an update just replaced.
//
// Squirrel.Mac swaps the whole .app bundle and restarts the app, so "an update landed" is a
// question about versions: the app writes down the version it runs, and the next launch that sees
// a different one knows it came up in a new bundle.
//
// That is the moment the new bundle's dependency trees are installed (electron/toolchain-install.cjs):
// Squirrel brings down the code, but the toolchain's on-disk trees are installed separately from the
// bundle, so they are installed here, once, in the background — the board never waits for it.
const fs = require("node:fs");
const path = require("node:path");

const FILE = "updated-version";

/**
 * The file that holds the version the app last ran.
 *
 * @param {string} dataDir Weft's data directory (~/.weft).
 * @returns {string}
 */
function versionFile(dataDir) {
  return path.join(dataDir, FILE);
}

/**
 * Whether the running version differs from the one last recorded — an update landed since.
 *
 * The first launch after an install has nothing recorded, so it reads as an update: the toolchain
 * is installed then too, which is right — a fresh install's tree is installed by the bundle too.
 *
 * @param {{ dataDir: string, version: string }} options
 * @returns {boolean}
 */
function updatedSince({ dataDir, version }) {
  let previous = "";
  try {
    previous = fs.readFileSync(versionFile(dataDir), "utf8").trim();
  } catch {}
  return previous !== version;
}

/**
 * Records the version the app is running, so the next launch can tell an update from a restart.
 *
 * @param {{ dataDir: string, version: string }} options
 * @returns {boolean} whether the version was written.
 */
function recordVersion({ dataDir, version }) {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(versionFile(dataDir), `${version}\n`);
    return true;
  } catch {
    return false;
  }
}

module.exports = { updatedSince, recordVersion, versionFile, FILE };
