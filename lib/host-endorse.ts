// A Mac's endorsement of the passkeys a worker may trust (docs/architecture/project-hosts.md#signed-widening-as-built):
// `weft-endorse-v2`, signed by main (electron/widen-endorse.cjs) with this Mac's approval key over the whole set for one
// worker and a generation that only grows. The worker replaces its list with the newest set (lib/host-signers.ts), so a
// revoke is a smaller set, and an older endorsement (one read off an earlier `pin` row) is refused.
//
// A set that also names paired phones (their Ed25519 sign keys, so a phone's Face ID Allow counts on the worker) is
// `weft-endorse-v3`, with a `phones` list beside the passkeys. A set with no phones stays v2 byte for byte, so a worker
// from before phones takes it as it always did; a v3 set it can't read fails its signature there and is sent again.
import { canonical } from "./widen";

export const ENDORSE_V = "weft-endorse-v2";
export const ENDORSE_V3 = "weft-endorse-v3";
// An endorsement is signed for one worker and sent at once.
export const ENDORSE_MAX_AGE_MS = 10 * 60_000;
export const ENDORSE_OLD = "That endorsement is older than the one this worker has. Send it again from your Mac.";

// The worker's receipt, signed with its pairing sign key (sign-key.json, H10): it holds this generation or newer. The
// Mac checks it against the key it pinned for that worker (electron/worker-pins.cjs) before it stops re-sending a revoke,
// so a row a stolen session deletes, or one a stolen worker key claims and drops, can't pass for one the worker took.
export const HELD_V = "weft-endorse-held-v1";
export const heldMessage = (h: { worker: string; generation: number }) => canonical({ v: HELD_V, worker: h.worker, generation: h.generation });

export interface EndorsedKey {
  device: string;
  credId: string;
  // P-256 SPKI, base64url.
  publicKey: string;
}

// A phone paired with the Mac: its public.devices id and its Ed25519 sign key (libsodium's raw 32 bytes, base64).
export interface EndorsedPhone {
  device: string;
  signKey: string;
}

export interface Endorsement {
  worker: string;
  passkeys: EndorsedKey[];
  // Absent or empty: a v2 set (passkeys only).
  phones?: EndorsedPhone[];
  generation: number;
  issuedAt: number;
}

const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const byKey = (a: EndorsedKey, b: EndorsedKey) => order(a.device + a.credId, b.device + b.credId);
const byPhone = (a: EndorsedPhone, b: EndorsedPhone) => order(a.device, b.device);

export function endorseMessage(e: Endorsement): string {
  const passkeys = [...e.passkeys].sort(byKey).map((p) => ({ device: p.device, credId: p.credId, publicKey: p.publicKey }));
  if (!e.phones?.length) return canonical({ v: ENDORSE_V, worker: e.worker, passkeys, generation: e.generation, issuedAt: e.issuedAt });
  const phones = [...e.phones].sort(byPhone).map((p) => ({ device: p.device, signKey: p.signKey }));
  return canonical({ v: ENDORSE_V3, worker: e.worker, passkeys, phones, generation: e.generation, issuedAt: e.issuedAt });
}

const ID = /^[A-Za-z0-9_:.-]{1,200}$/;
const KEY = /^[A-Za-z0-9+/_-]{4,400}={0,2}$/;
const isId = (v: unknown): v is string => typeof v === "string" && ID.test(v);
const isKey = (v: unknown): v is string => typeof v === "string" && KEY.test(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function readKey(raw: unknown): EndorsedKey | null {
  const k = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return isId(k.device) && isKey(k.credId) && isKey(k.publicKey) ? { device: k.device, credId: k.credId, publicKey: k.publicKey } : null;
}

// An Ed25519 public key: 32 bytes, base64.
const isSignKey = (v: unknown): v is string => isKey(v) && Buffer.from(v, "base64").length === 32;

function readPhone(raw: unknown): EndorsedPhone | null {
  const p = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return isId(p.device) && isSignKey(p.signKey) ? { device: p.device, signKey: p.signKey } : null;
}

// The phones a set names: [] for a v2 set, null when the list is malformed, too long or names a device twice.
function readPhones(raw: unknown): EndorsedPhone[] | null {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > 20) return null;
  const phones = raw.map(readPhone);
  if (phones.some((p) => !p)) return null;
  const list = phones as EndorsedPhone[];
  return new Set(list.map((p) => p.device)).size === list.length ? list : null;
}

export function readEndorsement(raw: unknown): (Endorsement & { phones: EndorsedPhone[]; mac: string; sig: string }) | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  if (!isId(e.worker) || !isId(e.mac) || !isKey(e.sig) || !finite(e.generation) || !finite(e.issuedAt)) return null;
  if (!Array.isArray(e.passkeys) || e.passkeys.length > 50) return null;
  const passkeys = e.passkeys.map(readKey);
  if (passkeys.some((p) => !p)) return null;
  const phones = readPhones(e.phones);
  if (!phones) return null;
  return { worker: e.worker, passkeys: passkeys as EndorsedKey[], phones, generation: e.generation, issuedAt: e.issuedAt, mac: e.mac, sig: e.sig };
}
