// The keys a Weft Worker trusts to widen what its cards can touch (docs/architecture/project-hosts.md#signed-widening-as-built):
// its own pin lists, as a Mac's is electron/paired-devices.cjs. The server's rows never add to them.
//
// - The pairing Mac: its desktop approval key (electron/desktop-signer.cjs), Ed25519, the one H8 pins from the pairing
//   code the person carried to the box (lib/worker-mac-keys.ts, mac-keys.json). Secret asks and widenings trust the
//   same Mac and no other.
// - A browser's passkey: endorsed by that Mac, whose key signs `weft-endorse-v1` over the passkey after Touch ID
//   (a `pin` command, lib/worker-kinds.ts). The worker keeps its counter, as main does, in passkeys.json.
//
// Both files sit in the worker's home, mode 600; threads on the worker can't read or write that home
// (lib/secret-guard-files.ts sealedInHome).
import fs from "node:fs";
import path from "node:path";
import { verifyPasskeyAssertion, type PasskeyOrigin } from "./passkey-verify";
import { canonical } from "./widen";
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


export const ENDORSE_V = "weft-endorse-v1";
// An endorsement is signed for one worker and used at once: an old one can't be sent again to undo a revoke.
export const ENDORSE_MAX_AGE_MS = 10 * 60_000;

// A Mac's statement that a passkey may (or may no longer) widen on this worker.
export interface Endorsement {
  worker: string;
  device: string;
  credId: string;
  publicKey: string;
  revoke: boolean;
  issuedAt: number;
}

export const endorseMessage = (e: Endorsement) =>
  canonical({ v: ENDORSE_V, worker: e.worker, device: e.device, credId: e.credId, publicKey: e.publicKey, revoke: e.revoke, issuedAt: e.issuedAt });

const ID = /^[A-Za-z0-9_:.-]{1,200}$/;
const KEY = /^[A-Za-z0-9+/_-]{4,400}={0,2}$/;

export function readEndorsement(raw: unknown): (Endorsement & { mac: string; sig: string }) | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  const ids = [e.worker, e.device, e.mac];
  const keys = [e.credId, e.publicKey, e.sig];
  if (!ids.every((v) => typeof v === "string" && ID.test(v)) || !keys.every((v) => typeof v === "string" && KEY.test(v))) return null;
  if (typeof e.revoke !== "boolean" || typeof e.issuedAt !== "number" || !Number.isFinite(e.issuedAt)) return null;
  const s = (v: unknown) => v as string;
  return { worker: s(e.worker), device: s(e.device), credId: s(e.credId), publicKey: s(e.publicKey), revoke: e.revoke, issuedAt: e.issuedAt, mac: s(e.mac), sig: s(e.sig) };
}

export const NO_MAC = "This worker trusts no Mac yet: pair it again from Settings → Devices (weft-worker enrol <code> --re-pair on the box).";

export function createHostSigners(home: string, origins: readonly PasskeyOrigin[], macs: MacKeys = macKeysAt(home)) {
  const file = path.join(home, "passkeys.json");

  function read(): PinnedPasskey[] {
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
      return Array.isArray(parsed) ? (parsed as PinnedPasskey[]) : [];
    } catch {
      return [];
    }
  }

  function write(passkeys: PinnedPasskey[]) {
    fs.mkdirSync(home, { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, `${JSON.stringify(passkeys, null, 2)}\n`, { mode: 0o600 });
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
    const passkeys = read();
    const found = passkeys.find((p) => p.device === body.device && p.credId === body.credId);
    if (!found) return { ok: false, reason: "That passkey isn't trusted on this worker. Let it approve here from Weft on your Mac (Settings → Devices)." };
    const result = await verifyPasskeyAssertion(body, found, body.message, origins);
    if (!result.ok) return result;
    write(passkeys.map((p) => (p === found ? { ...p, counter: result.counter } : p)));
    return { ok: true };
  }

  // A pinned Mac's endorsement of a passkey for this worker: pinned (or unpinned when it revokes) once it checks out.
  async function endorse(raw: unknown, self: string, now: number): Promise<void> {
    const e = readEndorsement(raw);
    if (!e) throw new Error("That passkey endorsement is incomplete.");
    if (e.worker !== self) throw new Error("That endorsement is for another worker.");
    if (Math.abs(now - e.issuedAt) > ENDORSE_MAX_AGE_MS) throw new Error("That endorsement is too old. Send it again from your Mac.");
    const checked = await verify({ device: e.mac, message: endorseMessage(e), sig: e.sig });
    if (!checked.ok) throw new Error(checked.reason);
    const passkeys = read();
    const others = passkeys.filter((p) => !(p.device === e.device && p.credId === e.credId));
    const known = passkeys.find((p) => p.device === e.device && p.credId === e.credId && p.publicKey === e.publicKey);
    write(e.revoke ? others : [...others, { device: e.device, credId: e.credId, publicKey: e.publicKey, counter: known?.counter ?? 0, by: e.mac }]);
  }

  return { read, verify, verifyPasskey, endorse, file };
}

export type HostSigners = ReturnType<typeof createHostSigners>;
