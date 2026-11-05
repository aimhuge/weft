// Grants for data mini apps (docs/architecture/mini-apps.md). A grant says: this app's folder, in this
// env, with these vault names, may read weft-app.json that hashes to this value. The file is 0600
// because the env label + the names still tell you what the user agreed to. Lives in its own file so
// app-data.cjs can stay focused on grants-then-IPC.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const GRANTS_FILE = "app-grants.json";

// Reads <dataDir>/app-grants.json. Empty/missing/garbage all mean "no grants". The on-disk shape
// is { grants: {...}, savedAt: ... } (savedGrants wraps it) so this unwraps to the grants map.
function loadGrants(dataDir) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dataDir, GRANTS_FILE), "utf8"));
    const grants = raw && typeof raw === "object" ? raw.grants : undefined;
    return grants && typeof grants === "object" ? grants : {};
  } catch {
    return {};
  }
}

// 0600: a grants file lists vault names plus the env; values stay in the vault, but the env
// label plus the names still say what was granted.
function saveGrants(dataDir, grants, now = Date.now) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, GRANTS_FILE), JSON.stringify({ grants, savedAt: new Date(now()).toISOString() }, null, 2), { mode: 0o600 });
}

// The vault names a read kind needs (never values), unioned across all the app's reads.
function deriveNeeds(reads) {
  const needs = new Set();
  for (const read of Object.values(reads)) {
    if (read.supabase) needs.add("SUPABASE_SECRET_KEY");
    if (read.ga4) {
      needs.add("GA4_PROPERTY_ID");
      needs.add("GA4_SERVICE_ACCOUNT_JSON");
    }
  }
  return [...needs].sort();
}

// Every vault name a grant covers: the reads' needs, plus the names the manifest's fetch policy may fill
// (`secrets`) and the names weft.env hands the page as is (`public`). A thread may edit a manifest
// (~/.weft/apps is open to threads, docs/architecture/secrets.md), so a name added to either must void
// the grant and ask again, never ride an old one.
function manifestNeeds(manifest) {
  const needs = new Set(deriveNeeds(manifest.reads || {}));
  const secrets = manifest.secrets && typeof manifest.secrets === "object" && !Array.isArray(manifest.secrets) ? manifest.secrets : {};
  for (const name of Object.keys(secrets)) needs.add(name);
  for (const name of Array.isArray(manifest.public) ? manifest.public : []) if (typeof name === "string") needs.add(name);
  return [...needs].sort();
}

// A hash over the reads object, the fetch policy (secrets) and the public names (and the supabaseUrl, since changing it changes what a supabase read
// would talk to). Order-independent: a manifest that reorders its reads is the same data app. The
// replacer sorts object keys at every level so two manifests with the same content but different
// key order hash to the same value.
function manifestHash(manifest) {
  const sorted = (key, value) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return Object.keys(value).sort().reduce((acc, k) => { acc[k] = value[k]; return acc; }, {});
    }
    return value;
  };
  // secrets and public join the hash only when the manifest has them, so an app with neither keeps the
  // hash its grant was saved with.
  const obj = { env: manifest.env, folder: manifest.folder, supabaseUrl: manifest.supabaseUrl, reads: manifest.reads, secrets: manifest.secrets, public: manifest.public };
  return crypto.createHash("sha256").update(JSON.stringify(obj, sorted)).digest("hex").slice(0, 16);
}

// Compares a saved grant to the live manifest. A change in env, folder or needs voids it; the
// readsHash covers reads + supabaseUrl + folder + env so a manifest edit is caught too.
function effectiveGrant(grant, manifest, needs) {
  if (!grant) return null;
  if (grant.env !== manifest.env) return null;
  if (grant.folder !== manifest.folder) return null;
  if (grant.needs.length !== needs.length || needs.some((n, i) => grant.needs[i] !== n)) return null;
  if (grant.readsHash !== manifestHash(manifest)) return null;
  return grant;
}

// The grant to save when the user says yes: what it covers, and the hash that voids it on any change.
function newGrant(manifest, needs, now = Date.now) {
  return { env: manifest.env, folder: manifest.folder, needs, readsHash: manifestHash(manifest), grantedAt: new Date(now()).toISOString() };
}

module.exports = {
  loadGrants,
  saveGrants,
  deriveNeeds,
  manifestNeeds,
  newGrant,
  manifestHash,
  effectiveGrant,
  GRANTS_FILE,
};
