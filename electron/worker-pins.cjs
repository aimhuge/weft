// The Weft Workers' keys this Mac trusts, pinned by main itself (docs/architecture/project-hosts.md, H8). A worker's
// public_key on cloud_workers can be rewritten by anyone holding its `wwk_` key (worker_set_public_key), so main never
// seals vault values to whatever the row says: the first key it sees for a worker is pinned (trust on first use), and a
// different key later is refused until the user re-enrols the worker (a new worker id) or re-pins it. A worker paired
// through Settings → Devices is pinned at pairing with its sign key too; a token-enrolled one only after its first
// Allow. The file sits beside the paired devices in ~/.weft/vault/, sealed with safeStorage, which threads can't read or edit
// (lib/secret-guard-files.ts). One that won't open refuses every worker: tampering fails closed.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

/**
 * @typedef {{ publicKey: string, name: string, pinnedAt: string, signKey?: string }} WorkerPin
 * signKey is the worker's Ed25519 key from pairing, once H10 gives workers one (see verifyAsk in electron/worker-secret.cjs).
 */

/** A short fingerprint of a public key, for the approval window and `weft-worker status`. @param {string} publicKey */
function fingerprint(publicKey) {
  const hex = crypto.createHash("sha256").update(Buffer.from(String(publicKey), "base64")).digest("hex").slice(0, 16);
  return hex.match(/.{4}/g).join(" ");
}

/**
 * @param {{ dir: string, safeStorage: () => { encryptString: (s: string) => Buffer, decryptString: (b: Buffer) => string }, now?: () => Date }} deps
 */
function createWorkerPins({ dir, safeStorage, now = () => new Date() }) {
  const file = path.join(dir, "vault", "worker-pins.json");

  /** @returns {Record<string, WorkerPin>} */
  function read() {
    if (!fs.existsSync(file)) return {};
    try {
      const parsed = JSON.parse(safeStorage().decryptString(Buffer.from(fs.readFileSync(file, "utf8"), "base64")));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not a pin list");
      return parsed;
    } catch {
      throw new Error("This Mac's pinned worker keys won't open, so no worker gets secrets. Remove ~/.weft/vault/worker-pins.json and re-enrol your workers.");
    }
  }

  /** @param {Record<string, WorkerPin>} pins */
  function write(pins) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, safeStorage().encryptString(JSON.stringify(pins)).toString("base64"), { mode: 0o600 });
  }

  return {
    /**
     * What this Mac trusts for a worker, without writing anything: its pin (firstUse false), or the row's key to show
     * and pin after the user allows (firstUse true). Throws when the row's key isn't the pinned one.
     * @param {{ id: string, name: string, publicKey: string }} worker
     * @returns {{ publicKey: string, signKey?: string, fingerprint: string, firstUse: boolean }}
     */
    lookup({ id, name, publicKey }) {
      const pinned = read()[id];
      if (!pinned) return { publicKey, fingerprint: fingerprint(publicKey), firstUse: true };
      if (pinned.publicKey !== publicKey) {
        throw new Error(`${name}'s key changed since this Mac pinned it (${fingerprint(pinned.publicKey)}, now ${fingerprint(publicKey)}), so it gets no secrets. If you reset the worker, re-enrol it or use Re-pin in Settings → Devices; if you didn't, someone may hold its key.`);
      }
      return { publicKey: pinned.publicKey, ...(pinned.signKey ? { signKey: pinned.signKey } : {}), fingerprint: fingerprint(publicKey), firstUse: false };
    },

    /**
     * Pins a worker's keys: after the user allowed its first ask (trust on first use), or at pairing, under that
     * Touch ID, with the Ed25519 key it signs asks with (electron/host-pairing.cjs).
     * @param {string} id @param {{ name: string, publicKey: string, signKey?: string }} keys
     */
    pin(id, { name, publicKey, signKey }) {
      write({ ...read(), [id]: { publicKey, name, pinnedAt: now().toISOString(), ...(signKey ? { signKey } : {}) } });
    },

    /** Drops a worker's pin (Settings → Devices → Re-pin, after Touch ID), so its next ask pins afresh. @param {string} id */
    forget(id) {
      const pins = read();
      if (!pins[id]) return false;
      delete pins[id];
      write(pins);
      return true;
    },
  };
}

module.exports = { createWorkerPins, fingerprint };
