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

// A JSON list of strings in the worker's home: [] when the file is missing; null when it's there but won't read.
function readKeys(file: string): string[] | null {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  try {
    const keys: unknown = JSON.parse(text);
    return Array.isArray(keys) ? keys.filter((k): k is string => typeof k === "string") : null;
  } catch {
    return null;
  }
}

function writeKeys(home: string, file: string, keys: string[]) {
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, `${JSON.stringify(keys)}\n`, { mode: 0o600 });
}

// A file of base64 Ed25519 public keys (libsodium's raw 32 bytes). One that won't parse trusts no Mac.
// `pinned()` is the Macs it trusts now: a key marked revoked (mac-revoked.json, written when the database says the pairing
// Mac was revoked: lib/worker-mac-revocation.ts) stays out for good, and a revoked list that won't read trusts none.
// `held()` is every key pinned, revoked or not, for counting who could approve (a revoked Mac mustn't lower the bar).
export function macKeysAt(home: string): MacKeys & { forget(): void; held(): string[]; revoked(): string[]; revoke(keys: string[]): void } {
  const file = path.join(home, "mac-keys.json");
  const revokedFile = path.join(home, "mac-revoked.json");
  const read = () => readKeys(file) ?? [];
  const revoked = () => readKeys(revokedFile);
  return {
    pinned() {
      const out = revoked();
      return out ? read().filter((k) => !out.includes(k)) : [];
    },
    held: read,
    revoked: () => revoked() ?? [],
    pin(key) {
      const keys = read();
      if (keys.includes(key)) return;
      writeKeys(home, file, [...keys, key]);
    },
    // Kept across forget() and a re-pair: a revoked Mac's key is never trusted on this box again.
    revoke(keys) {
      const was = revoked();
      // A list that won't read already trusts no Mac: writing over it would trust the rest again.
      if (!was) return;
      const next = [...new Set([...was, ...keys])];
      if (next.length !== was.length) writeKeys(home, revokedFile, next);
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

// At enrolment by pairing: trust the Mac key the code carries, in place of any Mac trusted before, so a pairing can't
// add a second Mac beside the real one. An older code without a key leaves the box taking no secrets.
export function trustPairingMac(home: string, code: string): boolean {
  const key = parsePairCode(code)?.macKey;
  const macs = macKeysAt(home);
  macs.forget();
  if (!key) return false;
  macs.pin(key);
  return true;
}

// Why `weft-worker enrol` won't run, or null. An enrolled box re-pairs only with an explicit --re-pair typed at a
// terminal on the box, and then only on an approval its trusted Mac signed (lib/worker-repair.ts repairRefusal): the
// terminal is a speed bump, since a thread fakes one with any pty; the signature is the check.
// lib/worker-cli-guard.ts also keeps threads from running weft-worker at all.
export function enrolRefusal(enrolled: boolean, rePair: boolean, terminal: boolean): string | null {
  if (!enrolled) return null;
  if (!rePair) return "This box is already enrolled. To pair it again, approve the re-pair on the Mac it trusts now (Settings → Devices → this worker → Approve re-pair) and run the command that shows, from a terminal on the box.";
  return terminal ? null : "--re-pair only runs from a terminal on the box: it chooses the Mac this worker trusts with secrets.";
}
