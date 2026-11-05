// A Mac's device key for tests of a worker's secret_use (lib/worker-mac-keys.ts): a raw Ed25519 key in base64, as
// electron/desktop-signer.cjs holds it, and a signer over secretUseMessage.
import crypto from "node:crypto";
import { secretUseMessage } from "./secret-use";
import type { MacKeys } from "./worker-mac-keys";
import type { Sealed } from "./worker-seal";

export function macSigner() {
  const pair = crypto.generateKeyPairSync("ed25519");
  const key = Buffer.from(pair.publicKey.export({ format: "jwk" }).x as string, "base64url").toString("base64");
  const sign = (message: string) => crypto.sign(null, Buffer.from(message), pair.privateKey).toString("base64");
  return { key, sign, mac: (card: string, nonce: string, sealed: Sealed) => ({ key, sig: sign(secretUseMessage(card, nonce, sealed)) }) };
}

// Mac keys held in memory, as mac-keys.json would hold them.
export function memoryMacs(start: string[] = []): MacKeys & { keys: string[] } {
  const keys = [...start];
  return { keys, pinned: () => [...keys], pin: (k) => void keys.push(k) };
}
