// A server patch's feed, patch.json: the patch's details as a JSON string, and an ed25519 signature over that exact
// string. A patch runs code outside the signed .app, so Apple's signature can't vouch for it; this one does. The
// private key lives in the 🔐 vault (WEFT_PATCH_SIGNING_KEY) and signs in scripts/server-patch-release.mjs; the public
// key ships in the app (patch-key.cjs). docs/architecture/updates.md#server-patches
const crypto = require("node:crypto");

const FIELDS = ["version", "build", "seq", "deps", "url", "sha256", "size"];

// { payload, signature } for a patch's details, signed with a base64 PKCS#8 DER ed25519 private key.
function signPatch(details, privateKeyB64) {
  const key = crypto.createPrivateKey({ key: Buffer.from(privateKeyB64, "base64"), format: "der", type: "pkcs8" });
  const payload = JSON.stringify(details);
  const signature = crypto.sign(null, Buffer.from(payload), key).toString("base64");
  return { payload, signature };
}

// The details of a feed whose signature checks out against a base64 SPKI DER public key; throws otherwise.
function verifyPatch(feed, publicKeyB64) {
  if (typeof feed?.payload !== "string" || typeof feed?.signature !== "string") throw new Error("patch feed: malformed");
  const key = crypto.createPublicKey({ key: Buffer.from(publicKeyB64, "base64"), format: "der", type: "spki" });
  if (!crypto.verify(null, Buffer.from(feed.payload), key, Buffer.from(feed.signature, "base64"))) {
    throw new Error("patch feed: bad signature");
  }
  const details = JSON.parse(feed.payload);
  const missing = FIELDS.filter((f) => details[f] === undefined);
  if (missing.length) throw new Error(`patch feed: missing ${missing.join(", ")}`);
  if (!/^https:\/\//.test(details.url)) throw new Error("patch feed: url isn't https");
  return details;
}

// Why this Mac shouldn't take a patch, or null when it should: the patch must be for this app version, built against
// the same packages the app ships, newer than the patch running now, and not one that already failed here.
function whyNot(details, { version, deps, activeSeq = 0, bad = [] }) {
  if (details.version !== version) return `built for Weft ${details.version}, this is ${version}`;
  if (!deps) return "this build has no package fingerprint";
  if (details.deps !== deps) return "built against different packages";
  if (bad.includes(details.build)) return `${details.build} failed to start here before`;
  if (details.seq <= activeSeq) return "not newer than the patch running now";
  return null;
}

module.exports = { signPatch, verifyPatch, whyNot, FIELDS };
