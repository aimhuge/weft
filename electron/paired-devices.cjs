// The devices this Mac paired, pinned by main itself (docs/architecture/mobile-security.md, "Pairing"). This list,
// not public.devices, decides whose approval signatures count: the server could add a row, main would never pin it.
// The file (with the switches below) is sealed with safeStorage and sits in ~/.weft/vault/, which threads can't read or edit
// (lib/secret-guard-files.ts); one that won't open counts as "paired, none trusted", so tampering fails closed.
const fs = require("node:fs");
const path = require("node:path");
const { verifySignature } = require("./pairing-crypto.cjs");

/**
 * @typedef {{ id: string, name: string, kind: "phone"|"browser", platform: string, signKey: string, boxKey: string,
 *   fingerprint: string, orgId: string, pairedAt: string }} PairedDevice
 */

// Settings → Sync's two switches live here too, where a thread can't flip them (a thread can call the server's own
// routes): seal synced threads, and let an unsigned Allow from the web through once a phone is paired. Both off.
/** @typedef {{ seal: boolean, webApprovals: boolean }} Settings */
const DEFAULTS = { seal: false, webApprovals: false };

/** @param {{ dir: string, safeStorage: () => { encryptString: (s: string) => Buffer, decryptString: (b: Buffer) => string }, sodium: () => any }} deps */
function createPairedDevices({ dir, safeStorage, sodium }) {
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

  /** @param {PairedDevice} device */
  function pin(device) {
    const { devices, settings } = read();
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

  // How many phones can approve; a broken file counts as one, so unsigned Allows stay refused.
  function approvers() {
    const { devices, broken } = read();
    return broken ? Math.max(1, devices.length) : devices.filter((d) => d.kind === "phone").length;
  }

  /** Whether `sig` over `message` is a pinned phone's. @returns {{ ok: true, name: string } | { ok: false, reason: string }} */
  function verify({ device, message, sig }) {
    const found = read().devices.find((d) => d.id === device);
    if (!found) return { ok: false, reason: "That device isn't paired with this Mac." };
    if (found.kind !== "phone") return { ok: false, reason: "Only a paired phone can approve." };
    if (!verifySignature(sodium(), message, sig, found.signKey)) return { ok: false, reason: "The approval's signature doesn't check out." };
    return { ok: true, name: found.name };
  }

  return { pin, unpin, list, approvers, verify, settings, setSettings, file };
}

module.exports = { createPairedDevices };
