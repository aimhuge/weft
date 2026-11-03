// Sealed blobs (docs/architecture/mobile-security.md, "Sealed blobs"): an attachment, a page or a pane capture goes up
// to weft-blobs as sync-seal's `sealBytes` with the workspace key, bound to its org and sha (`blobAad`), whenever the
// rows that name it go up sealed. The ref stays `blob:sha256:<hex of the plaintext>`, so content addressing, dedup and
// every ref-walker are unchanged; only the bytes in the bucket are ciphertext. Isomorphic: the Mac's server, the web
// board in the browser and a worker all seal and open through here.
//
// The format is versioned by its magic ("wsb1", lib/sync-seal.ts): bytes without it are a plain blob from before
// sealing, and pass through. A reader checks the opened bytes hash to the ref's sha, so a key holder can't swap content
// under a ref either; a plain file that happens to start with the magic still opens, by that same hash.
import type { BlobSeal, BlobStore } from "./cloud-sync-types";
import type { Sodium } from "./sodium";
import { blobAad, isSealedBytes, openBytes, SEALED_TEXT, sealBytes, type SyncKey, type SyncKeyring } from "./sync-seal";

export type { BlobSeal };

export function blobSealer(s: Sodium, key: SyncKey): BlobSeal {
  return (orgId, sha, bytes) => sealBytes(s, bytes, key, blobAad(orgId, sha));
}

const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return hex(await globalThis.crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>));
}

export type Opened = { bytes: Uint8Array; sealed: boolean } | null;

// The blob's plain bytes and whether they came sealed; null when they're sealed and don't open here (no key for their
// version, another org or sha, altered) or open to bytes that aren't the ref's.
export async function openBlob(s: Sodium, bytes: Uint8Array, ring: SyncKeyring, orgId: string, sha: string): Promise<Opened> {
  if (!isSealedBytes(bytes)) return { bytes, sealed: false };
  const plain = openBytes(s, bytes, ring, blobAad(orgId, sha));
  if (plain && (await sha256Hex(plain)) === sha) return { bytes: plain, sealed: true };
  // A plain file that merely starts with the magic is still its own sha.
  return (await sha256Hex(bytes)) === sha ? { bytes, sealed: false } : null;
}

// The version a sealed blob was sealed with, to say which key a reader is missing; null for a plain one.
export function sealedVersion(bytes: Uint8Array): number | null {
  return isSealedBytes(bytes) ? new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4) : null;
}

// What a server route serves in place of a sealed page it can't read (it holds no key): the 🔒 stand-in.
export const SEALED_PAGE_HTML = `<!doctype html><meta charset="utf-8"><p style="font:14px system-ui;color:#666;padding:2rem">${SEALED_TEXT}</p>`;

// A blob store whose uploads go up sealed with `seal`; the store itself when there's none (a shared card, sealing
// off, no key). Every method keeps its own shape, so a RowHost takes either.
export function withBlobSeal(blobs: BlobStore, seal: BlobSeal | null): BlobStore {
  if (!seal) return blobs;
  const page = blobs.uploadPage?.bind(blobs);
  return {
    refFor: (localPath) => blobs.refFor(localPath),
    upload: (localPath, orgId) => blobs.upload(localPath, orgId, seal),
    ...(page ? { uploadPage: (localPath: string, orgId: string) => page(localPath, orgId, seal) } : {}),
    rewriteItem: (item, orgId) => blobs.rewriteItem(item, orgId, seal),
  };
}
