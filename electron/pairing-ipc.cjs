// Pairing and the workspace key, wired (docs/architecture/mobile-security.md): the board's Settings → Sync starts,
// polls and revokes over IPC (board window only, never a thread), and the server reads what it needs over the control
// server: the current key to seal with, whether an approval's signature is a paired phone's, and how many can approve.
const fs = require("node:fs");
const path = require("node:path");
const { createPairedDevices } = require("./paired-devices.cjs");
const { createSyncKeys } = require("./sync-keys.cjs");
const { createPairing } = require("./pairing.cjs");
const { registeredDevice } = require("./device-key.cjs");
const { pairingOpenMarker } = require("./pairing-open.cjs");
const { approvalMessage, createDesktopSigner } = require("./desktop-signer.cjs");
const { readSignRequest, serverCards, signPrompt, waitingRequest } = require("./approval-sign.cjs");

/**
 * @param {{ ipcMain: any, dataDir: string, accountClient: () => any, isBoard: (sender: unknown) => boolean,
 *   confirm: (reason: string) => Promise<boolean>, safeStorage?: () => any, crypto?: () => any, devOrigin?: string | null,
 *   getServer?: () => { url: string } | undefined, cards?: () => Promise<any[]> }} deps
 */
function setupPairing({ ipcMain, dataDir, accountClient, isBoard, confirm, safeStorage, crypto, devOrigin = null, getServer = () => undefined, cards }) {
  const boardCards = cards ?? serverCards(getServer);
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
    me ??= await registeredDevice({ accountClient: accountClient(), dir: dataDir, safeStorage: keychain(), crypto: vaultCrypto() });
    return me;
  }
  const macDevice = () => fs.readFileSync(path.join(dataDir, "device-id"), "utf8").trim();

  const signer = createDesktopSigner({ dir: dataDir, safeStorage: keychain, sodium: () => sodium });
  const paired = createPairedDevices({ dir: dataDir, safeStorage: keychain, sodium: () => sodium, devOrigin, self: { id: () => { try { return macDevice(); } catch { return ""; } }, verify: signer.verify } });
  const syncKeys = createSyncKeys({ dir: dataDir, safeStorage: keychain, crypto: vaultCrypto, db, myDevice });
  const userId = () => String(accountClient().getClaims()?.sub ?? "");
  // Codes live in memory, so none is open at start: a marker left by a crash goes.
  const markOpen = pairingOpenMarker(dataDir);
  markOpen(0);
  const pairing = createPairing({ db, userId, sodium: () => sodium, macDevice, myDevice, paired, syncKeys, confirm, markOpen });
  const withSodium = (fn) => async (...args) => {
    sodium ??= await ready();
    return fn(...args);
  };

  const handle = (channel, fn) =>
    ipcMain.handle(channel, async (event, ...args) => {
      if (!isBoard(event.sender)) throw new Error("Pairing only answers the board window.");
      return withSodium(fn)(...args);
    });
  handle("pairing:start", (orgId, opts) => pairing.start(String(orgId ?? ""), { passkey: opts?.passkey === true }));
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

  // The desktop's signed approval (electron/desktop-signer.cjs, electron/approval-sign.cjs): main finds the request
  // waiting on its own server, asks Touch ID in its own words, then signs the phone's message with this Mac's key.
  // Board window only; null when Touch ID is refused.
  handle("approval:sign", async (raw) => {
    const req = readSignRequest(raw);
    if (typeof req === "string") throw new Error(req);
    const found = await waitingRequest(boardCards, req);
    if (typeof found === "string") throw new Error(found);
    if (!(await confirm(signPrompt(found.card, found.pending, req.allow, req.grant)))) return null;
    const device = macDevice();
    const issuedAt = Date.now();
    const message = approvalMessage(sodium, { ...req, macDevice: device, issuedAt });
    return { device, issuedAt, sig: signer.sign(message), publicKey: signer.publicKey() };
  });

  // Workers added by pairing from Settings → Devices: the same claim, proof and Touch ID (electron/host-pairing.cjs).
  // The worker keys secret runs are sealed to (electron/worker-pins.cjs): pinned here at pairing, forgotten by Re-pin.
  const workerPins = require("./worker-pins.cjs").createWorkerPins({ dir: dataDir, safeStorage: keychain });
  // The code carries this Mac's approval key, so the paired box trusts only this Mac's secret_use rows.
  const macSignKey = async () => {
    sodium ??= await ready();
    return signer.publicKey();
  };
  // And it signs a worker's re-pair to another Mac, after Touch ID (electron/worker-repair.cjs).
  const macSign = async (message) => {
    sodium ??= await ready();
    return signer.sign(message);
  };
  require("./host-pairing-ipc.cjs").registerHostPairing(handle, { db, userId, macDevice, myDevice, confirm, macSignKey, macSign }, workerPins);

  const routes = {
    // The key the uploader seals with (lib/sync-seal-upload.ts); { none: true } when this Mac has no grant yet.
    "POST /sync/key": withSodium(async ({ orgId, create }) => (await syncKeys.current(String(orgId), { create: create === true })) ?? { none: true }),
    // Whether an answer's signature is a paired phone's (lib/approval-check.ts). The key never leaves main.
    "POST /pairing/verify": withSodium(({ device, message, sig }) => paired.verify({ device: String(device), message: String(message), sig: String(sig) })),
    // Whether a passkey assertion is a pinned browser's (lib/approval-passkey-check.ts); main keeps its counter.
    "POST /pairing/passkey-verify": (b) => paired.verifyPasskey({ device: String(b?.device), credId: String(b?.credId), message: String(b?.message), authenticatorData: String(b?.authenticatorData), clientDataJSON: String(b?.clientDataJSON), signature: String(b?.signature) }),
    "POST /pairing/status": () => ({ approvers: paired.approvers(), devices: pairing.list().length, ...paired.settings() }),
  };
  return { pairing, syncKeys, paired, signer, routes };
}

module.exports = { setupPairing };
