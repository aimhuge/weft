// Data mini apps in Electron main (docs/architecture/mini-apps.md): the env grant and the reads for
// pages saved into ~/.weft/apps/<slug>/. The pane's preload (electron/pane-preload.cjs) exposes
// window.weft on file: pages only; this module checks the sender's frame, resolves the URL to that
// folder, loads the manifest and the saved app, decides whether the env is granted, runs the read.
// Values live in the vault, never cross IPC; the page only ever sees rows back.

const path = require("node:path");
const { READ_NAME, runSupabase, runGa4 } = require("./app-data-reads.cjs");
const {
  senderOk,
  appFolderFromUrl,
  readManifest,
  findSavedApp,
  loadApps,
  isInside,
  APPS_DIR,
  APPS_FILE,
  err,
} = require("./app-data-frame.cjs");
const {
  loadGrants,
  saveGrants,
  deriveNeeds,
  manifestNeeds,
  newGrant,
  manifestHash,
  effectiveGrant,
  GRANTS_FILE,
} = require("./app-data-grants.cjs");

// The supabaseUrl a read will use: the manifest's, then a fallback built from readLink(folder).
async function resolveSupabaseUrl(manifest, readLink) {
  if (manifest.supabaseUrl) return manifest.supabaseUrl;
  const link = await readLink(manifest.folder);
  if (!link?.ref) throw err("manifest", `weft-app.json is missing a supabaseUrl and the project's Supabase isn't linked.`);
  return `https://${link.ref}.supabase.co`;
}

// The state the page reads on access/requestAccess/revoke. App, project (vault label), env and
// what the app asks of the vault; missing says what the env still lacks; granted covers the grant.
// missing counts only what the reads need: a viewer's own fetch secret is blank until they fill it.
async function describe({ folder, manifest, saved, grant, vault }) {
  const needs = manifestNeeds(manifest);
  const env = manifest.env;
  const { label, secrets = [] } = await vault.names(manifest.folder);
  const missing = deriveNeeds(manifest.reads).filter((n) => !secrets.some((s) => s.name === n && s.environment === env && !s.missing));
  const granted = Boolean(grant);
  return {
    app: manifest.name,
    project: label,
    env,
    needs,
    missing,
    granted,
    saved: Boolean(saved),
  };
}

function createAppData({ dataDir, vault, readLink, fetch: fetchImpl = globalThis.fetch, now = Date.now }) {
  if (!dataDir) throw new Error("createAppData needs dataDir.");
  if (!vault) throw new Error("createAppData needs the vault.");
  if (typeof readLink !== "function") throw new Error("createAppData needs readLink from electron/supabase.cjs.");

  // Token cache shared across reads, one entry per service account (its cache key is the email).
  const gaTokens = new Map();

  // Resolves a sender frame to { saved, manifest, grant, folder }. Throws otherwise; the IPC layer
  // turns the error into the page's rejection.
  async function resolve(event) {
    if (!event?.senderFrame?.url) throw err("not-weft", "Open this app in Weft on your Mac to load its data.");
    const { folder: realPath, manifestPath } = appFolderFromUrl(dataDir, event.senderFrame.url);
    // folder here is the file's real path; the app folder is its parent.
    const folder = path.dirname(realPath);
    const manifest = readManifest(manifestPath, folder);
    const saved = findSavedApp(dataDir, folder);
    if (!saved) throw err("not-saved", "Save this page as an app on the rail first.");
    const grants = loadGrants(dataDir);
    const grantRaw = grants[folder];
    const grant = effectiveGrant(grantRaw, manifest, manifestNeeds(manifest));
    return { folder, manifest, saved, grant };
  }

  async function access(event) {
    const { folder, manifest, saved, grant } = await resolve(event);
    return describe({ folder, manifest, saved, grant, vault });
  }

  // requestAccess: Touch ID that names the app, project, env and the names it'll read; on yes, write
  // the grant and return the new shape. A granted app just returns the current state without asking.
  async function requestAccess(event) {
    const { folder, manifest, saved, grant } = await resolve(event);
    const needs = manifestNeeds(manifest);
    if (grant) return describe({ folder, manifest, saved, grant, vault });
    const { label } = await vault.names(manifest.folder);
    const reason = `let ${manifest.name} read ${label}'s ${manifest.env} env (${needs.join(", ")})`;
    const ok = await vault.confirm(reason);
    const grants = loadGrants(dataDir);
    if (ok) {
      grants[folder] = newGrant(manifest, needs, now);
      saveGrants(dataDir, grants, now);
    }
    const after = ok ? grants[folder] : null;
    return describe({ folder, manifest, saved, grant: effectiveGrant(after, manifest, needs), vault });
  }

  async function revoke(event) {
    const { folder, manifest, saved } = await resolve(event);
    const grants = loadGrants(dataDir);
    delete grants[folder];
    saveGrants(dataDir, grants, now);
    return describe({ folder, manifest, saved, grant: null, vault });
  }

  // read(name, args): the env must be granted, the read must be in the manifest, args must match.
  // Calls the appropriate read fn with vault values; the page only ever sees rows back.
  async function read(event, rawName, rawArgs) {
    const { manifest, grant } = await resolve(event);
    if (!grant) throw err("not-granted", `Grant ${manifest.env} access first.`);
    const name = String(rawName ?? "");
    if (!READ_NAME.test(name)) throw err("bad-request", `Read name ${JSON.stringify(rawName)} isn't allowed.`);
    const entry = manifest.reads[name];
    if (!entry) throw err("bad-request", `Read ${JSON.stringify(name)} isn't in weft-app.json.`);
    // Only this read's own names: a blank GA4 key mustn't stop the Supabase reads.
    const { values, missing, label } = await vault.valuesFor(manifest.folder, deriveNeeds({ [name]: entry }), manifest.env);
    if (missing.length) {
      const list = missing.join(", ");
      throw err("missing", `${list} ${missing.length === 1 ? "has" : "have"} no value in ${label} · ${manifest.env} yet.`);
    }
    if (entry.supabase) {
      const supabaseUrl = await resolveSupabaseUrl(manifest, readLink);
      const rows = await runSupabase({ supabaseUrl, fn: entry.supabase, declaredArgs: entry.args, pageArgs: rawArgs, values, fetch: fetchImpl });
      return { rows };
    }
    const rows = await runGa4({ body: entry.ga4, values, fetch: fetchImpl, tokens: gaTokens });
    return { rows };
  }

  return { access, requestAccess, revoke, read, resolve };
}

// The IPC handlers. Each one bails out unless the sender is one of the pane's views AND the message
// came from that view's main frame (an iframe inside a saved page can't pretend to be the app).
function registerAppData(ipcMain, { appData, owns }) {
  const handle = (channel, fn) =>
    ipcMain.handle(channel, async (event, ...args) => {
      if (!senderOk(owns, event)) throw new Error("App data only answers the pane's main frame.");
      return fn(event, ...args);
    });
  handle("app-data:access", (event) => appData.access(event));
  handle("app-data:request", (event) => appData.requestAccess(event));
  handle("app-data:revoke", (event) => appData.revoke(event));
  handle("app-data:read", (event, name, args) => appData.read(event, name, args));
}

// Wires app data into Electron main. main.cjs calls this once the vault is up so names/values work.
function setupAppData({ ipcMain, dataDir, vault, owns, readLink = (() => null), fetch: fetchImpl }) {
  const appData = createAppData({ dataDir, vault, readLink, fetch: fetchImpl });
  registerAppData(ipcMain, { appData, owns });
  return appData;
}

module.exports = {
  createAppData,
  registerAppData,
  setupAppData,
  appFolderFromUrl,
  readManifest,
  findSavedApp,
  deriveNeeds,
  manifestHash,
  effectiveGrant,
  loadGrants,
  saveGrants,
  loadApps,
  isInside,
  senderOk,
  APPS_DIR,
  APPS_FILE,
  GRANTS_FILE,
};
