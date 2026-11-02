// How scripts/weft-worker.ts wires a worker's secret runs (docs/architecture/project-hosts.md#secrets-on-a-worker-h8-the-per-use-seal-as-built):
// the link a card's mcp__secrets__run asks the Mac through, signed with sign-key.json when the box was paired (H10), the
// daemon's secret_use handler with the Mac keys it trusts, and what `weft-worker status` shows to compare with the Mac.
// Since T2 (project-hosts.md#the-vault-on-a-worker-t2-as-built) also the vault link the other secrets
// tools ask through (lib/worker-vault.ts).
import { createPrivateKey, sign } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { CloudCommandRow } from "./cloud-commands";
import type { Registry } from "./worker-registry";
import { deliverSecretUse } from "./worker-secret-asks";
import type { SecretLink } from "./worker-secret-run";
import { macKeysAt } from "./worker-mac-keys";
import { open, sealFingerprint, type SealKeys } from "./worker-seal";
import { setVaultLink } from "./worker-vault";

// The pairing's sign key, read only: a token-enrolled box has none, and making one here would sign with a key no Mac pinned.
export function pairedSigner(home: string): ((message: string) => string) | undefined {
  try {
    const keys = JSON.parse(fs.readFileSync(path.join(home, "sign-key.json"), "utf8")) as { privateKey?: unknown };
    if (typeof keys.privateKey !== "string") return undefined;
    const key = createPrivateKey({ key: Buffer.from(keys.privateKey, "base64"), format: "der", type: "pkcs8" });
    return (message) => sign(null, Buffer.from(message), key).toString("base64");
  } catch {
    return undefined;
  }
}

export function secretWiring(home: string, reg: Pick<Registry, "secretAsk" | "deviceResult" | "deviceCancel">, keys: SealKeys) {
  const signer = pairedSigner(home);
  const macs = macKeysAt(home);
  const link: SecretLink = { ask: reg.secretAsk, result: reg.deviceResult, cancel: reg.deviceCancel, boxKey: keys.publicKey, ...(signer ? { sign: signer } : {}) };
  setVaultLink({ boxKey: keys.publicKey, macKey: () => macs.pinned()[0], ...(signer ? { sign: signer } : {}) });
  return {
    link,
    use: (command: CloudCommandRow) => deliverSecretUse(command, (sealed, purpose) => open(keys, sealed, purpose), macs),
  };
}

// `weft-worker status`'s lines about the keys: the box key's fingerprint (the Mac's approval window and Re-pin show the
// same), whether asks are signed, and whether it takes secrets from a paired Mac. Reads only; makes no key.
export function keyStatus(home: string): string[] {
  const lines: string[] = [];
  try {
    const { publicKey } = JSON.parse(fs.readFileSync(path.join(home, "seal-key.json"), "utf8")) as { publicKey?: unknown };
    if (typeof publicKey === "string") lines.push(`Box key fingerprint: ${sealFingerprint(publicKey)} (your Mac shows the same when it asks for secrets)`);
  } catch {
    lines.push("No box key yet: it's made when the worker first starts.");
  }
  lines.push(pairedSigner(home) ? "Secret asks are signed with this box's pairing key." : "Secret asks aren't signed (enrolled by token, not paired).");
  const macs = macKeysAt(home).pinned().length;
  lines.push(macs ? `Takes secrets from the Mac it was paired with (weft-worker forget-macs to stop).` : "Takes no secrets: enrolled by token. Pair it from Settings → Devices → Add a worker to use secrets.");
  return lines;
}

export const forgetMacs = (home: string) => macKeysAt(home).forget();
