// weft.fetch / weft.env / weft.requestSecret for data mini apps in Electron main
// (docs/architecture/mini-app-hosting.md). The pane's preload (electron/pane-preload.cjs) exposes
// the three methods on a `file:` page only; this module checks the sender's frame the same way
// app-data.cjs does, parses the manifest's policy, runs runFetch, and answers the AppFetchResult.
// Values live in the vault, never cross IPC; the page only ever sees masked answers back.

const path = require("node:path");
const dns = require("node:dns");
const { runFetch } = require("./app-fetch-run.cjs");
const { parsePolicy } = require("./app-fetch-policy.cjs");
const {
  senderOk,
  appFolderFromUrl,
  readManifest,
  findSavedApp,
  err,
} = require("./app-data-frame.cjs");
const { loadGrants, saveGrants, manifestNeeds, newGrant, effectiveGrant } = require("./app-data-grants.cjs");

// What the page may call weft.fetch with: the bridge's AppFetchRequest (lib/app-bridge.ts) with
// optional body. Headers must be a flat string map; a non-string value is refused upstream.
function cleanRequest(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw err("bad-request", "request must be an object.");
  if (typeof raw.url !== "string" || !raw.url) throw err("bad-request", "url is missing.");
  const method = typeof raw.method === "string" && raw.method ? raw.method.toUpperCase() : "GET";
  const headers = {};
  if (raw.headers && (typeof raw.headers !== "object" || Array.isArray(raw.headers))) {
    throw err("bad-request", "headers must be an object.");
  }
  if (raw.headers) {
    for (const [name, value] of Object.entries(raw.headers)) {
      if (typeof value !== "string") throw err("bad-request", `header ${JSON.stringify(name)} value isn't a string.`);
      headers[String(name).toLowerCase()] = value;
    }
  }
  const body = typeof raw.body === "string" ? raw.body : undefined;
  return { url: raw.url, method, headers, body };
}

// Builds the getValues function runFetch uses: for each name the placeholders asked for, look
// up the value in the granted env's vault. A `from: "viewer"` name resolves from the viewer's
// own vault (the Mac) just like an author name, since there's no other viewer on the Mac. ensure
// is the env grant: it runs before any value leaves the vault.
function makeGetValues({ vault, folder, env, ensure = async () => {} }) {
  return async (asked) => {
    if (!asked.length) return {};
    await ensure();
    const out = {};
    const { values } = await vault.valuesFor(folder, asked, env);
    for (const n of asked) {
      if (n in values) out[n] = values[n];
    }
    return out;
  };
}

function createAppDataFetch({ dataDir, vault, fetch: fetchImpl = globalThis.fetch, lookup = dns.promises.lookup.bind(dns.promises), now = Date.now }) {
  if (!dataDir) throw new Error("createAppDataFetch needs dataDir.");
  if (!vault) throw new Error("createAppDataFetch needs the vault.");

  // Resolves a sender frame the same way app-data.cjs does: file: under <dataDir>/apps/<slug>/,
  // with a weft-app.json, and the folder saved as a mini app.
  async function resolve(event) {
    if (!event?.senderFrame?.url) throw err("not-weft", "Open this app in Weft on your Mac to use its data.");
    const { folder: realPath, manifestPath } = appFolderFromUrl(dataDir, event.senderFrame.url);
    const folder = path.dirname(realPath);
    const manifest = readManifest(manifestPath, folder);
    const saved = findSavedApp(dataDir, folder);
    if (!saved) throw err("not-saved", "Save this page as an app on the rail first.");
    return { folder, manifest, saved };
  }

  // A value leaves the vault (a filled fetch, weft.env) only under the env grant the named reads use,
  // over every name the manifest may hand out. Threads may edit ~/.weft/apps, so without it a thread
  // could add `"public": ["SUPABASE_SECRET_KEY"]` and read the value off the page (2026-10-29). With no
  // live grant, main asks Touch ID itself, naming the names, so a fetch-only page needs no grant bar.
  // Calls that arrive while it asks share the one prompt.
  const asking = new Map();
  async function askGrant(folder, manifest, needs) {
    const { label } = await vault.names(manifest.folder);
    const ok = await vault.confirm(`let ${manifest.name} use ${label}'s ${manifest.env} env (${needs.join(", ")})`);
    if (!ok) return false;
    const grants = loadGrants(dataDir);
    grants[folder] = newGrant(manifest, needs, now);
    saveGrants(dataDir, grants, now);
    return true;
  }
  async function ensureGrant(folder, manifest) {
    const needs = manifestNeeds(manifest);
    if (effectiveGrant(loadGrants(dataDir)[folder], manifest, needs)) return;
    if (!asking.has(folder)) asking.set(folder, askGrant(folder, manifest, needs).finally(() => asking.delete(folder)));
    if (!(await asking.get(folder))) throw err("not-granted", `Grant ${manifest.env} access first.`);
  }

  // weft.fetch: parse the request, run the policy, fill the placeholders, send, mask, return.
  // The page only ever sees the masked body and the allowlisted headers; the secret values
  // travel through the manifest's getValues and never enter the page's context.
  async function fetch(event, rawRequest) {
    const { folder, manifest } = await resolve(event);
    const request = cleanRequest(rawRequest);
    // parsePolicy drops malformed rules with problems; an empty secrets map means weft.fetch
    // is still bound to one allowed URL via anyRuleAllows (a placeholder-less request).
    const policy = parsePolicy(manifest);
    const env = manifest.env;
    const getValues = makeGetValues({ vault, folder, env, ensure: () => ensureGrant(folder, manifest) });
    const result = await runFetch({ policy, request, getValues, fetch: fetchImpl, lookup });
    return result;
  }

  // weft.env: the values the manifest declared in `public`. The page only ever sees the
  // values for those names; a name missing in the vault simply doesn't appear in the map.
  async function env(event) {
    const { folder, manifest } = await resolve(event);
    const policy = parsePolicy(manifest);
    const names = policy.public;
    if (!names.length) return {};
    await ensureGrant(folder, manifest);
    const { values } = await vault.valuesFor(folder, names, manifest.env);
    return { ...values };
  }

  // weft.requestSecret(name): a from: "viewer" name in the manifest. On the Mac the viewer is
  // you, so the value lives in your own vault. If the vault has a value, { set: true }; if
  // not, the name is added as a blank in the granted env (so the rail's count goes up) and
  // { set: false } comes back so the app can say "fill it in 🔐".
  async function requestSecret(event, rawName) {
    const { folder, manifest } = await resolve(event);
    const name = String(rawName ?? "");
    if (!name) throw err("bad-request", "name is missing.");
    const policy = parsePolicy(manifest);
    const rule = policy.secrets[name];
    if (!rule) throw err("bad-request", `${name} isn't in the manifest.`);
    if (rule.from !== "viewer") throw err("bad-request", `${name} isn't a viewer-provided secret.`);
    const { values } = await vault.valuesFor(folder, [name], manifest.env);
    if (name in values) return { set: true };
    // Add the blank with a hint that names the app and its allowed hosts, so the user knows
    // what the value will be used for when they fill it in. source = "an app" puts a marker
    // in the audit trail without naming a thread.
    const hint = `${manifest.name} will use ${name} with ${rule.hosts.map((h) => (h.kind === "wildcard" ? `*.${h.base}` : h.name)).join(", ")}.`;
    if (typeof vault.addBlanks === "function") await vault.addBlanks(folder, [name], [manifest.env], { source: "an app", hint });
    return { set: false };
  }

  return { fetch, env, requestSecret, resolve };
}

// The IPC handlers. Each one bails out unless the sender is one of the pane's views AND the
// message came from that view's main frame (an iframe inside a saved page can't pretend to
// be the app). Mirrors registerAppData in app-data.cjs.
function registerAppDataFetch(ipcMain, { appDataFetch, owns }) {
  const handle = (channel, fn) =>
    ipcMain.handle(channel, async (event, ...args) => {
      if (!senderOk(owns, event)) throw new Error("App data only answers the pane's main frame.");
      return fn(event, ...args);
    });
  handle("app-data:fetch", (event, request) => appDataFetch.fetch(event, request));
  handle("app-data:env", (event) => appDataFetch.env(event));
  handle("app-data:request-secret", (event, name) => appDataFetch.requestSecret(event, name));
}

// Wires app-data-fetch into Electron main. main.cjs calls this once the vault is up.
function setupAppDataFetch({ ipcMain, dataDir, vault, owns, fetch: fetchImpl }) {
  const appDataFetch = createAppDataFetch({ dataDir, vault, fetch: fetchImpl });
  registerAppDataFetch(ipcMain, { appDataFetch, owns });
  return appDataFetch;
}

module.exports = {
  createAppDataFetch,
  registerAppDataFetch,
  setupAppDataFetch,
  cleanRequest,
  makeGetValues,
};
