// Sealed blobs on the weft.zip board (docs/architecture/mobile-security.md, "Sealed blobs"): a paired browser opens
// them itself, since only it holds the workspace key. Pictures and thumbs: each signed URL is fetched, and a sealed one
// is swapped for an object URL of its opened bytes. Pages: the page route hands a sealed page over as it is stored
// (`?sealed=1`), this opens it, opens each `blob:sha256:` asset it names the same way into a data: URL, and the pane
// frames the result through srcdoc under the same sandbox the route sends. A browser with no key never comes here: the
// route draws a sealed page's 🔒 stand-in, and a sealed picture draws broken, as a sealed row draws 🔒.
import { openBlob } from "./blob-seal";
import { BLOB_REF_PREFIX } from "./cloud-sync-types";
import type { Sodium } from "./sodium";
import { isSealedBytes, type SyncKeyring } from "./sync-seal";

export interface BlobOpenDeps {
  s: Sodium;
  ring: SyncKeyring;
  fetchImpl?: typeof fetch;
  toUrl?: (blob: Blob) => string;
}

interface Fetched {
  bytes: Uint8Array;
  type: string;
}

async function fetched(url: string, fetchImpl: typeof fetch): Promise<Fetched | null> {
  try {
    const res = await fetchImpl(url);
    if (!res.ok) return null;
    return { bytes: new Uint8Array(await res.arrayBuffer()), type: res.headers.get("content-type") ?? "" };
  } catch {
    return null;
  }
}

const shaOf = (ref: string) => ref.slice(BLOB_REF_PREFIX.length);
const asBlob = (bytes: Uint8Array, type: string) => new Blob([bytes as Uint8Array<ArrayBuffer>], { type });

// The map with each sealed blob's URL swapped for an object URL of its opened bytes. A plain one keeps its signed URL,
// and so does one that can't be fetched (no CORS, gone) or opened (no key for its version).
export async function openSealedUrls(urls: Record<string, string>, orgId: string, deps: BlobOpenDeps): Promise<Record<string, string>> {
  const { fetchImpl = fetch, toUrl = (b: Blob) => URL.createObjectURL(b) } = deps;
  const out = { ...urls };
  await Promise.all(
    Object.entries(urls).map(async ([ref, url]) => {
      if (!ref.startsWith(BLOB_REF_PREFIX) || url.startsWith("blob:http")) return;
      const got = await fetched(url, fetchImpl);
      if (!got || !isSealedBytes(got.bytes)) return;
      const opened = await openBlob(deps.s, got.bytes, deps.ring, orgId, shaOf(ref));
      if (opened) out[ref] = toUrl(asBlob(opened.bytes, got.type));
    }),
  );
  return out;
}

// What the pane shows for a sealed page: its HTML for srcdoc, a URL for any other file, or locked when it won't open.
export type SealedPage = { kind: "html"; html: string } | { kind: "file"; url: string } | { kind: "locked" };

const ASSET_RE = /blob:sha256:([0-9a-f]{64})/g;
const pageUrl = (orgId: string, sha: string) => `/api/web-board/${orgId}/page/${sha}?sealed=1`;

export function looksLikeHtml(bytes: Uint8Array): boolean {
  const head = new TextDecoder().decode(bytes.subarray(0, 512)).replace(/^﻿/, "").trimStart().toLowerCase();
  return head.startsWith("<!doctype html") || head.startsWith("<html");
}

function dataUrl(bytes: Uint8Array, type: string): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${type || "application/octet-stream"};base64,${btoa(bin)}`;
}

// One asset a sealed page names, opened (a plain one as it is) into a data: URL; null when it can't be had.
async function assetUrl(orgId: string, sha: string, deps: BlobOpenDeps, fetchImpl: typeof fetch): Promise<string | null> {
  const got = await fetched(pageUrl(orgId, sha), fetchImpl);
  if (!got) return null;
  const opened = await openBlob(deps.s, got.bytes, deps.ring, orgId, sha);
  return opened ? dataUrl(opened.bytes, got.type.replace(/;.*$/, "")) : null;
}

// The page `sha` for the pane, opened; null when it isn't sealed (the pane frames the route as before) or can't be read.
export async function openSealedPage(orgId: string, sha: string, deps: BlobOpenDeps): Promise<SealedPage | null> {
  const { fetchImpl = fetch, toUrl = (b: Blob) => URL.createObjectURL(b) } = deps;
  const got = await fetched(pageUrl(orgId, sha), fetchImpl);
  if (!got || !isSealedBytes(got.bytes)) return null;
  const opened = await openBlob(deps.s, got.bytes, deps.ring, orgId, sha);
  if (!opened) return { kind: "locked" };
  if (!looksLikeHtml(opened.bytes)) return { kind: "file", url: toUrl(asBlob(opened.bytes, got.type)) };
  const html = new TextDecoder().decode(opened.bytes);
  const shas = [...new Set([...html.matchAll(ASSET_RE)].map((m) => m[1] as string))];
  const urls = new Map(await Promise.all(shas.map(async (a) => [a, await assetUrl(orgId, a, deps, fetchImpl)] as const)));
  return { kind: "html", html: html.replace(ASSET_RE, (whole, a: string) => urls.get(a) ?? whole) };
}
