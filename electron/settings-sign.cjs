// Your account's settings signed for your Weft Workers (docs/architecture/project-hosts.md#settings-on-a-worker-wp3):
// the server asks main to sign each push (lib/account-settings.ts), and a worker applies only a row the Mac it was paired
// with signed (lib/account-settings-sig.ts). The key is this Mac's device key (electron/desktop-signer.cjs), the one the
// pairing code carried to the box, used here with no Touch ID: every Save pushes, and what's signed is domain-separated
// ("weft-account-settings-v1", built here from checked fields, never a message the caller wrote), so the signature can
// only ever mean "this Mac's account settings at this version", not an approval or a secret_use. Only the server holds the
// control server's token; threads reach main only through the tools it offers, and none offers this route.

const PREFIX = "weft-account-settings-v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;

// Main's copy of lib/account-settings-sig.ts accountSettingsMessage; electron/settings-sign.test.ts holds them together.
function accountSettingsMessage(userId, version, digest) {
  return [PREFIX, userId, String(version), digest].join("\n");
}

// The message for a request, or a throw naming what's wrong with it.
function messageFor(body) {
  const { userId, version, digest } = body ?? {};
  if (typeof userId !== "string" || !UUID.test(userId)) throw new Error("That names no account.");
  if (!Number.isSafeInteger(version) || version <= 0) throw new Error("That names no version.");
  if (typeof digest !== "string" || !DIGEST.test(digest)) throw new Error("That names no settings.");
  return accountSettingsMessage(userId, version, digest);
}

// This Mac's device key, the file and keychain item pairing and secret_use use (electron/secret-run.cjs builds it the same).
// Made once and kept, so the key is opened once rather than on every Save.
/** @param {string} dataDir @param {() => any} [safeStorage] */
function desktopSignerFor(dataDir, safeStorage = () => require("./keychain-audit.cjs").keychainFor("vault key")) {
  let signer = null;
  return async () => {
    if (signer) return signer;
    await require("./vault-crypto.cjs").ready();
    const sodium = require("libsodium-wrappers");
    signer = require("./desktop-signer.cjs").createDesktopSigner({ dir: dataDir, safeStorage, sodium: () => sodium });
    return signer;
  };
}

/** @param {() => Promise<{ sign: (m: string) => string, publicKey: () => string }>} signer */
function settingsSignRoutes(signer) {
  return {
    "POST /account-settings/sign": async (body) => {
      const message = messageFor(body);
      const key = await signer();
      return { signature: key.sign(message), publicKey: key.publicKey() };
    },
  };
}

module.exports = { accountSettingsMessage, settingsSignRoutes, desktopSignerFor };
