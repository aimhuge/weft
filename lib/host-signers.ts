// The keys a Weft Worker trusts to widen what its cards can touch (docs/architecture/project-hosts.md#signed-widening-as-built):
// its own pin lists, as a Mac's is electron/paired-devices.cjs. The server's rows never add to them.
//
// - The pairing Mac: its desktop approval key (electron/desktop-signer.cjs), Ed25519, the one H8 pins from the pairing
//   code the person carried to the box (lib/worker-mac-keys.ts, mac-keys.json). Secret asks and widenings trust the
//   same Mac and no other.
// - A browser's passkey: endorsed by that Mac, whose key signs `weft-endorse-v2` over the whole set for this worker
//   (lib/host-endorse.ts; a `pin` command, lib/worker-kinds.ts). The worker keeps the newest set and each counter, as
//   main does, in passkeys.json.
//
// Both files sit in the worker's home, mode 600; threads on the worker can't read or write that home
// (lib/secret-guard-files.ts sealedInHome).
import fs from "node:fs";
import path from "node:path";
import { endorseMessage, ENDORSE_MAX_AGE_MS, ENDORSE_OLD, readEndorsement } from "./host-endorse";
import { verifyPasskeyAssertion, type PasskeyOrigin } from "./passkey-verify";
import type { Verified } from "./widen-check";
import { macKeysAt, macSigned, type MacKeys } from "./worker-mac-keys";

export interface PinnedPasskey {
  device: string;
  credId: string;
  // P-256 SPKI, base64url.
  publicKey: string;
  counter: number;
  // The Mac whose key endorsed it.
  by: string;
}

// passkeys.json: the set the newest endorsement named, and that endorsement's generation.
interface Pinned {
  generation: number;
  passkeys: PinnedPasskey[];
}

export const NO_MAC = "This worker trusts no Mac yet: pair it again from Settings → Devices (weft-worker enrol <code> --re-pair on the box).";

export function createHostSigners(home: string, origins: readonly PasskeyOrigin[], macs: MacKeys = macKeysAt(home)) {
  const file = path.join(home, "passkeys.json");

  function load(): Pinned {
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
      // A list from before generations: generation 0, so the next endorsement replaces it.
      if (Array.isArray(parsed)) return { generation: 0, passkeys: parsed as PinnedPasskey[] };
      const p = parsed as Partial<Pinned> | null;
      return { generation: Number(p?.generation) || 0, passkeys: Array.isArray(p?.passkeys) ? p.passkeys : [] };
    } catch {
      return { generation: 0, passkeys: [] };
    }
  }

  const read = () => load().passkeys;

  function write(pinned: Pinned) {
    fs.mkdirSync(home, { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, `${JSON.stringify(pinned, null, 2)}\n`, { mode: 0o600 });
    fs.chmodSync(file, 0o600);
  }

  // An Ed25519 signature by the pairing Mac's key. `device` names the Mac in its message; the key is what's trusted.
  function verify({ message, sig }: { device: string; message: string; sig: string }): Promise<Verified> {
    const keys = macs.pinned();
    if (!keys.length) return Promise.resolve({ ok: false, reason: NO_MAC });
    const ok = keys.some((key) => macSigned(key, message, sig));
    return Promise.resolve(ok ? { ok: true } : { ok: false, reason: "The approval's signature isn't the pairing Mac's." });
  }

  async function verifyPasskey(body: { device: string; credId: string; message: string; authenticatorData: string; clientDataJSON: string; signature: string }): Promise<Verified> {
    const pinned = load();
    const found = pinned.passkeys.find((p) => p.device === body.device && p.credId === body.credId);
    if (!found) return { ok: false, reason: "That passkey isn't trusted on this worker. Let it approve here from Weft on your Mac (Settings → Devices)." };
    const result = await verifyPasskeyAssertion(body, found, body.message, origins);
    if (!result.ok) return result;
    write({ ...pinned, passkeys: pinned.passkeys.map((p) => (p === found ? { ...p, counter: result.counter } : p)) });
    return { ok: true };
  }

  // A pinned Mac's endorsement of the whole set of passkeys for this worker: once it checks out and is newer than the
  // one kept, it replaces the list (a passkey kept keeps its counter; one left out is unpinned).
  async function endorse(raw: unknown, self: string, now: number): Promise<void> {
    const e = readEndorsement(raw);
    if (!e) throw new Error("That passkey endorsement is incomplete.");
    if (e.worker !== self) throw new Error("That endorsement is for another worker.");
    if (Math.abs(now - e.issuedAt) > ENDORSE_MAX_AGE_MS) throw new Error("That endorsement is too old. Send it again from your Mac.");
    const checked = await verify({ device: e.mac, message: endorseMessage(e), sig: e.sig });
    if (!checked.ok) throw new Error(checked.reason);
    const pinned = load();
    if (e.generation <= pinned.generation) throw new Error(ENDORSE_OLD);
    const same = (p: PinnedPasskey, k: { device: string; credId: string; publicKey: string }) => p.device === k.device && p.credId === k.credId && p.publicKey === k.publicKey;
    const passkeys = e.passkeys.map((k) => ({ ...k, counter: pinned.passkeys.find((p) => same(p, k))?.counter ?? 0, by: e.mac }));
    write({ generation: e.generation, passkeys });
  }

  return { read, verify, verifyPasskey, endorse, file };
}

export type HostSigners = ReturnType<typeof createHostSigners>;
