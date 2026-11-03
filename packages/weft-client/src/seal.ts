// Sealing to one Weft Worker's published key, byte for byte as the Mac's server seals (lib/worker-seal.ts), so a board
// with no server of its own (weft.zip, the phone) can seal a session line's offer itself
// (docs/architecture/weft-worker.md#signing-claude-in):
//
//   ephemeral X25519 key ─ X25519 with the worker's key ─ HKDF-SHA256(salt = epk + recipient, info = weft-worker-seal:<purpose>)
//   ─ AES-256-GCM, 12-byte iv ─ { v: 1, epk, iv, ct, tag }, keys as base64 SPKI DER, the form cloud_workers.public_key holds
//
// X25519 is libsodium's (crypto_scalarmult, what node's diffieHellman computes for x25519); HKDF and AES-GCM are Web
// Crypto's, since libsodium's WebAssembly build has no AES-GCM. Both come in from the caller: libsodium-wrappers and
// globalThis.crypto.subtle in a browser, react-native-libsodium and a subtle polyfill on the phone.
import type { Sealed } from "./sealed";
import type { Sodium } from "./sodium-like";

export type { Sealed };

export interface SealSodium extends Pick<Sodium, "base64_variants" | "to_base64" | "from_base64" | "from_string"> {
  to_string(input: Uint8Array): string;
  crypto_scalarmult(privateKey: Uint8Array, publicKey: Uint8Array): Uint8Array;
  crypto_scalarmult_base(privateKey: Uint8Array): Uint8Array;
  randombytes_buf(length: number): Uint8Array;
}

// The members of Web Crypto's SubtleCrypto the seal uses, so the DOM's own fits without the package reading lib.dom.
export interface SubtleLike {
  importKey(format: "raw", keyData: Uint8Array, algorithm: string, extractable: boolean, usages: ("deriveBits" | "encrypt" | "decrypt")[]): Promise<unknown>;
  deriveBits(algorithm: { name: "HKDF"; hash: string; salt: Uint8Array; info: Uint8Array }, key: never, length: number): Promise<ArrayBuffer>;
  encrypt(algorithm: { name: "AES-GCM"; iv: Uint8Array }, key: never, data: Uint8Array): Promise<ArrayBuffer>;
  decrypt(algorithm: { name: "AES-GCM"; iv: Uint8Array }, key: never, data: Uint8Array): Promise<ArrayBuffer>;
}

// What a session line's answer comes back as (lib/rtc-signal.ts sealAnswer): AES-256-GCM under the one-time key the
// sealed offer carried, the tag on the end of ct as Web Crypto writes it.
export interface SealedAnswer {
  iv: string;
  ct: string;
}

// The one-time key an answer comes back under, and how it opens. A forged or stale answer throws.
export interface AnswerKeys {
  newKey(): string;
  open(key: string, sealed: SealedAnswer): Promise<string>;
}

// Standard base64 with padding, as sodium-like.ts's b64 and unb64 write it, over the narrower SealSodium.
const b64 = (s: SealSodium, bytes: Uint8Array) => s.to_base64(bytes, s.base64_variants.ORIGINAL);
const unb64 = (s: SealSodium, text: string) => s.from_base64(text, s.base64_variants.ORIGINAL);

export interface SealCrypto {
  sodium: SealSodium;
  subtle: SubtleLike;
}

// An X25519 public key as SPKI DER: this fixed 12-byte header, then the 32 raw bytes.
const SPKI_X25519 = [0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x03, 0x21, 0x00];
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

// The raw key inside a base64 SPKI, or a throw when it isn't exactly an X25519 public key.
export function rawX25519(s: SealSodium, spki: string): Uint8Array {
  let der: Uint8Array;
  try {
    der = unb64(s, spki);
  } catch {
    throw new Error("That worker's key isn't an X25519 key.");
  }
  if (der.length !== SPKI_X25519.length + KEY_BYTES || SPKI_X25519.some((b, i) => der[i] !== b)) throw new Error("That worker's key isn't an X25519 key.");
  return der.slice(SPKI_X25519.length);
}

export function spkiX25519(s: SealSodium, raw: Uint8Array): string {
  const der = new Uint8Array(SPKI_X25519.length + KEY_BYTES);
  der.set(SPKI_X25519);
  der.set(raw, SPKI_X25519.length);
  return b64(s, der);
}

const allZero = (bytes: Uint8Array) => bytes.every((b) => b === 0);

// The AES key both ends derive, bound to both public keys (as their base64 text, as lib/worker-seal.ts binds them) and to
// what the secret is for.
async function aeadKey(c: SealCrypto, shared: Uint8Array, epk: string, recipient: string, purpose: string, use: "encrypt" | "decrypt") {
  const s = c.sodium;
  const ikm = await c.subtle.importKey("raw", shared, "HKDF", false, ["deriveBits"]);
  const bits = await c.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: s.from_string(epk + recipient), info: s.from_string(`weft-worker-seal:${purpose}`) }, ikm as never, 256);
  return c.subtle.importKey("raw", new Uint8Array(bits), "AES-GCM", false, [use]);
}

export async function sealTo(c: SealCrypto, recipientPublicKey: string, plaintext: string, purpose: string): Promise<Sealed> {
  const s = c.sodium;
  const recipient = rawX25519(s, recipientPublicKey);
  const ephemeral = s.randombytes_buf(KEY_BYTES);
  try {
    const epk = spkiX25519(s, s.crypto_scalarmult_base(ephemeral));
    // libsodium refuses a low-order key itself; this says so in our words, as node's diffieHellman would refuse.
    const shared = s.crypto_scalarmult(ephemeral, recipient);
    if (allZero(shared)) throw new Error("That worker's key isn't an X25519 key.");
    const key = await aeadKey(c, shared, epk, recipientPublicKey, purpose, "encrypt");
    shared.fill(0);
    const iv = s.randombytes_buf(IV_BYTES);
    const out = new Uint8Array(await c.subtle.encrypt({ name: "AES-GCM", iv }, key as never, s.from_string(plaintext)));
    return { v: 1, epk, iv: b64(s, iv), ct: b64(s, out.slice(0, out.length - TAG_BYTES)), tag: b64(s, out.slice(out.length - TAG_BYTES)) };
  } finally {
    ephemeral.fill(0);
  }
}

export function answerKeys(c: SealCrypto): AnswerKeys {
  const s = c.sodium;
  return {
    newKey: () => b64(s, s.randombytes_buf(KEY_BYTES)),
    async open(key, sealed) {
      const aes = await c.subtle.importKey("raw", unb64(s, key), "AES-GCM", false, ["decrypt"]);
      return s.to_string(new Uint8Array(await c.subtle.decrypt({ name: "AES-GCM", iv: unb64(s, sealed.iv) }, aes as never, unb64(s, sealed.ct))));
    },
  };
}

// A sealed value as it comes off the network, or null when it isn't one.
export function sealedOf(value: unknown): Sealed | null {
  if (!value || typeof value !== "object") return null;
  const s = value as Record<string, unknown>;
  const ok = s.v === 1 && ["epk", "iv", "ct", "tag"].every((k) => typeof s[k] === "string" && /^[A-Za-z0-9+/=]+$/.test(s[k]));
  return ok ? (s as unknown as Sealed) : null;
}
