// A Weft Worker's sealed rows and files, opened on this Mac's own server for the desktop board
// (docs/architecture/mobile-security.md#step-b-the-worker-seals-and-opens). A worker that holds a grant seals what it
// publishes with the workspace key (lib/worker-sealing.ts); this Mac's main holds every version it made or was granted
// (electron/sync-keys.cjs), and hands them to its server over the control server (POST /sync/keyring), asked for once a
// minute and only while something sealed comes by. Rows open with lib/sync-seal.ts, files with lib/blob-seal.ts openBlob
// (which also checks the bytes hash to their ref). What won't open draws its 🔒 stand-in, as on weft.zip.
import type { SupabaseClient } from "@supabase/supabase-js";
import { blobSealer, openBlob } from "./blob-seal";
import { pageBlobRefs, signPageRefs } from "./blob-page-sign";
import { readBlob, restoreHtmlType } from "./blob-read";
import { resolveBlobUrls } from "./blob-urls";
import { shell } from "./browser-shell";
import { BLOB_REF_PREFIX, type BlobSeal } from "./cloud-sync-types";
import { globalSingleton } from "./global-singleton";
import { sodium, type Sodium } from "./sodium";
import { isSealed, isSealedBytes, openCard, openItem, openToolResult, type SyncKeyring } from "./sync-seal";
import type { Card } from "./types";

const RING_TTL_MS = 60_000;
// A picture bigger than this stays a signed URL (and draws broken when sealed) rather than a data: URL in a JSON answer.
export const MAX_INLINE_BYTES = 8 * 1024 * 1024;

export interface Opener {
  s: Sodium;
  ring: SyncKeyring;
}

const cache = () => globalSingleton("__weftWorkerBoardRing", () => new Map<string, { ring: SyncKeyring; at: number }>());

// Every version main holds for the workspace; empty with no desktop shell, signed out, or no key yet.
export async function macRing(orgId: string, now = Date.now()): Promise<SyncKeyring> {
  const hit = cache().get(orgId);
  if (hit && now - hit.at < RING_TTL_MS) return hit.ring;
  let ring: SyncKeyring = new Map();
  try {
    const r = (await shell("/sync/keyring", { orgId })) as { keys?: { version: unknown; key: unknown }[] };
    ring = new Map((r.keys ?? []).flatMap((k) => (typeof k.version === "number" && typeof k.key === "string" ? [[k.version, k.key] as const] : [])));
  } catch {
    // No desktop shell: sealed rows draw their stand-ins.
  }
  cache().set(orgId, { ring, at: now });
  return ring;
}

export function forgetMacRing() {
  cache().clear();
  pictures().clear();
}

async function opener(orgId: string): Promise<Opener> {
  return { s: await sodium(), ring: await macRing(orgId) };
}

const sealedCard = (card: Card) => isSealed((card as { sealed?: unknown }).sealed);

// Cards with their sealed fields back; rows with nothing sealed come back as they were, and main is never asked.
export async function openCardRows<R extends { card_id: string; card: Card }>(orgId: string, rows: R[]): Promise<R[]> {
  if (!rows.some((r) => sealedCard(r.card))) return rows;
  const { s, ring } = await opener(orgId);
  return rows.map((r) => (sealedCard(r.card) ? { ...r, card: openCard(s, { org_id: orgId, card_id: r.card_id, card: r.card }, ring) } : r));
}

// Thread rows with each sealed item opened, or its 🔒 stand-in.
export async function openItemRows<R extends { card_id: string; seq: number; item: unknown; at?: string }>(orgId: string, rows: R[]): Promise<R[]> {
  if (!rows.some((r) => isSealed(r.item))) return rows;
  const { s, ring } = await opener(orgId);
  return rows.map((r) => (isSealed(r.item) ? { ...r, item: openItem(s, { org_id: orgId, card_id: r.card_id, seq: r.seq, item: r.item as never, at: r.at ?? "" }, ring) } : r));
}

// A long tool result, opened (or its 🔒 stand-in); a plain one as it is.
export async function openOutput(orgId: string, cardId: string, toolId: string, result: string): Promise<string> {
  if (!result.startsWith('{"$sealed":1')) return result;
  const { s, ring } = await opener(orgId);
  return openToolResult(s, { org_id: orgId, card_id: cardId, tool_id: toolId, result }, ring);
}

// A blob's bytes and type, opened when sealed; null when it's sealed and won't open here.
export async function openedBlob(client: SupabaseClient, orgId: string, sha: string): Promise<{ bytes: Uint8Array; type: string; sealed: boolean } | null | undefined> {
  const got = await readBlob(client, orgId, sha, { r2: null });
  if (!got) return undefined;
  const bytes = new Uint8Array(got.bytes);
  if (!isSealedBytes(bytes)) return { bytes, type: got.type, sealed: false };
  const { s, ring } = await opener(orgId);
  const opened = await openBlob(s, bytes, ring, orgId, sha);
  if (!opened) return null;
  return { bytes: opened.bytes, type: restoreHtmlType(got.type, opened.bytes.slice().buffer), sealed: opened.sealed };
}

const dataUrl = (bytes: Uint8Array, type: string) => `data:${type.replace(/;.*$/, "") || "application/octet-stream"};base64,${Buffer.from(bytes).toString("base64")}`;

// A sealed page's assets: each sealed one opened into a data: URL (the page route's CSP allows data:), each plain one
// signed as before. An asset that won't open stays a ref and draws broken.
export async function openPageAssets(client: SupabaseClient, orgId: string, html: string): Promise<string> {
  const refs = pageBlobRefs(html);
  if (!refs.length) return html;
  const urls: Record<string, string> = {};
  const plain: string[] = [];
  await Promise.all(
    refs.map(async (ref) => {
      const got = await openedBlob(client, orgId, ref.slice(BLOB_REF_PREFIX.length));
      if (got?.sealed && got.bytes.length <= MAX_INLINE_BYTES) urls[ref] = dataUrl(got.bytes, got.type);
      else if (got && !got.sealed) plain.push(ref);
    }),
  );
  Object.assign(urls, plain.length ? await resolveBlobUrls(client, orgId, plain) : {});
  return signPageRefs(html, urls);
}

// The thread's picture refs, signed, with each sealed one swapped for a data: URL of its opened bytes. Only looked at
// when this Mac holds a key for the workspace; otherwise the signed URLs as they were.
// A blob never changes under its ref, so each picture is read once: its data: URL, or null for a plain one.
const pictures = () => globalSingleton("__weftWorkerBoardPictures", () => new Map<string, string | null>());
const PICTURES_KEPT = 200;

async function pictureUrl(client: SupabaseClient, orgId: string, ref: string): Promise<string | null> {
  const key = `${orgId}/${ref}`;
  const hit = pictures().get(key);
  if (hit !== undefined) return hit;
  const got = await openedBlob(client, orgId, ref.slice(BLOB_REF_PREFIX.length));
  // One that's missing or won't open (no key for it yet) is asked again next time.
  if (!got) return null;
  const url = got.sealed && got.bytes.length <= MAX_INLINE_BYTES ? dataUrl(got.bytes, got.type) : null;
  if (pictures().size >= PICTURES_KEPT) pictures().clear();
  pictures().set(key, url);
  return url;
}

export async function openPictureUrls(client: SupabaseClient, orgId: string, urls: Record<string, string>): Promise<Record<string, string>> {
  if (!(await macRing(orgId)).size) return urls;
  const out = { ...urls };
  await Promise.all(
    Object.keys(urls).map(async (ref) => {
      const url = await pictureUrl(client, orgId, ref);
      if (url) out[ref] = url;
    }),
  );
  return out;
}

// How a file this Mac pastes into a worker card goes up: sealed with the version that card's row came sealed with, when
// main holds it, since only a worker holding that version (a grant this Mac signed) can have sealed the row, so it opens
// the file too (lib/worker-sealing.ts openingReader); plain for a card that came plain (no grant, shared) or one it can't read.
export async function cardBlobSeal(client: SupabaseClient, orgId: string, cardId: string): Promise<BlobSeal | null> {
  const { data } = await client.from("cloud_cards").select("sealed:card->sealed->v").eq("org_id", orgId).eq("card_id", cardId).maybeSingle<{ sealed: unknown }>();
  const version = data?.sealed;
  if (typeof version !== "number") return null;
  const key = (await macRing(orgId)).get(version);
  return key ? blobSealer(await sodium(), { version, key }) : null;
}
