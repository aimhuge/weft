// The devices this Mac paired, pinned by main itself (docs/architecture/mobile-security.md, "Pairing"). This list,
// not public.devices, decides whose approval signatures count: the server could add a row, main would never pin it.
// The file (with the switches below) is sealed with safeStorage and sits in ~/.weft/vault/, which threads can't read or edit
// (lib/secret-guard-files.ts); one that won't open counts as "paired, none trusted", so tampering fails closed.
const fs = require("node:fs");
const path = require("node:path");
const { verifySignature } = require("./pairing-crypto.cjs");
const { passkeyOrigins, verifyPasskeyAssertion } = require("./passkey-verify.cjs");

/**
 * A browser paired with a passkey also has `passkey`: its credential id, its P-256 public key (SPKI, base64url) and the
 * last sign counter seen (lib/approval-passkey-check.ts checks the signature; this list decides whose key counts).
 * @typedef {{ credId: string, publicKey: string, counter: number }} PinnedPasskey
 * @typedef {{ id: string, name: string, kind: "phone"|"browser", platform: string, signKey: string, boxKey: string,
 *   fingerprint: string, orgId: string, pairedAt: string, passkey?: PinnedPasskey }} PairedDevice
 */

// Settings → Sync's two switches live here too, where a thread can't flip them (a thread can call the server's own
// routes): seal synced threads, and let an unsigned Allow from the web through once a phone is paired. Both off.
/** @typedef {{ seal: boolean, webApprovals: boolean }} Settings */
const DEFAULTS = { seal: false, webApprovals: false };

/**
 * devOrigin: one extra origin a passkey may sign from (a local web board), passed only when Weft isn't packaged.
 * self: this Mac's own approval key (electron/desktop-signer.cjs), so the desktop's signed Allow checks on the same
 * path as a phone's. It is never pinned in the list, so it doesn't count as an approver.
 * @param {{ dir: string, safeStorage: () => { encryptString: (s: string) => Buffer, decryptString: (b: Buffer) => string }, sodium: () => any, devOrigin?: string | null,
 *   self?: { id: () => string, verify: (message: string, sig: string) => boolean } }} deps
 */
function createPairedDevices({ dir, safeStorage, sodium, devOrigin = null, self = null }) {
  const origins = passkeyOrigins(devOrigin);
  const file = path.join(dir, "vault", "paired-devices.json");

  /** @returns {{ devices: PairedDevice[], settings: Settings, broken: boolean }} */
  function read() {
    if (!fs.existsSync(file)) return { devices: [], settings: { ...DEFAULTS }, broken: false };
    try {
      const plain = safeStorage().decryptString(Buffer.from(fs.readFileSync(file, "utf8"), "base64"));
      const parsed = JSON.parse(plain);
      const saved = parsed.settings ?? {};
      return {
        devices: Array.isArray(parsed.devices) ? parsed.devices : [],
        settings: { seal: saved.seal === true, webApprovals: saved.webApprovals === true },
        broken: false,
      };
    } catch {
      return { devices: [], settings: { ...DEFAULTS }, broken: true };
    }
  }

  function write(devices, settings) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, safeStorage().encryptString(JSON.stringify({ devices, settings })).toString("base64"), { mode: 0o600 });
  }

  // A pin replaces one under the same id only when it is the same device (same box key): the id comes from the server,
  // which must not be able to swap a pinned phone's keys for its own by reusing that phone's id.
  /** @param {PairedDevice} device */
  function pin(device) {
    const { devices, settings } = read();
    const known = devices.find((d) => d.id === device.id);
    if (known && known.boxKey !== device.boxKey) throw new Error("That device id is already paired with other keys. Revoke it first.");
    write([...devices.filter((d) => d.id !== device.id), device], settings);
  }

  function unpin(id) {
    const { devices, settings } = read();
    const left = devices.filter((d) => d.id !== id);
    write(left, settings);
    return devices.length !== left.length;
  }

  const settings = () => read().settings;

  /** @param {Partial<Settings>} change */
  function setSettings(change) {
    const { devices, settings: now } = read();
    const next = { ...now };
    if (typeof change.seal === "boolean") next.seal = change.seal;
    if (typeof change.webApprovals === "boolean") next.webApprovals = change.webApprovals;
    write(devices, next);
    return next;
  }

  const list = () => read().devices;

  // How many devices can approve (phones, and browsers with a passkey); a broken file counts as one, so unsigned Allows
  // stay refused.
  function approvers() {
    const { devices, broken } = read();
    return broken ? Math.max(1, devices.length) : devices.filter((d) => d.kind === "phone" || d.passkey).length;
  }

  /**
   * Whether a browser's passkey assertion over `message` is the pinned passkey's (electron/passkey-verify.cjs). On
   * success the new counter is kept in the same step, so a counter only moves with a signature that checked out.
   * @returns {{ ok: true, name: string } | { ok: false, reason: string }}
   */
  function verifyPasskey({ device, credId, message, authenticatorData, clientDataJSON, signature }) {
    const { devices, settings } = read();
    const found = devices.find((d) => d.id === device);
    if (!found) return { ok: false, reason: "That device isn't paired with this Mac." };
    if (found.kind !== "browser" || !found.passkey || found.passkey.credId !== credId) return { ok: false, reason: "That passkey isn't paired with this Mac." };
    const result = verifyPasskeyAssertion({ authenticatorData, clientDataJSON, signature }, found.passkey, message, origins);
    if (!result.ok) return result;
    found.passkey = { ...found.passkey, counter: result.counter };
    write(devices, settings);
    return { ok: true, name: found.name };
  }

  /** Whether `sig` over `message` is a pinned phone's or this Mac's own. @returns {{ ok: true, name: string } | { ok: false, reason: string }} */
  function verify({ device, message, sig }) {
    if (self && device === self.id()) return self.verify(message, sig) ? { ok: true, name: "This Mac" } : { ok: false, reason: "The approval's signature doesn't check out." };
    const found = read().devices.find((d) => d.id === device);
    if (!found) return { ok: false, reason: "That device isn't paired with this Mac." };
    if (found.kind !== "phone") return { ok: false, reason: "Only a paired phone can approve." };
    if (!verifySignature(sodium(), message, sig, found.signKey)) return { ok: false, reason: "The approval's signature doesn't check out." };
    return { ok: true, name: found.name };
  }

  return { pin, unpin, list, approvers, verify, verifyPasskey, settings, setSettings, file };
}

module.exports = { createPairedDevices };
