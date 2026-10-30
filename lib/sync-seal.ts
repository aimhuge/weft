// Sealing synced rows with the workspace key (docs/architecture/mobile-security.md, "Sealing"). Isomorphic: the Mac's
// uploader seals, the web board and the phone open. A sealed value is an envelope in place of the value; the
// associated data binds it to its org, card and slot, so a server that moves a ciphertext elsewhere gets one that
// won't open. Readers take both shapes: a plain value passes through, which is how sealing rolls out gradually.
import type { CloudCardRow, CloudThreadItemRow, CloudToolOutputRow } from "./cloud-sync-types";
import { b64, unb64, type Sodium } from "./sodium";
import type { Card, ThreadItem } from "./types";

export interface Sealed {
  $sealed: 1;
  // The workspace key version it was sealed with.
  v: number;
  n: string;
  c: string;
}

// One version of the workspace key, raw bytes as base64.
export interface SyncKey {
  version: number;
  key: string;
}

// The versions a reader holds, by version.
export type SyncKeyring = ReadonlyMap<number, string>;

export const SEALED_TEXT = "🔒 Sealed — pair this device to read it";
// What a sealed card's title reads in the row, so a feed or push that can't open it still draws something.
export const SEALED_TITLE = "🔒";

// The card fields a person typed or a thread wrote; the rest (ids, column, stage, tags, timestamps) stays plain.
export const SEALED_CARD_FIELDS = ["title", "prompt", "lastLine", "error", "suggestion", "remaining", "touchedFiles", "claims"] as const;
type SealedField = (typeof SEALED_CARD_FIELDS)[number];

export type Slot = `item:${number}` | "card" | `tool:${string}`;

export const aadFor = (orgId: string, cardId: string, slot: Slot) => `weft-sync-v1\n${orgId}\n${cardId}\n${slot}`;

export function isSealed(value: unknown): value is Sealed {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return v.$sealed === 1 && typeof v.v === "number" && typeof v.n === "string" && typeof v.c === "string";
}

export function sealJson(s: Sodium, value: unknown, key: SyncKey, aad: string): Sealed {
  const nonce = s.randombytes_buf(s.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const c = s.crypto_aead_xchacha20poly1305_ietf_encrypt(s.from_string(JSON.stringify(value)), s.from_string(aad), null, nonce, unb64(s, key.key));
  return { $sealed: 1, v: key.version, n: b64(s, nonce), c: b64(s, c) };
}

// The value, or undefined when the reader has no key for its version or it doesn't open (wrong key, moved, altered).
export function openJson(s: Sodium, sealed: Sealed, keys: SyncKeyring, aad: string): unknown {
  const key = keys.get(sealed.v);
  if (!key) return undefined;
  try {
    const plain = s.crypto_aead_xchacha20poly1305_ietf_decrypt(null, unb64(s, sealed.c), s.from_string(aad), unb64(s, sealed.n), unb64(s, key));
    return JSON.parse(s.to_string(plain)) as unknown;
  } catch {
    return undefined;
  }
}

// ── thread items ─────────────────────────────────────────────────────────────

export function sealItemRow(s: Sodium, row: CloudThreadItemRow, key: SyncKey): CloudThreadItemRow {
  if (isSealed(row.item)) return row;
  const item = sealJson(s, row.item, key, aadFor(row.org_id, row.card_id, `item:${row.seq}`)) as unknown as ThreadItem;
  return { ...row, item };
}

// What a reader shows for an item it can't open: an assistant line at the item's own time.
const standIn = (at: number): ThreadItem => ({ kind: "assistant", text: SEALED_TEXT, at });

export function openItem(s: Sodium, row: Pick<CloudThreadItemRow, "org_id" | "card_id" | "seq" | "item" | "at">, keys: SyncKeyring): ThreadItem {
  const raw: unknown = row.item;
  if (!isSealed(raw)) return row.item;
  return (openJson(s, raw, keys, aadFor(row.org_id, row.card_id, `item:${row.seq}`)) as ThreadItem | undefined) ?? standIn(Date.parse(row.at) || 0);
}

// ── cards ────────────────────────────────────────────────────────────────────

type SealedCard = Card & { sealed?: Sealed };

export function sealCardRow(s: Sodium, row: CloudCardRow, key: SyncKey): CloudCardRow {
  const card = row.card as SealedCard;
  if (card.sealed) return row;
  const secret: Partial<Record<SealedField, unknown>> = {};
  for (const field of SEALED_CARD_FIELDS) if (card[field] !== undefined) secret[field] = card[field];
  const rest = Object.fromEntries(Object.entries(card).filter(([k]) => !(SEALED_CARD_FIELDS as readonly string[]).includes(k)));
  const sealed = sealJson(s, secret, key, aadFor(row.org_id, row.card_id, "card"));
  return { ...row, card: { ...rest, title: SEALED_TITLE, prompt: "", sealed } as unknown as Card };
}

// The card with its sealed fields back, or its plain fields as they are. One that won't open keeps the 🔒 title.
export function openCard(s: Sodium, row: Pick<CloudCardRow, "org_id" | "card_id" | "card">, keys: SyncKeyring): Card {
  const card = row.card as SealedCard;
  if (!isSealed(card.sealed)) return card;
  const fields = openJson(s, card.sealed, keys, aadFor(row.org_id, row.card_id, "card")) as Partial<Card> | undefined;
  if (!fields) return card;
  const rest: SealedCard = { ...card };
  delete rest.sealed;
  return { ...rest, ...fields };
}

// ── long tool outputs ────────────────────────────────────────────────────────

export function sealToolRow(s: Sodium, row: CloudToolOutputRow, key: SyncKey): CloudToolOutputRow {
  const sealed = sealJson(s, row.result, key, aadFor(row.org_id, row.card_id, `tool:${row.tool_id}`));
  return { ...row, result: JSON.stringify(sealed) };
}

export function openToolResult(s: Sodium, row: Pick<CloudToolOutputRow, "org_id" | "card_id" | "tool_id" | "result">, keys: SyncKeyring): string {
  if (!row.result.startsWith('{"$sealed":1')) return row.result;
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.result);
  } catch {
    return row.result;
  }
  if (!isSealed(parsed)) return row.result;
  return (openJson(s, parsed, keys, aadFor(row.org_id, row.card_id, `tool:${row.tool_id}`)) as string | undefined) ?? SEALED_TEXT;
}

// ── page blobs (designed; the blob store wires it in a follow-up) ───────────

export const blobAad = (orgId: string, sha: string) => `weft-blob-v1\n${orgId}\n${sha}`;
const BLOB_MAGIC = [0x77, 0x73, 0x62, 0x31]; // "wsb1"

// The bytes as stored: "wsb1", the key version (4 bytes, big-endian), the nonce, the ciphertext.
export function sealBytes(s: Sodium, bytes: Uint8Array, key: SyncKey, aad: string): Uint8Array {
  const nonce = s.randombytes_buf(s.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const c = s.crypto_aead_xchacha20poly1305_ietf_encrypt(bytes, s.from_string(aad), null, nonce, unb64(s, key.key));
  const out = new Uint8Array(8 + nonce.length + c.length);
  out.set(BLOB_MAGIC, 0);
  new DataView(out.buffer).setUint32(4, key.version);
  out.set(nonce, 8);
  out.set(c, 8 + nonce.length);
  return out;
}

export const isSealedBytes = (bytes: Uint8Array) => bytes.length > 8 && BLOB_MAGIC.every((b, i) => bytes[i] === b);

// The plain bytes; the input unchanged when it isn't sealed; undefined when it's sealed and won't open here.
export function openBytes(s: Sodium, bytes: Uint8Array, keys: SyncKeyring, aad: string): Uint8Array | undefined {
  if (!isSealedBytes(bytes)) return bytes;
  const version = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4);
  const key = keys.get(version);
  if (!key) return undefined;
  const n = s.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES;
  try {
    return s.crypto_aead_xchacha20poly1305_ietf_decrypt(null, bytes.subarray(8 + n), s.from_string(aad), bytes.subarray(8, 8 + n), unb64(s, key));
  } catch {
    return undefined;
  }
}
