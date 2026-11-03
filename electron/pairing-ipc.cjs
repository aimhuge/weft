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
const { createDesktopSigner } = require("./desktop-signer.cjs");
const { registerApprovalSign, serverCards, serverWorkerAsk } = require("./approval-sign.cjs");

/**
 * @param {{ ipcMain: any, dataDir: string, accountClient: () => any, isBoard: (sender: unknown) => boolean,
 *   confirm: (reason: string) => Promise<boolean>, safeStorage?: () => any, crypto?: () => any, devOrigin?: string | null,
 *   getServer?: () => { url: string } | undefined, cards?: () => Promise<any[]>, workerAsk?: (cardId: string) => Promise<any> }} deps
 */
function setupPairing({ ipcMain, dataDir, accountClient, isBoard, confirm, safeStorage, crypto, devOrigin = null, getServer = () => undefined, cards, workerAsk }) {
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
  // waiting on its own server, this Mac's card or a worker's, asks Touch ID in its own words, then signs the phone's
  // message with this Mac's key. Board window only; null when Touch ID is refused. Registered below, once the workers'
  // pins can name the worker in the prompt.
  // Workers added by pairing from Settings → Devices: the same claim, proof and Touch ID (electron/host-pairing.cjs).
  // The worker keys secret runs are sealed to (electron/worker-pins.cjs): pinned here at pairing, forgotten by Re-pin.
  const workerPins = require("./worker-pins.cjs").createWorkerPins({ dir: dataDir, safeStorage: keychain });
  registerApprovalSign(handle, { cards: boardCards, workerAsk: workerAsk ?? serverWorkerAsk(getServer), macDevice, confirm, signer, sodium: () => sodium, workerName: (id) => workerPins.nameOf(id) });
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
  // A worker's connectors (Settings → Devices → Connectors): every change takes Touch ID, then this Mac's approval key
  // signs it for weft.zip (electron/connector-grants.cjs), which writes it only with a good signature.
  const grants = require("./connector-grants.cjs");
  const call = grants.weftZip({ db, site: process.env.WEFT_CONNECTOR_URL || "https://weft.zip" });
  const knownRepos = require("./worker-projects.cjs").createKnownRepos({ dataDir });
  const connectorSigner = grants.registerConnectorGrants(handle, { db, userId, confirm, sign: macSign, signKey: macSignKey, pins: workerPins, call, knownRepos, device: () => { try { return macDevice(); } catch { return ""; } } });
  // Pairing vouches for the new worker on weft.zip under the same Touch ID, from the keys it just pinned.
  const vouchWorker = (id) => connectorSigner.vouch(id);
  require("./host-pairing-ipc.cjs").registerHostPairing(handle, { db, userId, macDevice, myDevice, confirm, macSignKey, macSign, vouchWorker }, workerPins);
  const projectRepos = require("./worker-projects.cjs").createProjectRepos({ dataDir });
  const signStart = require("./connector-start.cjs").createStartSigner({ userId, sign: macSign, signKey: macSignKey, projectRepos });
  // Signed widening for a remote host's card (electron/widen-sign.cjs), naming a worker by the name it was pinned under,
  // and the passkey endorsements for workers (electron/widen-endorse.cjs).
  require("./widen-sign.cjs").registerWidenSign(handle, { signer, macDevice, confirm, hostName: (id) => workerPins.nameOf(id) });
  const { registerWidenEndorse, createEndorsed } = require("./widen-endorse.cjs");
  registerWidenEndorse(handle, {
    signer,
    macDevice,
    confirm,
    passkeys: () => paired.list(),
    endorsed: createEndorsed({ dir: dataDir, safeStorage: keychain }),
    workerName: (id) => workerPins.nameOf(id),
    workerSignKey: (id) => workerPins.signKeyOf(id),
  });

  const widenNonces = require("./widen-nonces.cjs").createWidenNonces({ dir: dataDir, safeStorage: keychain });
  const routes = {
    // The key the uploader seals with (lib/sync-seal-upload.ts); { none: true } when this Mac has no grant yet.
    "POST /sync/key": withSodium(async ({ orgId, create }) => (await syncKeys.current(String(orgId), { create: create === true })) ?? { none: true }),
    // Whether an answer's signature is a paired phone's (lib/approval-check.ts). The key never leaves main.
    "POST /pairing/verify": withSodium(({ device, message, sig }) => paired.verify({ device: String(device), message: String(message), sig: String(sig) })),
    // Whether a passkey assertion is a pinned browser's (lib/approval-passkey-check.ts); main keeps its counter.
    "POST /pairing/passkey-verify": (b) => paired.verifyPasskey({ device: String(b?.device), credId: String(b?.credId), message: String(b?.message), authenticatorData: String(b?.authenticatorData), clientDataJSON: String(b?.clientDataJSON), signature: String(b?.signature) }),
    // Spends a signed widening's nonce, once its signature checked out (electron/widen-nonces.cjs): main keeps them, so
    // a thread can't edit a file back to replay one.
    "POST /pairing/widen-nonce": (b) => ({ ok: widenNonces.take({ nonce: b?.nonce, issuedAt: b?.issuedAt }) }),
    "POST /pairing/status": () => ({ approvers: paired.approvers(), devices: pairing.list().length, ...paired.settings() }),
    // A worker card's start, signed for the GitHub connector when this Mac knows its folder as that repo (electron/connector-start.cjs).
    "POST /connectors/sign-start": withSodium(signStart),
  };
  return { pairing, syncKeys, paired, signer, routes };
}

module.exports = { setupPairing };
