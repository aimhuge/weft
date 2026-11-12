// The other Macs this Mac trusts to ask for its uncommitted work (docs/architecture/wip-sync.md#mac-to-mac), pinned by
// main from a code the user carried from that Mac's screen by hand (electron/mac-pair.cjs): never a key off the network,
// so a stolen session can't add one. Kept apart from the phones and browsers in paired-devices.cjs on purpose: a Mac
// pinned here approves nothing, gets no workspace key and counts as no approver. Its key is good for one thing, a signed
// tree.snapshot (lib/mac-snapshot.ts checks it through POST /pairing/verify-mac). Sealed with safeStorage in
// ~/.weft/vault/, which threads can't read or edit; a file that won't open trusts no Mac.
const fs = require("node:fs");
const path = require("node:path");
const { verifySignature } = require("./pairing-crypto.cjs");

/** @typedef {{ id: string, name: string, signKey: string, pairedAt: string }} PinnedMac */

/**
 * @param {{ dir: string, safeStorage: () => { encryptString: (s: string) => Buffer, decryptString: (b: Buffer) => string }, sodium: () => any }} deps
 */
function createMacPins({ dir, safeStorage, sodium }) {
  const file = path.join(dir, "vault", "mac-pins.json");

  /** @returns {PinnedMac[]} */
  function list() {
    if (!fs.existsSync(file)) return [];
    try {
      const parsed = JSON.parse(safeStorage().decryptString(Buffer.from(fs.readFileSync(file, "utf8"), "base64")));
      return Array.isArray(parsed.macs) ? parsed.macs : [];
    } catch {
      return [];
    }
  }

  function write(macs) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, safeStorage().encryptString(JSON.stringify({ macs })).toString("base64"), { mode: 0o600 });
  }

  // A Mac already pinned under this id keeps its key: pairing it again with another key needs Forget first, so a code
  // carrying a known id can't swap the key behind it.
  /** @param {PinnedMac} mac */
  function pin(mac) {
    const macs = list();
    const known = macs.find((m) => m.id === mac.id);
    if (known && known.signKey !== mac.signKey) throw new Error("That Mac is already paired with another key. Forget it first.");
    write([...macs.filter((m) => m.id !== mac.id), mac]);
  }

  function unpin(id) {
    const macs = list();
    const left = macs.filter((m) => m.id !== id);
    write(left);
    return left.length !== macs.length;
  }

  /** Whether `sig` over `message` is a pinned Mac's. @returns {{ ok: true, name: string } | { ok: false, reason: string }} */
  function verify({ device, message, sig }) {
    const found = list().find((m) => m.id === device);
    if (!found) return { ok: false, reason: "That Mac isn't paired with this one. Pair them in Settings → Devices." };
    if (!verifySignature(sodium(), message, sig, found.signKey)) return { ok: false, reason: "The request's signature doesn't check out." };
    return { ok: true, name: found.name };
  }

  return { list, pin, unpin, verify, file };
}

module.exports = { createMacPins };
