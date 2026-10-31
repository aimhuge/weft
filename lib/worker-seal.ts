// Sealing a secret to one Weft Worker (docs/architecture/weft-worker.md#signing-claude-in). The worker keeps an
// X25519 private key on its box and publishes the public half on its cloud_workers row. The desktop seals with a
// fresh ephemeral key: X25519 to a shared secret, HKDF-SHA256 to an AES-256-GCM key, bound to both public keys and
// to what the secret is for. Supabase carries only the sealed bytes, which only that worker can open.
import crypto from "node:crypto";

export interface Sealed {
  v: 1;
  epk: string;
  iv: string;
  ct: string;
  tag: string;
}

export interface SealKeys {
  publicKey: string;
  privateKey: string;
}

const b64 = (buf: Buffer) => buf.toString("base64");
const pub = (der: string) => crypto.createPublicKey({ key: Buffer.from(der, "base64"), format: "der", type: "spki" });
const priv = (der: string) => crypto.createPrivateKey({ key: Buffer.from(der, "base64"), format: "der", type: "pkcs8" });
const derOf = (key: crypto.KeyObject) => b64(key.export({ format: "der", type: "spki" }));

export function newSealKeys(): SealKeys {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("x25519");
  return { publicKey: derOf(publicKey), privateKey: b64(privateKey.export({ format: "der", type: "pkcs8" })) };
}

function aeadKey(shared: Buffer, epk: string, recipient: string, purpose: string): Buffer {
  return Buffer.from(crypto.hkdfSync("sha256", shared, Buffer.from(epk + recipient), Buffer.from(`weft-worker-seal:${purpose}`), 32));
}

export function seal(recipientPublicKey: string, plaintext: string, purpose: string): Sealed {
  const recipient = pub(recipientPublicKey);
  const eph = crypto.generateKeyPairSync("x25519");
  const epk = derOf(eph.publicKey);
  const key = aeadKey(crypto.diffieHellman({ privateKey: eph.privateKey, publicKey: recipient }), epk, recipientPublicKey, purpose);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { v: 1, epk, iv: b64(iv), ct: b64(ct), tag: b64(cipher.getAuthTag()) };
}

// Throws when the bytes weren't sealed to these keys for this purpose, or were changed on the way.
export function open(keys: SealKeys, sealed: Sealed, purpose: string): string {
  const key = aeadKey(crypto.diffieHellman({ privateKey: priv(keys.privateKey), publicKey: pub(sealed.epk) }), sealed.epk, keys.publicKey, purpose);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(sealed.iv, "base64"));
  decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(sealed.ct, "base64")), decipher.final()]).toString("utf8");
}

// A sealed value as it comes off the network, or null when it isn't one.
export function sealedOf(value: unknown): Sealed | null {
  if (!value || typeof value !== "object") return null;
  const s = value as Record<string, unknown>;
  const ok = s.v === 1 && ["epk", "iv", "ct", "tag"].every((k) => typeof s[k] === "string" && /^[A-Za-z0-9+/=]+$/.test(s[k]));
  return ok ? (s as unknown as Sealed) : null;
}

// What the login command's sealed token is for: a token sealed for anything else won't open as one.
export const LOGIN_PURPOSE = "claude-login";
export const CLAUDE_TOKEN = /^sk-ant-[\w-]{20,}$/;

// The same for the github_login command: a fine-grained token, or a classic or OAuth one.
export const GITHUB_PURPOSE = "github-login";
export const GITHUB_TOKEN = /^(github_pat_|gh[op]_)\w{20,}$/;
