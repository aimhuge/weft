// Pairing and the workspace key, wired (docs/architecture/mobile-security.md): the board's Settings → Sync starts,
// polls and revokes over IPC (board window only, never a thread), and the server reads what it needs over the control
// server: the current key to seal with, whether an approval's signature is a paired phone's, and how many can approve.
const fs = require("node:fs");
const path = require("node:path");
const { createPairedDevices } = require("./paired-devices.cjs");
const { createSyncKeys } = require("./sync-keys.cjs");
const { createPairing } = require("./pairing.cjs");
const { loadDeviceKey, registerDevice } = require("./device-key.cjs");

/**
 * @param {{ ipcMain: any, dataDir: string, accountClient: () => any, isBoard: (sender: unknown) => boolean,
 *   confirm: (reason: string) => Promise<boolean>, safeStorage?: () => any, crypto?: () => any }} deps
 */
function setupPairing({ ipcMain, dataDir, accountClient, isBoard, confirm, safeStorage, crypto }) {
  const keychain = safeStorage ?? (() => require("./keychain-audit.cjs").keychainFor("vault key"));
  const vaultCrypto = crypto ?? (() => require("./vault-crypto.cjs"));
  const ready = async () => {
    await vaultCrypto().ready();
    return require("libsodium-wrappers");
  };
  let sodium = null;
  const db = () => accountClient().supabase;

  // This Mac's public.devices row and its keypair, registering it the first time.
  let me = null;
  async function myDevice() {
    if (me) return me;
    const pair = loadDeviceKey({ dir: dataDir, safeStorage: keychain(), crypto: vaultCrypto() });
    const found = await db().from("devices").select("id").eq("public_key", pair.publicKey).maybeSingle();
    let id = found.data?.id;
    if (!id) {
      await registerDevice({ accountClient: accountClient(), dir: dataDir, safeStorage: keychain(), crypto: vaultCrypto() });
      id = (await db().from("devices").select("id").eq("public_key", pair.publicKey).single()).data?.id;
    }
    if (!id) throw new Error("This Mac isn't registered as a device yet. Sign in to Weft and try again.");
    me = { id, ...pair };
    return me;
  }
  const macDevice = () => fs.readFileSync(path.join(dataDir, "device-id"), "utf8").trim();

  const paired = createPairedDevices({ dir: dataDir, safeStorage: keychain, sodium: () => sodium });
  const syncKeys = createSyncKeys({ dir: dataDir, safeStorage: keychain, crypto: vaultCrypto, db, myDevice });
  const userId = () => String(accountClient().getClaims()?.sub ?? "");
  const pairing = createPairing({ db, userId, sodium: () => sodium, macDevice, myDevice, paired, syncKeys, confirm });
  const withSodium = (fn) => async (...args) => {
    sodium ??= await ready();
    return fn(...args);
  };

  const handle = (channel, fn) =>
    ipcMain.handle(channel, async (event, ...args) => {
      if (!isBoard(event.sender)) throw new Error("Pairing only answers the board window.");
      return withSodium(fn)(...args);
    });
  handle("pairing:start", (orgId) => pairing.start(String(orgId ?? "")));
  handle("pairing:check", (id) => pairing.check(String(id)));
  handle("pairing:cancel", (id) => pairing.cancel(String(id)));
  handle("pairing:list", () => pairing.list());
  handle("pairing:revoke", (id) => pairing.revoke(String(id)));
  handle("pairing:settings", () => paired.settings());
  // Letting the web approve without the phone lowers the bar, so it takes Touch ID; everything else is a plain switch.
  handle("pairing:set-settings", async (change) => {
    const patch = { seal: change?.seal, webApprovals: change?.webApprovals };
    if (patch.webApprovals === true && !paired.settings().webApprovals && !(await confirm("let the web board approve tool runs without your phone"))) return paired.settings();
    return paired.setSettings(patch);
  });

  const routes = {
    // The key the uploader seals with (lib/sync-seal-upload.ts); { none: true } when this Mac has no grant yet.
    "POST /sync/key": withSodium(async ({ orgId, create }) => (await syncKeys.current(String(orgId), { create: create === true })) ?? { none: true }),
    // Whether an answer's signature is a paired phone's (lib/approval-check.ts). The key never leaves main.
    "POST /pairing/verify": withSodium(({ device, message, sig }) => paired.verify({ device: String(device), message: String(message), sig: String(sig) })),
    "POST /pairing/status": () => ({ approvers: paired.approvers(), devices: pairing.list().length, ...paired.settings() }),
  };
  return { pairing, syncKeys, paired, routes };
}

module.exports = { setupPairing };
