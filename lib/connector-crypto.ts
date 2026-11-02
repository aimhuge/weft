// Tokens at rest on weft.zip's Supabase for the connector minter (docs/architecture/connectors.md#connectors-on-a-worker-github-p1-as-built):
// your GitHub refresh token, the current user access token and any narrowed tokens, each sealed with AES-256-GCM under
// WEFT_CONNECTOR_TOKEN_KEY (64 hex chars, set on the Vercel deployment's Production environment only). The tables
// holding them are read only by the service role, and the seal is bound to its row (the user and the field), so a
// sealed value copied into another row doesn't open. A missing key, a key id the deployment doesn't know, or bytes
// that don't authenticate open nothing. A Preview or Development deployment has no key, so it answers 503.
//
// Rotating the key: set the new one with a new WEFT_CONNECTOR_TOKEN_KEY_ID, and the old ones in
// WEFT_CONNECTOR_TOKEN_KEYS_OLD ("<id>:<64 hex>,…"). Old seals still open; every refresh seals with the new key, so
// once every user's chain has refreshed (or disconnected) nothing needs the old ones.
import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface ConnectorKey {
  id: string;
  key: Buffer;
  // Retired keys by id, for opening what they sealed; never used to seal.
  old?: Record<string, Buffer>;
}

const HEX_KEY = /^[0-9a-f]{64}$/i;

function oldKeys(list: string | undefined, current: string): Record<string, Buffer> | undefined {
  const out: Record<string, Buffer> = {};
  for (const part of (list ?? "").split(",")) {
    const [id = "", hex = ""] = part.trim().split(":");
    if (id && id !== current && HEX_KEY.test(hex)) out[id] = Buffer.from(hex, "hex");
  }
  return Object.keys(out).length ? out : undefined;
}

export function connectorKey(env: Record<string, string | undefined> = process.env): ConnectorKey | null {
  const hex = env.WEFT_CONNECTOR_TOKEN_KEY?.trim() ?? "";
  if (!HEX_KEY.test(hex)) return null;
  const id = env.WEFT_CONNECTOR_TOKEN_KEY_ID?.trim() || "v1";
  const old = oldKeys(env.WEFT_CONNECTOR_TOKEN_KEYS_OLD, id);
  return { id, key: Buffer.from(hex, "hex"), ...(old ? { old } : {}) };
}

// "<key id>.<nonce b64>.<ciphertext+tag b64>", bound to `bound` (say "refresh:<user id>").
export function sealToken(plain: string, bound: string, k: ConnectorKey): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k.key, nonce);
  cipher.setAAD(Buffer.from(bound));
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return `${k.id}.${nonce.toString("base64")}.${body.toString("base64")}`;
}

export function openToken(sealed: string | null | undefined, bound: string, k: ConnectorKey | null): string | null {
  const [id = "", nonce, body] = (sealed ?? "").split(".");
  const key = id === k?.id ? k.key : k?.old?.[id];
  if (!key || !nonce || !body) return null;
  try {
    const data = Buffer.from(body, "base64");
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(nonce, "base64"), { authTagLength: 16 });
    decipher.setAAD(Buffer.from(bound));
    decipher.setAuthTag(data.subarray(data.length - 16));
    return Buffer.concat([decipher.update(data.subarray(0, data.length - 16)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
