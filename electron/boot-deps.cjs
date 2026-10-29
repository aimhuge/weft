// The boot-time dependency step: the app checks its own bundle, and keeps the toolchain's
// dependency trees installed.
//
// Two jobs, one place, so electron/main.cjs stays about the app:
//
// 1. **Check the bundle.** The packages Electron main requires are resolved from inside app.asar.
//    A bundle that arrives broken (an interrupted install, a half-copied update) shows the splash's
//    error state naming what's missing, instead of dying on a require with a native dialog
//    (electron/runtime-deps.cjs).
//
// 2. **Install the toolchain's trees.** Squirrel.Mac replaces the whole .app bundle, so the app's own
//    packages arrive with the update and need no install. The one tree on disk that is installed
//    separately from the bundle is the toolchain's puku tree, so that is what `pnpm install` runs
//    against — after an update, and only then (electron/updated-since.cjs,
//    electron/toolchain-install.cjs).
const path = require("node:path");
const { checkRuntimeDeps, describeMissing } = require("./runtime-deps.cjs");
const { installToolchain } = require("./toolchain-install.cjs");
const { updatedSince, recordVersion } = require("./updated-since.cjs");

/**
 * Runs the boot-time dependency step.
 *
 * @param {{ packaged: boolean, resourcesPath: string, dataDir: string, version: string,
 *   from?: string, log?: (text: string) => void, warn?: (text: string) => void }} options
 *   from: the directory the packages are resolved from — inside the bundle's app.asar in a
 *   packaged app, and the repo's electron/ in dev.
 * @returns {Promise<{ ok: boolean, error?: string, updated?: boolean }>}
 *   ok is false when the bundle is broken, with the message to show.
 */
async function runBootDeps({ packaged, resourcesPath, dataDir, version, from, log = () => {}, warn = () => {} }) {
  // Dev mode runs from the repo, where node_modules is the real one; nothing to check or install.
  if (!packaged) return { ok: true };

  const deps = checkRuntimeDeps(from ? { from } : {});
  if (!deps.ok) return { ok: false, error: describeMissing(deps) };

  const toolchainDir = path.join(resourcesPath, "toolchain");
  const contentsDir = path.join(resourcesPath, "..");
  const updated = updatedSince({ dataDir, version });

  if (updated) {
    // An update landed: the new bundle's toolchain tree is installed here, in the background.
    // The board doesn't wait for it; a thread that needs pnpm finds it installed.
    void installToolchain({ toolchainDir, contentsDir, log: (text) => log(`Weft toolchain: ${text}`) })
      .catch((err) => warn(`Weft toolchain: ${err.message || err}`))
      .finally(() => recordVersion({ dataDir, version }));
    return { ok: true, updated: true };
  }

  // An ordinary relaunch: nothing changed, so nothing is installed. The tree is only checked.
  void installToolchain({ toolchainDir, contentsDir, log: () => {} }).catch(() => {});
  return { ok: true, updated: false };
}

/**
 * The boot-time dependency step, with Electron's own pieces read here.
 *
 * @param {{ dataDir: string, log?: (text: string) => void, warn?: (text: string) => void }} options
 * @returns {Promise<{ ok: boolean, error?: string, updated?: boolean }>}
 */
async function bootDeps({ dataDir, log = () => {}, warn = () => {} }) {
  const { app } = require("electron");
  return runBootDeps({
    packaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    dataDir,
    version: app.getVersion(),
    log,
    warn,
  });
}

module.exports = { runBootDeps, bootDeps };
