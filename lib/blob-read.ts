// A blob's bytes for the server's own page routes (a share page's iframe, a mini app's files, the web board's
// pane, a share's preview image): from Cloudflare R2 when it's copied there, else from Supabase Storage, where
// every blob lives. The caller has already decided the reader may see it. docs/architecture/r2.md.
import type { SupabaseClient } from "@supabase/supabase-js";
import { BLOB_BUCKET } from "./cloud-sync-types";
import { r2Config, r2Get, r2Key, type R2Config } from "./r2";

export interface BlobBytes {
  bytes: ArrayBuffer;
  /** The stored content type, or "" when the store didn't say. */
  type: string;
  from: "r2" | "supabase";
}

export interface BlobReadOptions {
  r2?: R2Config | null;
  /** Called when the bytes came from Supabase with R2 on, so the caller can queue the copy. */
  onUnmirrored?: (sha: string) => void;
  fetchImpl?: typeof fetch;
}

// Supabase Storage serves HTML as text/plain whatever type it was uploaded with (so a page can't run on its own
// domain), and the R2 copy took that type from it. The page routes sandbox what they serve, so a blob whose bytes
// are a page goes back to being HTML: otherwise the web board and the phone show its source.
export function restoreHtmlType(type: string, bytes: ArrayBuffer): string {
  if (type && !type.startsWith("text/plain")) return type;
  const head = new TextDecoder().decode(bytes.slice(0, 512)).replace(/^\uFEFF/, "").trimStart().toLowerCase();
  return head.startsWith("<!doctype html") || head.startsWith("<html") ? "text/html; charset=utf-8" : type;
}

/** R2 first, Supabase on a miss; null when neither has it (or `client` may not read it). */
export async function readBlob(client: SupabaseClient, orgId: string, sha: string, opts: BlobReadOptions = {}): Promise<BlobBytes | null> {
  const r2 = opts.r2 === undefined ? r2Config() : opts.r2;
  if (r2) {
    const got = await r2Get(r2, r2Key(orgId, sha), opts.fetchImpl);
    if (got) return { ...got, type: restoreHtmlType(got.type, got.bytes), from: "r2" };
  }
  const { data, error } = await client.storage.from(BLOB_BUCKET).download(`${orgId}/${sha}`);
  if (error) return null;
  if (r2) opts.onUnmirrored?.(sha);
  const bytes = await data.arrayBuffer();
  return { bytes, type: restoreHtmlType(data.type, bytes), from: "supabase" };
}
