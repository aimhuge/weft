// This device's vault keypair (docs/architecture/secrets.md): made on first use, the public half kept as is
// and the private half encrypted by Electron's safeStorage, whose key lives in the macOS Keychain. Without
// safeStorage there's nowhere safe to keep it, so Weft refuses rather than writing the key in the clear.
//
// The file also holds this device's display name, which the user picks once (the design's Q6) and which
// every registration sends to the server, so a teammate's Devices page says which machine it is.
//
// This device's registration in the shared vault (docs/architecture/teams-vault.md, "Device
// registration") also lives here: registerDevice() upserts the public half and the fingerprint — the
// two are not secrets — into the `devices` table, as the signed-in user. The private half never
// leaves this file: it is unsealed only for the vault store, and never goes near a request.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { fingerprint } = require("./device-fingerprint.cjs");

const FILE = "device-key.json";

/** @returns {{ publicKey: string, privateKey: string }} */
function loadDeviceKey({ dir, safeStorage, crypto }) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("The Keychain isn't available, so the vault can't keep its key safely.");
  const file = path.join(dir, FILE);
  if (fs.existsSync(file)) {
    /** @type {{ publicKey: string, privateKey: string }} */
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    return { publicKey: saved.publicKey, privateKey: safeStorage.decryptString(Buffer.from(saved.privateKey, "base64")) };
  }
  const pair = crypto.newKeypair();
  fs.mkdirSync(dir, { recursive: true });
  const sealed = safeStorage.encryptString(pair.privateKey).toString("base64");
  fs.writeFileSync(file, JSON.stringify({ publicKey: pair.publicKey, privateKey: sealed, createdAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
  return pair;
}

// The name saved next to the keypair, or "" when the user hasn't picked one yet.
function savedName({ dir }) {
  const file = path.join(dir, FILE);
  if (!fs.existsSync(file)) return "";
  try {
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    return typeof saved.name === "string" ? saved.name : "";
  } catch {
    return "";
  }
}

// Save the display name next to the keypair, keeping the file sealed and 0600. The private half is
// written back exactly as it was read — this function never holds it.
function saveName({ dir, name }) {
  const file = path.join(dir, FILE);
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  fs.writeFileSync(file, JSON.stringify({ ...saved, name }, null, 2), { mode: 0o600 });
}

// The name the user is offered the first time: "Weft on <hostname>".
function defaultDeviceName({ hostname = os.hostname() } = {}) {
  return `Weft on ${hostname || "this Mac"}`;
}

// The row this device is, as the server stores it. The public half and the fingerprint are shown to
// the user and to the team — that is the point of TOFU. The private half stays in the file, sealed.
function deviceRow({ userId, publicKey, name, platform }) {
  return {
    user_id: userId,
    public_key: publicKey,
    fingerprint: fingerprint(publicKey),
    name,
    platform,
  };
}

// The name: the user's, if they gave one; else the one already saved; else the default. The name is
// saved so the next registration sends the same one, and so the board can show it before the user
// has signed in.
function resolveName({ dir, name }) {
  const chosen = (typeof name === "string" ? name.trim() : "") || savedName({ dir }) || defaultDeviceName();
  if (chosen !== savedName({ dir }) && fs.existsSync(path.join(dir, FILE))) saveName({ dir, name: chosen });
  return chosen;
}

/**
 * Register this device with the shared vault, as the signed-in user.
 *
 * The row is keyed on (user_id, public_key), so this is idempotent: a second call only bumps
 * last_seen_at. The user id comes from the JWT's claims — the server's own `devices: add own`
 * policy demands auth.uid() = user_id — and never from anything the caller passes in.
 *
 * The upsert targets the unique index devices_user_pubkey_idx on (user_id, public_key). That index
 * is NOT partial and is declared NULLS NOT DISTINCT (Postgres 15+). Both halves matter: a partial
 * index (one carrying `where user_id is not null`) cannot serve as an ON CONFLICT inference target
 * without the same predicate, so Postgres refuses the conflict target with 42P10 — that was a real
 * defect here, fixed by migration 20261027165308_devices_upsert_unique_index. If you ever re-add a
 * predicate to that index, the upsert below stops working; don't paper over it with a select-then-
 * write, fix the index. NULLS NOT DISTINCT is what keeps two recovery-device rows with user_id NULL
 * from colliding while still allowing the plain ON CONFLICT target.
 *
 * @param {{ accountClient: { supabase: { from: (t: string) => any }, getClaims: () => Record<string, unknown>|null },
 *   dir: string, safeStorage: { isEncryptionAvailable: () => boolean, encryptString: (s: string) => Buffer, decryptString: (b: Buffer) => string },
 *   crypto: { newKeypair: () => { publicKey: string, privateKey: string } },
 *   name?: string, platform?: string }} deps
 */
async function registerDevice({ accountClient, dir, safeStorage, crypto, name, platform = process.platform }) {
  const claims = accountClient.getClaims();
  const userId = claims && typeof claims.sub === "string" ? claims.sub : null;
  if (!userId) throw new Error("Sign in to Weft before registering this device.");

  const device = loadDeviceKey({ dir, safeStorage, crypto });
  const row = deviceRow({ userId, publicKey: device.publicKey, name: resolveName({ dir, name }), platform });

  // The upsert the design names, and the only write path: one round trip, and the row is keyed on
  // (user_id, public_key) so a second registration bumps the same row instead of duplicating it.
  // This conflict target needs the index to be non-partial — see the note above.
  const { data, error } = await accountClient.supabase.from("devices").upsert(row, { onConflict: "user_id,public_key" });
  if (error) throw new Error(`This device could not be registered: ${error.message}`);

  const registered = Array.isArray(data) ? data[0] : data;
  return {
    id: registered && typeof registered === "object" ? registered.id ?? null : null,
    name: row.name,
    platform,
    publicKey: device.publicKey,
    fingerprint: row.fingerprint,
  };
}

/**
 * This device's own devices, as the signed-in user sees them.
 * @param {{ accountClient: { supabase: { from: (t: string) => any } } }} deps
 */
async function listDevices({ accountClient }) {
  const { data, error } = await accountClient.supabase
    .from("devices")
    .select("id, name, platform, fingerprint, public_key, last_seen_at, revoked_at")
    .order("name", { ascending: true });
  if (error) throw new Error(`Your devices could not be read: ${error.message}`);
  const rows = Array.isArray(data) ? data : [];
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    platform: row.platform,
    fingerprint: row.fingerprint,
    publicKey: row.public_key,
    lastSeenAt: row.last_seen_at,
    revokedAt: row.revoked_at,
  }));
}

/**
 * This device's fingerprint, without touching the network: the public key is in the sealed file, so
 * the board can show the TOFU string even when the machine is offline.
 * @param {{ dir: string, safeStorage: object, crypto: object }} deps
 */
function deviceFingerprint({ dir, safeStorage, crypto }) {
  return fingerprint(loadDeviceKey({ dir, safeStorage, crypto }).publicKey);
}

/**
 * The IPC handlers the board window uses to read and refresh its own devices. The renderer gets
 * public keys, fingerprints and names — never the private key, never a secret value.
 *
 * @param {{ ipcMain: { handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => void },
 *   accountClient: () => { supabase: { from: (t: string) => any }, getClaims: () => Record<string, unknown>|null },
 *   dataDir: string, isBoard: (sender: unknown) => boolean, safeStorage?: object, crypto?: object }} deps
 */
function registerDeviceHandlers({ ipcMain, accountClient, dataDir, isBoard, safeStorage, crypto }) {
  const keychain = () => require("./keychain-audit.cjs").keychainFor("vault key");
  const sodium = () => require("./vault-crypto.cjs");
  const handle = (channel, fn) =>
    ipcMain.handle(channel, async (event, ...args) => {
      if (!isBoard(event.sender)) throw new Error("The vault only answers the board window.");
      return fn(...args);
    });
  handle("vault:devices", () => listDevices({ accountClient: accountClient() }));
  handle("vault:devices-register", (options) =>
    registerDevice({
      accountClient: accountClient(),
      dir: dataDir,
      safeStorage: safeStorage ?? keychain(),
      crypto: crypto ?? sodium(),
      name: options && typeof options.name === "string" ? options.name : undefined,
    }),
  );
  handle("vault:devices-fingerprint", () =>
    deviceFingerprint({ dir: dataDir, safeStorage: safeStorage ?? keychain(), crypto: crypto ?? sodium() }),
  );
}

module.exports = { loadDeviceKey, registerDevice, listDevices, deviceFingerprint, registerDeviceHandlers, defaultDeviceName, DEVICE_KEY_FILE: FILE };
