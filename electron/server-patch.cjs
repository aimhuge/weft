// Which server a packaged Weft runs: the one inside the app (Resources/server), or a server patch staged beside it.
//
// A patch is the Next.js server's own code (server.js, the dist folder, public/, Weft's skills) from a newer commit
// on the same app version, unpacked to <userData>/patches/<build>/, with its node_modules a link to the app's own
// (electron/patcher.cjs fetches and stages it). The .app is never written to, so its code signature stays whole.
// current.json names the staged patch; a patch whose server dies within its first minute goes on bad.json and Weft
// falls back to the app's own server. docs/architecture/updates.md#server-patches
const fs = require("node:fs");
const path = require("node:path");

const TRIAL_MS = 60_000; // a patched server that dies sooner than this is dropped
let running = null; // the patch the server was last launched from, or null for the app's own

const patchesDir = (app) => path.join(app.getPath("userData"), "patches");

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

// The packages' fingerprint the app was built with (Resources/server/weft-deps.json, scripts/server-patch-deps.mjs).
function bundledDeps(resourcesPath) {
  return readJson(path.join(resourcesPath, "server", "weft-deps.json"), null)?.hash ?? null;
}

const badBuilds = (app) => readJson(path.join(patchesDir(app), "bad.json"), []);

// The staged patch this app should run, or null. A patch from another app version (left from before an update) is
// cleared away here, so a full update always starts clean.
function stagedPatch(app) {
  const dir = patchesDir(app);
  const current = readJson(path.join(dir, "current.json"), null);
  if (!current?.build) return null;
  if (!current.build.startsWith(`${app.getVersion()}+`)) {
    fs.rmSync(dir, { recursive: true, force: true });
    return null;
  }
  const root = path.join(dir, current.dir);
  if (badBuilds(app).includes(current.build) || !fs.existsSync(path.join(root, "server.js"))) return null;
  return { build: current.build, seq: current.seq, root };
}

// Where the packaged server starts from; remembers the patch it picked, for patchFailed and the version label.
function serverPaths(app, resourcesPath = process.resourcesPath) {
  running = stagedPatch(app);
  const root = running?.root ?? path.join(resourcesPath, "server");
  const plugin = running && fs.existsSync(path.join(running.root, "plugin")) ? path.join(running.root, "plugin") : path.join(resourcesPath, "plugin");
  return { serverJs: path.join(root, "server.js"), pluginDir: plugin, patch: running?.build ?? null };
}

// Called when the packaged server exits on its own: a patched server that died young, or kept dying, goes on the
// bad list, and the next launch runs the app's own server. True when it dropped one.
function patchFailed(app, { livedMs, crashes, maxCrashes }, log) {
  if (!running || (livedMs >= TRIAL_MS && crashes <= maxCrashes)) return false;
  const dir = patchesDir(app);
  writeJson(path.join(dir, "bad.json"), [...new Set([...badBuilds(app), running.build])]);
  fs.rmSync(path.join(dir, "current.json"), { force: true });
  log?.write?.(`--- weft: server patch ${running.build} stopped after ${(livedMs / 1000).toFixed(1)}s; back to the app's own server\n`);
  running = null;
  return true;
}

// Unpacks a downloaded patch tarball and makes it the staged one. `extract(tarPath, dir)` unpacks (tar, injected so
// tests need none). Older patch folders go, except the one the server is running from right now.
function stagePatch(app, details, tarPath, extract, resourcesPath = process.resourcesPath) {
  const dir = patchesDir(app);
  const name = details.build.replace(/[^\w.-]/g, "-");
  const root = path.join(dir, name);
  const temp = `${root}.partial`;
  fs.rmSync(temp, { recursive: true, force: true });
  fs.mkdirSync(temp, { recursive: true });
  extract(tarPath, temp);
  if (!fs.existsSync(path.join(temp, "server.js"))) throw new Error("server patch: no server.js in the tarball");
  fs.symlinkSync(path.join(resourcesPath, "server", "node_modules"), path.join(temp, "node_modules"));
  fs.rmSync(root, { recursive: true, force: true });
  fs.renameSync(temp, root);
  writeJson(path.join(dir, "current.json"), { build: details.build, seq: details.seq, dir: name });
  const keep = new Set([name, running && path.basename(running.root), "current.json", "bad.json"]);
  for (const entry of fs.readdirSync(dir)) if (!keep.has(entry)) fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
  return { build: details.build, seq: details.seq, root };
}

// "0.6.7" for the app's own server, "0.6.7+abc123" for a patch.
const versionLabel = (app) => running?.build ?? app.getVersion();
const runningPatch = () => running;

module.exports = { serverPaths, patchFailed, stagePatch, stagedPatch, bundledDeps, badBuilds, versionLabel, runningPatch, patchesDir, TRIAL_MS };
