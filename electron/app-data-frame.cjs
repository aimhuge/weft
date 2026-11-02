// Frame → folder → manifest for a data mini app (docs/architecture/mini-apps.md). The pane's main frame
// is the only thing that runs here: an iframe or a frame outside <dataDir>/apps/<slug>/ is rejected
// before the manifest or the saved-app check. Lives in its own file so app-data.cjs can stay focused
// on grants and IPC.

const fs = require("node:fs");
const path = require("node:path");
const { RPC_FN, READ_NAME, safeSupabaseUrl } = require("./app-data-reads.cjs");

const APPS_DIR = "apps";
const APPS_FILE = "apps.json";

// What a sender must look like: a webContents the pane owns, and the frame the message came from
// must be that webContents' main frame (event.sender is the WebContents, its mainFrame a WebFrameMain).
// An iframe inside a saved page is rejected before anything else runs.
function senderOk(owns, event) {
  if (!event?.sender || !owns(event.sender)) return false;
  if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame) return false;
  return true;
}

// Reads ~/.weft/apps.json on demand. Empty file or missing key both mean "no saved apps".
function loadApps(dataDir) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dataDir, APPS_FILE), "utf8"));
    const list = Array.isArray(raw?.apps) ? raw.apps : [];
    return list.filter((a) => a && typeof a.url === "string");
  } catch {
    return [];
  }
}

// A real path must live under this dir, not just start with it. Stops "dataDir/apps/../something"
// and a "dataDir/appsEvil" match. Both sides are realpath'd so macOS's /tmp → /private/tmp symlink
// (and a dataDir mkdtemp'd under it) doesn't fool the comparison.
function isInside(parent, child) {
  let a, c;
  try {
    a = fs.realpathSync(parent);
    c = fs.realpathSync(child);
  } catch {
    return false; // no apps folder yet, so nothing is inside it
  }
  if (a === c) return false;
  const rel = path.relative(a, c);
  return rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function err(kind, message) {
  const e = new Error(message);
  e.kind = kind;
  return e;
}

// An app saved from a worker card's page (lib/mini-app-worker.ts) lives in <dataDir>/apps/worker-<sha16>/, here and on
// every Mac cloud sync brings it to (its app id is the folder's name). That page was written off this Mac, where it ran
// in a CSP sandbox, so it gets no more here: no data reads, fetch, env or secrets, whatever manifest sits beside it,
// and no live data. Judged by the folder the file really is in, never by the page.
const WORKER_APP_PREFIX = "worker-";

function isWorkerAppPath(dataDir, real) {
  let apps;
  try {
    apps = fs.realpathSync(path.join(dataDir, APPS_DIR));
  } catch {
    return false;
  }
  const rel = path.relative(apps, real);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return false;
  return rel.split(path.sep)[0].toLowerCase().startsWith(WORKER_APP_PREFIX);
}

// The same for a frame's URL: true for a file: page in a worker app's folder (a folder path counts too).
function isWorkerAppPage(dataDir, frameUrl) {
  try {
    const url = new URL(frameUrl);
    if (url.protocol !== "file:") return false;
    return isWorkerAppPath(dataDir, fs.realpathSync(decodeURIComponent(url.pathname)));
  } catch {
    return false;
  }
}

const WORKER_APP_REFUSED = "This app came from a worker card's page, so it runs without Weft's data bridge.";

// The frame URL → an app folder under <dataDir>/apps/<slug>/. Realpath catches symlink escapes; if
// the real path points outside the apps dir the frame isn't one of ours.
function appFolderFromUrl(dataDir, frameUrl) {
  if (typeof frameUrl !== "string" || !frameUrl) throw err("not-weft", "The page has no URL.");
  let url;
  try {
    url = new URL(frameUrl);
  } catch {
    throw err("not-weft", "The page's URL isn't valid.");
  }
  if (url.protocol !== "file:") throw err("not-weft", `Open this app in Weft on your Mac to load its data (got ${url.protocol}).`);
  // file: URLs are percent-encoded; realpathSync wants the OS form.
  let real;
  try {
    real = fs.realpathSync(decodeURIComponent(url.pathname));
  } catch {
    throw err("not-weft", "The page's file path doesn't exist.");
  }
  const appsDir = path.join(dataDir, APPS_DIR);
  if (!isInside(appsDir, real)) throw err("not-weft", "Open this app in Weft on your Mac to load its data.");
  if (isWorkerAppPath(dataDir, real)) throw err("worker-app", WORKER_APP_REFUSED);
  // The folder is real's parent, and it has to be one app's own folder (<apps>/<slug>), not the apps
  // folder itself or a folder nested deeper in an app, which could carry a manifest of its own.
  const folder = path.dirname(real);
  if (path.dirname(folder) !== fs.realpathSync(appsDir)) throw err("not-weft", "A data app's page sits in its own folder in ~/.weft/apps.");
  // A missing weft-app.json makes this not a data app (a plain saved page could live here too).
  const manifestPath = path.join(folder, "weft-app.json");
  if (!fs.existsSync(manifestPath)) throw err("not-weft", "This app has no weft-app.json.");
  return { folder: real, manifestPath };
}

const VALID_ENV = new Set(["development", "preview", "production"]);

// One read entry in the manifest, normalised.
function normaliseRead(name, read) {
  if (!READ_NAME.test(name)) throw err("manifest", `Read name ${JSON.stringify(name)} must be lowercase, with digits, _ or -.`);
  if (!read || typeof read !== "object") throw err("manifest", `Read ${name} must be an object.`);
  if (read.supabase !== undefined) {
    if (typeof read.supabase !== "string" || !RPC_FN.test(read.supabase)) {
      throw err("manifest", `Read ${name}'s supabase function isn't a Postgres identifier.`);
    }
    if (read.args !== undefined && (typeof read.args !== "object" || read.args === null || Array.isArray(read.args))) {
      throw err("manifest", `Read ${name}'s args must be an object.`);
    }
    return read;
  }
  if (read.ga4 !== undefined) {
    if (typeof read.ga4 !== "object" || read.ga4 === null || Array.isArray(read.ga4)) {
      throw err("manifest", `Read ${name}'s ga4 must be an object.`);
    }
    return read;
  }
  throw err("manifest", `Read ${name} must have a "supabase" or "ga4" key.`);
}

// Plain object check used by the top-level fields' validation. Returns true when value is a
// non-null, non-array object, the shape the manifest treats as a map.
function isObjectMap(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// The top-level fields the manifest is allowed to have. Each one short-circuits with its own
// plain-English error so the page can show what to fix. Split out per-field helpers so each
// one's complexity stays low; ESLint's complexity counts nested &&/|| on a single function.
function requireString(parsed, field, message) {
  if (parsed[field] === undefined) return;
  if (typeof parsed[field] !== "string") throw err("manifest", message);
}
function requireOptionalString(parsed, field, message) {
  if (parsed[field] === undefined || parsed[field] === null) return;
  if (typeof parsed[field] !== "string") throw err("manifest", message);
}
function requireObjectMap(parsed, field, message) {
  if (parsed[field] === undefined) return;
  if (!isObjectMap(parsed[field])) throw err("manifest", message);
}
function requireArray(parsed, field, message) {
  if (parsed[field] === undefined) return;
  if (!Array.isArray(parsed[field])) throw err("manifest", message);
}

function normaliseTop(parsed) {
  if (!parsed || typeof parsed !== "object") throw err("manifest", "weft-app.json must be an object.");
  if (!parsed.name || typeof parsed.name !== "string") throw err("manifest", "weft-app.json is missing a name.");
  if (parsed.env !== undefined && !VALID_ENV.has(parsed.env)) {
    throw err("manifest", `weft-app.json's env (${parsed.env}) must be development, preview or production.`);
  }
  requireString(parsed, "folder", "weft-app.json's folder must be a string path.");
  requireOptionalString(parsed, "supabaseUrl", "weft-app.json's supabaseUrl must be a string.");
  // A supabaseUrl is only ever used to send the author's SUPABASE_SECRET_KEY, so a value that isn't an
  // https Supabase project host is refused here — at load, so it never reaches the manifest at all —
  // as well as at read time (runSupabase re-checks). Same rule and same reasoning as the hosted route's
  // reducedManifest; see safeSupabaseUrl in lib/app-folder.ts. Absent or null means "fall back to the
  // project's linked ref" (resolveSupabaseUrl), so only a value that is actually there is judged.
  if (parsed.supabaseUrl && !safeSupabaseUrl(parsed.supabaseUrl)) {
    throw err("manifest", "weft-app.json's supabaseUrl must be an https Supabase project URL (https://<ref>.supabase.co).");
  }
  requireObjectMap(parsed, "reads", "weft-app.json's reads must be an object.");
  requireObjectMap(parsed, "secrets", "weft-app.json's secrets must be an object.");
  requireArray(parsed, "public", "weft-app.json's public must be an array of names.");
}

// Reads weft-app.json from the folder. Plain errors only: the page shows them in its UI.
// `secrets` and `public` are forwarded as-is for app-data-fetch (parsePolicy does its own
// validation); this loader only checks that the top-level fields are the right shape.
function readManifest(manifestPath, folder) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (e) {
    throw err("manifest", `weft-app.json isn't valid JSON: ${e.message}`);
  }
  normaliseTop(parsed);
  const reads = {};
  for (const [name, read] of Object.entries(parsed.reads ?? {})) reads[name] = normaliseRead(name, read);
  const out = {
    name: parsed.name,
    folder: parsed.folder ?? folder, // the project folder the manifest says; else the app folder itself.
    env: parsed.env ?? "development",
    supabaseUrl: parsed.supabaseUrl ?? null,
    reads,
  };
  if (parsed.secrets !== undefined) out.secrets = parsed.secrets;
  if (parsed.public !== undefined) out.public = parsed.public;
  return out;
}

// Loads the saved app whose url lives in the same folder as the frame. apps.json is the only source
// for "saved"; a brand-new data app must be saved like any other mini app.
function findSavedApp(dataDir, folder) {
  const apps = loadApps(dataDir);
  return apps.find((a) => {
    let url;
    try {
      url = new URL(a.url);
    } catch {
      return false;
    }
    if (url.protocol !== "file:") return false;
    let real;
    try {
      real = fs.realpathSync(decodeURIComponent(url.pathname));
    } catch {
      return false;
    }
    return path.dirname(real) === folder;
  });
}

module.exports = {
  senderOk,
  appFolderFromUrl,
  readManifest,
  findSavedApp,
  loadApps,
  isInside,
  isWorkerAppPath,
  isWorkerAppPage,
  WORKER_APP_PREFIX,
  WORKER_APP_REFUSED,
  APPS_DIR,
  APPS_FILE,
  err,
};
