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

/** R2 first, Supabase on a miss; null when neither has it (or `client` may not read it). */
export async function readBlob(client: SupabaseClient, orgId: string, sha: string, opts: BlobReadOptions = {}): Promise<BlobBytes | null> {
  const r2 = opts.r2 === undefined ? r2Config() : opts.r2;
  if (r2) {
    const got = await r2Get(r2, r2Key(orgId, sha), opts.fetchImpl);
    if (got) return { ...got, from: "r2" };
  }
  const { data, error } = await client.storage.from(BLOB_BUCKET).download(`${orgId}/${sha}`);
  if (error) return null;
  if (r2) opts.onUnmirrored?.(sha);
  return { bytes: await data.arrayBuffer(), type: data.type, from: "supabase" };
}
