// Tokens at rest on weft.zip's Supabase for the connector minter (docs/architecture/connectors.md#connectors-on-a-worker-github-p1-as-built):
// your GitHub refresh token, the current user access token and any narrowed tokens, each sealed with AES-256-GCM under
// WEFT_CONNECTOR_TOKEN_KEY (64 hex chars, set on the Vercel deployment only). The tables holding them are read only
// by the service role, and the seal is bound to its row (the user and the field), so a sealed value copied into
// another row doesn't open. A missing key, a key id the deployment doesn't know, or bytes that don't authenticate
// open nothing.
import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface ConnectorKey {
  id: string;
  key: Buffer;
}

export function connectorKey(env: Record<string, string | undefined> = process.env): ConnectorKey | null {
  const hex = env.WEFT_CONNECTOR_TOKEN_KEY?.trim() ?? "";
  if (!/^[0-9a-f]{64}$/i.test(hex)) return null;
  return { id: env.WEFT_CONNECTOR_TOKEN_KEY_ID?.trim() || "v1", key: Buffer.from(hex, "hex") };
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
  const [id, nonce, body] = (sealed ?? "").split(".");
  if (!k || id !== k.id || !nonce || !body) return null;
  try {
    const data = Buffer.from(body, "base64");
    const decipher = createDecipheriv("aes-256-gcm", k.key, Buffer.from(nonce, "base64"));
    decipher.setAAD(Buffer.from(bound));
    decipher.setAuthTag(data.subarray(data.length - 16));
    return Buffer.concat([decipher.update(data.subarray(0, data.length - 16)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
