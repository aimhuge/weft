// The Mac a Weft Worker takes secret_use answers from (docs/architecture/project-hosts.md#secrets-on-a-worker-h8-the-per-use-seal-as-built).
// A secret_use is sealed to the worker's public key, which anyone can read, so the sealing alone doesn't say the owner's
// Mac sent it: main also signs it with its approval key (electron/desktop-signer.cjs). The worker trusts only the key
// that came in the pairing code (trustPairingMac), which the user carried from the Mac's screen to the box by hand: never
// one off the network, so a session of the owner's can't race the real Touch ID with a key of its own. Kept in
// mac-keys.json beside seal-key.json, sealed from threads by lib/secret-guard-files.ts. A token-enrolled box has none
// and takes no secrets until it's paired.
import { verify, createPublicKey } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parsePairCode } from "./host-pairing";

export interface MacKeys {
  pinned(): string[];
  pin(key: string): void;
}

// A file of base64 Ed25519 public keys (libsodium's raw 32 bytes). One that won't parse trusts no Mac.
export function macKeysAt(home: string): MacKeys & { forget(): void } {
  const file = path.join(home, "mac-keys.json");
  const read = (): string[] => {
    try {
      const keys: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
      return Array.isArray(keys) ? keys.filter((k): k is string => typeof k === "string") : [];
    } catch {
      return [];
    }
  };
  return {
    pinned: read,
    pin(key) {
      const keys = read();
      if (keys.includes(key)) return;
      fs.mkdirSync(home, { recursive: true, mode: 0o700 });
      fs.writeFileSync(file, `${JSON.stringify([...keys, key])}\n`, { mode: 0o600 });
    },
    forget: () => fs.rmSync(file, { force: true }),
  };
}

// Whether sig (base64) over message is by the raw Ed25519 key (base64), as libsodium's crypto_sign_detached makes it.
export function macSigned(key: string, message: string, sig: string): boolean {
  try {
    const raw = Buffer.from(key, "base64");
    if (raw.length !== 32) return false;
    const pub = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: raw.toString("base64url") }, format: "jwk" });
    return verify(null, Buffer.from(message), pub, Buffer.from(sig, "base64"));
  } catch {
    return false;
  }
}

// At enrolment by pairing: trust the Mac key the code carries. An older code without one leaves the box taking no secrets.
export function trustPairingMac(home: string, code: string): boolean {
  const key = parsePairCode(code)?.macKey;
  if (!key) return false;
  macKeysAt(home).pin(key);
  return true;
}
