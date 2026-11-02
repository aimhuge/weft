// A WebAuthn assertion, checked the way the host checks a browser's signed approval (docs/architecture/mobile-security.md,
// "Passkey approvals"). Pure and isomorphic: Web Crypto only, so the Mac's server, the web and the tests run the same
// bytes. The passkey signs authenticatorData ‖ SHA-256(clientDataJSON) with ES256 (P-256); clientDataJSON carries the
// challenge we asked it to sign, which is base64url(SHA-256(the approval message)), so the signature covers the message.
// The signature comes DER-encoded and Web Crypto wants it raw (r ‖ s), hence derToRaw.

// The passkey lives on sign.weft.zip, never weft.zip itself (lib/sign-origin.ts): a script injected into weft.zip can't
// use it, and the host takes no other origin or rp id (no weft.zip fallback).
export const PASSKEY_RP_ID = "sign.weft.zip";
export const PASSKEY_ORIGIN = "https://sign.weft.zip";

// Where an assertion may come from: an origin and the rp id its authenticatorData must hash. Production is sign.weft.zip only.
export interface PasskeyOrigin {
  origin: string;
  rpId: string;
}

// The pinned key: the passkey's public key as SPKI (base64url) and the last sign counter the host saw.
export interface PinnedPasskey {
  publicKey: string;
  counter: number;
}

// What the browser sends, each part base64url.
export interface PasskeyAssertion {
  authenticatorData: string;
  clientDataJSON: string;
  signature: string;
}

export type PasskeyResult = { ok: true; counter: number } | { ok: false; reason: string };

const FLAG_UP = 0x01;
const FLAG_UV = 0x04;

// sign.weft.zip, plus one explicit dev origin (WEFT_PASSKEY_DEV_ORIGIN, e.g. http://localhost:5001) when not in production.
export function passkeyOrigins(env: { NODE_ENV?: string; WEFT_PASSKEY_DEV_ORIGIN?: string }): PasskeyOrigin[] {
  const origins = [{ origin: PASSKEY_ORIGIN, rpId: PASSKEY_RP_ID }];
  const dev = env.WEFT_PASSKEY_DEV_ORIGIN;
  if (!dev || env.NODE_ENV === "production") return origins;
  try {
    const url = new URL(dev);
    return [...origins, { origin: url.origin, rpId: url.hostname }];
  } catch {
    return origins;
  }
}

export function toB64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Strict: the URL-safe alphabet, no padding, and canonical (a length of 4n+1, or stray bits in the last character, is
// refused), so this and electron/passkey-verify.cjs take exactly the same strings.
export function fromB64url(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) throw new Error("not base64url");
  const bin = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  if (toB64url(bytes) !== text) throw new Error("not canonical base64url");
  return bytes;
}

export async function sha256(data: Uint8Array | string): Promise<Uint8Array> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
}

// The challenge a passkey signs for this message.
export const passkeyChallenge = async (message: string) => toB64url(await sha256(message));

// One DER INTEGER as exactly 32 bytes: its sign byte dropped, short values left-padded. Null when it's not one.
function derInt(der: Uint8Array, at: number): { value: Uint8Array; next: number } | null {
  if (der[at] !== 0x02) return null;
  const len = der[at + 1] ?? 0;
  let bytes = der.subarray(at + 2, at + 2 + len);
  if (len === 0 || bytes.length !== len) return null;
  while (bytes.length > 1 && bytes[0] === 0) bytes = bytes.subarray(1);
  if (bytes.length > 32) return null;
  const value = new Uint8Array(32);
  value.set(bytes, 32 - bytes.length);
  return { value, next: at + 2 + len };
}

// ECDSA-Sig-Value ::= SEQUENCE { r INTEGER, s INTEGER } → r ‖ s, or null when the bytes aren't that.
export function derToRaw(der: Uint8Array): Uint8Array | null {
  if (der[0] !== 0x30 || der[1] !== der.length - 2) return null;
  const r = derInt(der, 2);
  const s = r && derInt(der, r.next);
  if (!r || !s || s.next !== der.length) return null;
  const raw = new Uint8Array(64);
  raw.set(r.value, 0);
  raw.set(s.value, 32);
  return raw;
}

const equal = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

interface ClientData {
  type?: unknown;
  challenge?: unknown;
  origin?: unknown;
  crossOrigin?: unknown;
}

function readClientData(bytes: Uint8Array): ClientData | null {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function decodeAll(a: PasskeyAssertion): { auth: Uint8Array; client: Uint8Array; sig: Uint8Array } | null {
  try {
    return { auth: fromB64url(a.authenticatorData), client: fromB64url(a.clientDataJSON), sig: fromB64url(a.signature) };
  } catch {
    return null;
  }
}

async function signatureVerifies(publicKey: string, sig: Uint8Array, signed: Uint8Array): Promise<boolean> {
  const raw = derToRaw(sig);
  if (!raw) return false;
  try {
    const key = await crypto.subtle.importKey("spki", fromB64url(publicKey) as BufferSource, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    return await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, raw as BufferSource, signed as BufferSource);
  } catch {
    return false;
  }
}

// Whether the assertion is the pinned passkey's signature over this message, from an allowed origin, with the user
// present and verified. On success, the new sign counter for the host to keep.
export async function verifyPasskeyAssertion(assertion: PasskeyAssertion, pinned: PinnedPasskey, message: string, origins: readonly PasskeyOrigin[]): Promise<PasskeyResult> {
  const parts = decodeAll(assertion);
  if (!parts) return { ok: false, reason: "The passkey's answer isn't readable." };
  const client = readClientData(parts.client);
  if (!client || client.type !== "webauthn.get") return { ok: false, reason: "That isn't a passkey signature." };
  const allowed = origins.find((o) => o.origin === client.origin);
  if (!allowed || client.crossOrigin === true) return { ok: false, reason: "The passkey signed for another site." };
  if (client.challenge !== (await passkeyChallenge(message))) return { ok: false, reason: "The passkey signed a different approval." };
  if (parts.auth.length < 37 || !equal(parts.auth.subarray(0, 32), await sha256(allowed.rpId))) return { ok: false, reason: "The passkey belongs to another site." };
  const flags = parts.auth[32] as number;
  if (!(flags & FLAG_UP) || !(flags & FLAG_UV)) return { ok: false, reason: "The passkey didn't check it was you (Touch ID or a PIN)." };
  const counter = new DataView(parts.auth.buffer, parts.auth.byteOffset + 33, 4).getUint32(0);
  // A counter that doesn't move on means a cloned key or a replay; one that stays 0 is an authenticator without one.
  if ((counter !== 0 || pinned.counter !== 0) && counter <= pinned.counter) return { ok: false, reason: "The passkey's counter went backwards: it may have been copied." };
  const signed = new Uint8Array(parts.auth.length + 32);
  signed.set(parts.auth, 0);
  signed.set(await sha256(parts.client), parts.auth.length);
  if (!(await signatureVerifies(pinned.publicKey, parts.sig, signed))) return { ok: false, reason: "The passkey's signature doesn't check out." };
  return { ok: true, counter };
}
