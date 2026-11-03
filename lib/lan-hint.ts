// The LAN path to a Weft Worker (docs/architecture/weft-worker.md#the-lan-path): the signed mDNS hint a worker advertises
// and the signed offer a Mac posts to it, shared by both ends so they read and sign the same bytes.
//
//   hint   _weft._tcp TXT: v, id (worker id), fp (its box key's fingerprint), port, at (ms), sig: Ed25519 by the
//          worker's sign key, the one this Mac pinned at pairing (electron/worker-pins.cjs signKey), over hintMessage.
//          A Mac takes a hint only when the signature checks against that pin, the fingerprint is the pinned box key's,
//          and `at` is fresh. It says nothing about the address: whoever answers there still can't open the offer.
//   offer  POST /line { v, workerId, sealed, mac: { key, sig, issuedAt, nonce } }: the same sealed offer the `line` row
//          carries (LINE_PURPOSE, to the pinned box key), signed by this Mac's device key (the pairing code's macKey,
//          electron/lan-line-sign.cjs) over lanOfferMessage, so the worker takes it only from the Mac it was paired with,
//          once (the nonce), and only fresh.
import crypto from "node:crypto";
import { sealedOf, sealFingerprint, type Sealed } from "./worker-seal";

export const LAN_SERVICE = "_weft._tcp.local";
export const HINT_PREFIX = "weft-lan-hint-v1";
export const OFFER_PREFIX = "weft-lan-offer-v1";
// A hint signed longer ago than this (or this far ahead, a box whose clock runs fast) is refused. The worker signs a
// fresh one every HINT_REFRESH_MS.
export const HINT_MAX_AGE_MS = 5 * 60_000;
export const HINT_REFRESH_MS = 60_000;
// An offer is posted the moment main signs it; the worker takes it this long either side of its own clock.
export const OFFER_MAX_SKEW_MS = 60_000;
export const LAN_PATH = "/line";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FP = /^[0-9a-f]{16}$/;
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
const NONCE = /^[0-9a-f]{32}$/;

export interface Hint {
  id: string;
  fp: string;
  port: number;
  at: number;
}
export type SignedHint = Hint & { sig: string };

// A box key's fingerprint as the TXT carries it: sealFingerprint without its spaces.
export const hintFingerprint = (boxKey: string) => sealFingerprint(boxKey).replace(/ /g, "");

export const hintMessage = (h: Hint) => [HINT_PREFIX, h.id, h.fp, String(h.port), String(h.at)].join("\n");

const isPort = (n: number) => Number.isInteger(n) && n > 0 && n < 65_536;

// The TXT strings for a signed hint, each well under the 255 bytes one string may hold.
export function hintTxt(h: SignedHint): string[] {
  return [`v=1`, `id=${h.id}`, `fp=${h.fp}`, `port=${h.port}`, `at=${h.at}`, `sig=${h.sig}`];
}

// A TXT record's strings (Buffers off the wire) read back as a hint, or null for anything short of a whole one.
export function readHintTxt(data: unknown): SignedHint | null {
  if (!Array.isArray(data) || data.length > 16) return null;
  const fields = new Map<string, string>();
  for (const raw of data) {
    const text = Buffer.isBuffer(raw) ? raw.toString("utf8") : typeof raw === "string" ? raw : null;
    if (text === null || text.length > 255) return null;
    const at = text.indexOf("=");
    if (at > 0) fields.set(text.slice(0, at), text.slice(at + 1));
  }
  return hintOf((k) => fields.get(k) ?? "");
}

function hintOf(get: (key: string) => string): SignedHint | null {
  const [v, id, fp, port, when, sig] = [get("v"), get("id"), get("fp"), get("port"), get("at"), get("sig")];
  if (v !== "1" || !UUID.test(id) || !FP.test(fp) || !/^\d{1,5}$/.test(port) || !/^\d{1,15}$/.test(when)) return null;
  if (!B64.test(sig) || sig.length > 120 || !isPort(Number(port))) return null;
  return { id: id.toLowerCase(), fp, port: Number(port), at: Number(when), sig };
}

// An Ed25519 key as cloud_workers.sign_key and the pins hold it: SPKI DER, base64.
const spki = (key: string) => crypto.createPublicKey({ key: Buffer.from(key, "base64"), format: "der", type: "spki" });

export function signHint(h: Hint, sign: (message: string) => string): SignedHint {
  return { ...h, sig: sign(hintMessage(h)) };
}

// Whether a hint is this worker's, signed by the sign key this Mac pinned, for the box key it pinned, and fresh.
export function hintChecks(h: SignedHint, pinned: { workerId: string; signKey: string; boxKey: string }, now: number): boolean {
  if (h.id !== pinned.workerId.toLowerCase() || h.fp !== hintFingerprint(pinned.boxKey)) return false;
  if (h.at < now - HINT_MAX_AGE_MS || h.at > now + HINT_MAX_AGE_MS) return false;
  try {
    return crypto.verify(null, Buffer.from(hintMessage(h)), spki(pinned.signKey), Buffer.from(h.sig, "base64"));
  } catch {
    return false;
  }
}

// What the Mac signs over: the sealed offer's own bytes, by digest, so a signature can't be moved onto another offer.
export const offerDigest = (sealed: Sealed) => crypto.createHash("sha256").update(JSON.stringify([sealed.v, sealed.epk, sealed.iv, sealed.ct, sealed.tag])).digest("hex");

export interface MacStamp {
  key: string;
  sig: string;
  issuedAt: number;
  nonce: string;
}

export const lanOfferMessage = (workerId: string, issuedAt: number, nonce: string, digest: string) => [OFFER_PREFIX, workerId, String(issuedAt), nonce, digest].join("\n");

export interface LanOffer {
  v: 1;
  workerId: string;
  sealed: Sealed;
  mac: MacStamp;
}

const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);

export function readMacStamp(v: unknown): MacStamp | null {
  if (!isObject(v)) return null;
  const { key, sig, issuedAt, nonce } = v;
  if (typeof key !== "string" || !B64.test(key) || key.length > 64) return null;
  if (typeof sig !== "string" || !B64.test(sig) || sig.length > 120) return null;
  if (typeof issuedAt !== "number" || !Number.isSafeInteger(issuedAt) || typeof nonce !== "string" || !NONCE.test(nonce)) return null;
  return { key, sig, issuedAt, nonce };
}

// A posted offer read off the wire, or null for anything short of a whole one.
export function readLanOffer(raw: unknown): LanOffer | null {
  if (!isObject(raw) || raw.v !== 1 || typeof raw.workerId !== "string" || !UUID.test(raw.workerId)) return null;
  const sealed = sealedOf(raw.sealed);
  const mac = readMacStamp(raw.mac);
  return sealed && mac ? { v: 1, workerId: raw.workerId.toLowerCase(), sealed, mac } : null;
}
