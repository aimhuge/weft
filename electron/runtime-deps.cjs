// Checks that the packages Electron main needs are really present, before anything requires them.
//
// On 2026-10-28 the shipped app died on launch with "Cannot find module '@supabase/supabase-js'":
// electron-builder's build.files allow-list had dropped the package, and the crash was a native
// "A JavaScript error occurred in the main process" dialog with nothing the user could act on.
// The allow-list is derived now (scripts/electron-runtime-deps.mjs) and checked against the built
// asar (scripts/verify-packaged-app.cjs), but a packaged app can still meet a broken bundle — an
// interrupted install, a half-copied update — so the app checks itself at boot and says what is
// missing instead of dying on a require.
//
// **The check reads the bundle, not the machine.** Inside app.asar, Node's resolution walks out of
// the archive and finds the real node_modules next to the app (or the repo's, when Weft runs from
// source), so a plain require.resolve() there says "found" for a package the bundle doesn't have.
// That is the same trap scripts/verify-packaged-app.cjs documents, and it made the first version of
// this check pass on a bundle missing the Supabase client. So the check asks the bundle itself:
// Electron's patched filesystem reads an archive as a folder, so the package's manifest is a real
// file inside it and fs.existsSync on it is the honest answer.
const fs = require("node:fs");
const path = require("node:path");

// The packages Electron main requires, and the ones that must exist for the app to run at all.
// Kept in step with the derived allow-list by electron/runtime-deps.test.ts.
const REQUIRED = [
  "@supabase/supabase-js",
  "libsodium-wrappers",
  "node-pty",
];

// Every package's main entry, checked by requiring it. Requiring a package is the real test:
// a package can be present but unloadable (a pruned native build, a missing transitive dep).
const LOADABLE = ["@supabase/supabase-js", "libsodium-wrappers"];

/**
 * The asar archive a directory sits in, or null when it isn't inside one.
 *
 * @param {string} dir
 * @returns {string | null} the archive's path.
 */
function asarOf(dir) {
  const match = /^(.*\.asar)(?=[\\/])/.exec(dir || "");
  return match ? match[1] : null;
}

/**
 * The folder a package would be in, seen from where the app runs.
 *
 * Inside an archive, that's the archive's own node_modules; outside it, the real one.
 *
 * @param {string} specifier
 * @param {string} from
 * @returns {string}
 */
function packageDir(specifier, from) {
  const archive = asarOf(from);
  const root = archive ? path.join(archive, "node_modules") : path.join(from, "..", "node_modules");
  return path.join(root, ...specifier.split("/"));
}

/**
 * Resolves a package the way a require() in that directory would.
 *
 * @param {string} specifier
 * @param {string} [from] the directory to resolve from; Electron main's own by default.
 * @returns {boolean} whether the package is there.
 */
function canResolve(specifier, from = __dirname) {
  // The manifest is the test: a package with no manifest can't be required.
  const manifest = path.join(packageDir(specifier, from), "package.json");
  if (fs.existsSync(manifest)) return true;
  if (asarOf(from)) return false; // inside an archive, the filesystem is the archive; there is no elsewhere
  try {
    // Outside an archive (dev mode): Node's own resolution, which follows exports/main.
    require.resolve(specifier, { paths: [from] });
    return true;
  } catch {
    return false;
  }
}

/**
 * Requires a package the way the app would, from the directory it runs in.
 *
 * @param {string} specifier
 * @param {string} from
 */
function loadFrom(specifier, from) {
  const dir = packageDir(specifier, from);
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
  const main = pkg.main || "index.js";
  return require(path.join(dir, main.replace(/^\.\//, "")));
}

/**
 * Checks the packages the app needs, without letting a failure take the process down.
 *
 * @param {{ from?: string, load?: boolean }} options
 *   from: the directory to resolve from (Electron main's own by default).
 *   load: also require() each loadable package, to catch one that is present but broken.
 * @returns {{ ok: boolean, missing: string[], unloadable: string[], checked: string[] }}
 */
function checkRuntimeDeps({ from = __dirname, load = true } = {}) {
  const missing = [];
  const unloadable = [];
  const checked = [];

  for (const name of REQUIRED) {
    checked.push(name);
    if (!canResolve(name, from)) {
      missing.push(name);
      continue;
    }
    if (!load || !LOADABLE.includes(name)) continue;
    try {
      loadFrom(name, from);
    } catch (err) {
      unloadable.push(`${name} (${err.message || err})`);
    }
  }

  return { ok: missing.length === 0 && unloadable.length === 0, missing, unloadable, checked };
}

/**
 * The message a user sees when the app can't find what it needs. Names the packages, because the
 * only fix is a fresh install of the same version — and saying which ones makes that legible.
 *
 * @param {{ missing: string[], unloadable: string[] }} report
 * @returns {string}
 */
function describeMissing(report) {
  const parts = [];
  if (report.missing.length) parts.push(`missing from the app bundle: ${report.missing.join(", ")}`);
  if (report.unloadable.length) parts.push(`present but won't load: ${report.unloadable.join("; ")}`);
  return `Weft couldn't find some of its own files (${parts.join("; ")}). Reinstall Weft to repair it.`;
}

module.exports = { checkRuntimeDeps, canResolve, describeMissing, packageDir, asarOf, REQUIRED, LOADABLE };
