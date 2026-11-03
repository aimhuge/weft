// Keys for the LAN path's tests (lib/lan-*.test.ts, lib/worker-lan*.test.ts): a worker's box and sign keys as it makes
// them, and a Mac's device key in libsodium's raw shape (what the pairing code carries and lib/worker-mac-keys.ts checks).
import crypto from "node:crypto";
import { newSignKeys } from "./host-pairing";
import { lanOfferMessage, offerDigest, type MacStamp } from "./lan-hint";
import { newSealKeys, type Sealed } from "./worker-seal";

export const WORKER = "1a2b3c4d-0000-4000-8000-00000000abcd";

export function workerKeys() {
  const box = newSealKeys();
  const sign = newSignKeys();
  const key = crypto.createPrivateKey({ key: Buffer.from(sign.privateKey, "base64"), format: "der", type: "pkcs8" });
  return { box, sign, signer: (m: string) => crypto.sign(null, Buffer.from(m), key).toString("base64") };
}

export function macKey() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const raw = Buffer.from(publicKey.export({ format: "jwk" }).x as string, "base64url").toString("base64");
  const sign = (m: string) => crypto.sign(null, Buffer.from(m), privateKey).toString("base64");
  // What electron/lan-line-sign.cjs answers for an offer.
  const stamp = (workerId: string, sealed: Sealed, issuedAt: number, nonce = crypto.randomBytes(16).toString("hex")): MacStamp => ({
    key: raw,
    sig: sign(lanOfferMessage(workerId, issuedAt, nonce, offerDigest(sealed))),
    issuedAt,
    nonce,
  });
  return { raw, sign, stamp };
}
