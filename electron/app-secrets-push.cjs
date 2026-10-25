// Upload secrets from the Mac to weft.zip for a hosted mini app
// (docs/architecture/mini-app-hosting.md): when the Share dialog's "Upload secrets" button is
// pressed, the board calls apps:push-secrets, main reads the manifest's author secrets and
// public names from the app's vault env, asks Touch ID once, and POSTs the values to
// https://weft.zip/api/apps/secrets with the account's Supabase access token. The values stay
// in main; the board only sees the names that went up. Touch ID is asked once for the whole
// push (so a name the vault doesn't have a value for is skipped, not refused), and the names
// are the ones the manifest declared, not whatever the manifest might have later added.

const fs = require("node:fs");
const path = require("node:path");
const { APPS_FILE, loadApps } = require("./app-data-frame.cjs");
const { parsePolicy } = require("./app-fetch-policy.cjs");
const { deriveNeeds } = require("./app-data-grants.cjs");
const { createPushedLedger } = require("./app-secrets-pushed.cjs");

// The session JSON the Supabase client stores (lib/account.ts, "weft-auth" key). Returns the
// access_token; the refresh_token lives next to it but is for the client to use, not main.
function accessTokenFrom(account) {
  const session = account?.["weft-auth"];
  if (!session) return null;
  let parsed;
  try {
    parsed = typeof session === "string" ? JSON.parse(session) : session;
  } catch {
    return null;
  }
  const token = parsed?.access_token;
  return typeof token === "string" && token ? token : null;
}

// What hosts the manifest's secrets are allowed to talk to, by name. Used in the Touch ID
// sheet so the user sees where each name will go. Skips from: "viewer" names (they live in
// the viewer's own vault, not the app's) so the sheet only names values we're about to push.
function pushTargets(policy, reads = {}) {
  const out = [];
  const needs = deriveNeeds(reads);
  if (needs.length) out.push(`${needs.join(", ")} → the app's reads`);
  for (const [name, rule] of Object.entries(policy.secrets)) {
    if (rule.from === "viewer") continue;
    const hosts = rule.hosts.map((h) => (h.kind === "wildcard" ? `*.${h.base}` : h.name));
    out.push(`${name} → ${hosts.join(", ")}`);
  }
  for (const name of policy.public) out.push(`public ${name}`);
  return out;
}

// Reads the saved app by id from ~/.weft/apps.json. The store's other readers (app-data.cjs)
// look up the app by its folder, not its id, so this loader is the push's own.
function findApp(dataDir, id) {
  const apps = loadApps(dataDir);
  return apps.find((a) => a && typeof a === "object" && a.id === id) || null;
}

// Finds the manifest next to a saved app's page. The page URL is `file://…/apps/<slug>/<entry>`;
// the manifest is the file's parent. Returns the parsed manifest and the project folder, or
// throws a plain-English error the dialog can show.
function readAppManifest(dataDir, app) {
  let url;
  try {
    url = new URL(app.url);
  } catch {
    throw new Error("This app's URL isn't valid.");
  }
  if (url.protocol !== "file:") throw new Error("Upload secrets is for folder apps saved from your Mac.");
  let real;
  try {
    real = fs.realpathSync(decodeURIComponent(url.pathname));
  } catch {
    throw new Error("This app's folder no longer exists on your Mac.");
  }
  const folder = path.dirname(real);
  // The apps dir is the only place we trust; the rest of the file tree isn't ours. isInside
  // realpath's both sides so macOS's /var/folders/... → /private/var/folders/... symlink (and
  // any dataDir under it) doesn't fool the startsWith.
  const { isInside } = require("./app-data-frame.cjs");
  const appsDir = path.join(dataDir, "apps");
  if (!isInside(appsDir, folder)) {
    throw new Error("This app's folder is outside Weft's apps directory.");
  }
  const manifestPath = path.join(folder, "weft-app.json");
  if (!fs.existsSync(manifestPath)) throw new Error("This app has no weft-app.json.");
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (e) {
    throw new Error(`weft-app.json isn't valid JSON: ${e.message}`);
  }
  return { manifest, folder };
}

// Returns the names whose values the push will send: the manifest's author secrets
// (from missing or "author"), the keys its named reads run with on weft.zip (deriveNeeds,
// the same list the Mac's grant sheet shows), then its public names. Viewer secrets and
// undeclared names are not pushed.
function namesToPush(policy, reads = {}) {
  const names = [];
  for (const [name, rule] of Object.entries(policy.secrets)) {
    if (rule.from === "viewer") continue;
    names.push(name);
  }
  for (const name of deriveNeeds(reads)) {
    if (!names.includes(name)) names.push(name);
  }
  for (const name of policy.public) {
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

// The vault the Mac's reads use: the manifest's `folder` (the project it reads for), else the app folder
// (readManifest in app-data-frame.cjs). An app under ~/.weft/apps isn't a git repo, so its own vault is empty.
function vaultFolderOf(manifest, appFolder) {
  return typeof manifest.folder === "string" && manifest.folder ? manifest.folder : appFolder;
}

// The saved app, its manifest and the names a push for it would send, or { error } saying why there's nothing to push.
function whatToPush(dataDir, appId) {
  if (!appId || typeof appId !== "string") return { error: "appId is missing." };
  const app = findApp(dataDir, appId);
  if (!app) return { error: "No such app." };
  if (!app.share || !app.share.id) return { error: "Share the app first." };
  let found;
  try {
    found = readAppManifest(dataDir, app);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  const { manifest, folder } = found;
  const policy = parsePolicy(manifest);
  const reads = manifest.reads && typeof manifest.reads === "object" ? manifest.reads : {};
  return { app, manifest, folder, policy, reads, names: namesToPush(policy, reads) };
}

function createAppSecretsPush({ dataDir, vault, account, confirm, fetch: fetchImpl = globalThis.fetch }) {
  if (!dataDir) throw new Error("createAppSecretsPush needs dataDir.");
  if (!vault) throw new Error("createAppSecretsPush needs the vault.");
  if (typeof confirm !== "function") throw new Error("createAppSecretsPush needs confirm (Touch ID).");
  if (typeof account !== "function") throw new Error("createAppSecretsPush needs an account getter.");
  if (typeof fetchImpl !== "function") throw new Error("createAppSecretsPush needs a fetch.");
  const ledger = createPushedLedger(dataDir);
  const inflight = new Map();

  // POSTs the values to weft.zip. Returns { ok: true } or { error }. Broken out so push itself
  // stays under the complexity budget — the function shape lives in two error paths only.
  async function postSecrets({ shareId, values, token }) {
    let res;
    try {
      res = await fetchImpl("https://weft.zip/api/apps/secrets", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ shareId, values }),
      });
    } catch (e) {
      return { error: `Couldn't reach weft.zip: ${e instanceof Error ? e.message : String(e)}` };
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { error: `weft.zip answered ${res.status}${text ? `: ${text.slice(0, 300)}` : ""}.` };
    }
    return { ok: true };
  }

  // Asks Touch ID for the whole push; returns null when confirmed, an error object otherwise.
  async function confirmPush({ manifest, count, label, targets }) {
    const targetText = targets.length ? ` (weft.zip will use ${targets.join("; ")})` : "";
    const ok = await confirm(`send ${count} ${count === 1 ? "secret" : "secrets"} from ${manifest.name} (${label}) to weft.zip${targetText}`);
    if (!ok) return { error: "Touch ID declined." };
    return null;
  }

  // Reads the app, its manifest, the names and their values, asks Touch ID once, and POSTs the
  // values to weft.zip. Returns { ok, pushed, missing } or { error }. A name with no value in
  // the vault is skipped (not refused) and listed in `missing` so the dialog can say so.
  // ifChanged is Share… syncing on its own (lib/app-share-keys.ts): values that already went up, or that you
  // declined this run, answer { unchanged: true } with no Touch ID, and calls for one app share one sheet.
  function push(appId, { ifChanged = false } = {}) {
    if (!ifChanged) return pushNow(appId, false);
    if (!inflight.has(appId)) inflight.set(appId, pushNow(appId, true).finally(() => inflight.delete(appId)));
    return inflight.get(appId);
  }

  async function pushNow(appId, ifChanged) {
    const found = whatToPush(dataDir, appId);
    if (found.error) return found;
    const { app, manifest, folder, policy, reads, names } = found;
    if (!names.length) return { ok: true, pushed: [], missing: [] };

    const { values, missing: missingNames, label } = await vault.valuesFor(vaultFolderOf(manifest, folder), names, manifest.env);
    const count = Object.keys(values).length;
    if (!count) {
      return { ok: true, pushed: [], missing: names, error: `No values yet in ${label} · ${manifest.env}.` };
    }
    const digest = ledger.digest(app.share.id, values);
    if (ifChanged && ledger.settled(appId, digest)) return { ok: true, pushed: [], missing: missingNames, unchanged: true };
    const refused = await confirmPush({ manifest, count, label, targets: pushTargets(policy, reads) });
    if (refused) {
      if (ifChanged) ledger.declined(appId, digest);
      return refused;
    }

    const token = accessTokenFrom(account());
    if (!token) return { error: "Sign in to your Weft account first." };

    const posted = await postSecrets({ shareId: app.share.id, values, token });
    if (posted.error) return posted;
    ledger.sent(appId, digest);
    return { ok: true, pushed: Object.keys(values), missing: missingNames };
  }

  return { push };
}

// The IPC handler. Bails out unless the sender is the board window — the same check
// `browser:open` does in main.cjs.
function registerAppSecretsPush(ipcMain, { push, isBoard }) {
  ipcMain.handle("apps:push-secrets", async (event, appId) => {
    if (!isBoard(event.sender)) throw new Error("App secrets push only answers the board window.");
    return push(appId);
  });
}

// The push main set up, for the control server's route below; null until setupAppSecretsPush runs.
let current = null;

// The control server's route (electron/pane-routes.cjs): Weft's server sends a link's keys whenever Share… opens or
// saves it (lib/app-share-keys.ts), only when they changed. The same push as the button, Touch ID and all.
function appSecretsRoutes(get = () => current) {
  return {
    "POST /apps/push-secrets": (body) => {
      const p = get();
      if (!p) throw new Error("Upload secrets isn't ready yet.");
      return p.push(String(body.appId ?? ""), { ifChanged: body.ifChanged === true });
    },
  };
}

// Wires app-secrets-push into Electron main. main.cjs calls this once the vault, the
// account store and the board are up.
function setupAppSecretsPush({ ipcMain, dataDir, vault, account, confirm, isBoard, fetch: fetchImpl }) {
  const { push } = createAppSecretsPush({ dataDir, vault, account, confirm, fetch: fetchImpl });
  registerAppSecretsPush(ipcMain, { push, isBoard });
  current = { push };
  return { push };
}

module.exports = {
  createAppSecretsPush,
  registerAppSecretsPush,
  setupAppSecretsPush,
  appSecretsRoutes,
  accessTokenFrom,
  namesToPush,
  pushTargets,
  findApp,
  readAppManifest,
  vaultFolderOf,
};
