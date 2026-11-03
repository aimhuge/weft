// The LAN path to a Weft Worker (docs/architecture/weft-worker.md#the-lan-path): the server asks main for a worker's
// pinned keys, to check its mDNS hint and seal to the box key this Mac pinned (not to whatever cloud_workers says), and
// for this Mac's signature over the sealed offer it posts, which is what the worker's LAN port takes it on.
//
// The key is this Mac's device key (electron/desktop-signer.cjs), the one the pairing code carried to the box, used with
// no Touch ID as electron/settings-sign.cjs uses it: a line opens whenever a worker's project is on screen. What's signed
// is built here from checked fields under its own prefix ("weft-lan-offer-v1": a worker id, main's own time and nonce,
// and a 64-hex digest), so the signature can only mean "this Mac offers a line to this worker, now, with these bytes":
// never an approval, a secret_use or settings. Only workers this Mac paired (a pinned sign key and box key) get one.
// Only the server holds the control server's token; threads reach main only through the tools it offers, and none
// offers these routes. A line opened this way is what the `line` row opens anyway, and the worker's checks on its verbs
// (remoteRefusal, CardRules, signed widening for a shell or terminal) are unchanged.
const crypto = require("node:crypto");

const PREFIX = "weft-lan-offer-v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;

// Main's copy of lib/lan-hint.ts lanOfferMessage; electron/lan-line-sign.test.ts holds them together.
function lanOfferMessage(workerId, issuedAt, nonce, digest) {
  return [PREFIX, workerId, String(issuedAt), nonce, digest].join("\n");
}

function workerIdOf(body) {
  const id = body?.workerId;
  if (typeof id !== "string" || !UUID.test(id)) throw new Error("That names no worker.");
  return id.toLowerCase();
}

/**
 * @param {{ pins: () => { pinned: (id: string) => { publicKey?: string, signKey?: string } | null }, signer: () => Promise<{ sign: (m: string) => string, publicKey: () => string }>, now?: () => number }} deps
 */
function lanLineRoutes({ pins, signer, now = Date.now }) {
  // The worker's keys as this Mac pinned them, or null for one it didn't pair (or re-pinned and hasn't re-pinned yet).
  const pinned = (id) => {
    const pin = pins().pinned(id);
    return pin?.signKey && pin.publicKey ? { signKey: pin.signKey, boxKey: pin.publicKey } : null;
  };
  return {
    "POST /lan-line/keys": (body) => pinned(workerIdOf(body)) ?? {},
    "POST /lan-line/sign": async (body) => {
      const workerId = workerIdOf(body);
      const digest = body?.digest;
      if (typeof digest !== "string" || !DIGEST.test(digest)) throw new Error("That names no offer.");
      if (!pinned(workerId)) throw new Error("This Mac didn't pair that worker, so it offers it nothing over the LAN.");
      const key = await signer();
      const issuedAt = now();
      const nonce = crypto.randomBytes(16).toString("hex");
      return { key: key.publicKey(), sig: key.sign(lanOfferMessage(workerId, issuedAt, nonce, digest)), issuedAt, nonce };
    },
  };
}

module.exports = { lanLineRoutes, lanOfferMessage };
