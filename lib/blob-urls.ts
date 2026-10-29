// Blob refs → URLs a browser can load, for every reader of weft-blobs (the web board, its server render, share
// pages). A blob already copied to Cloudflare R2 (a row in blob_mirror) gets a presigned R2 URL, which costs no
// egress; the rest get a Supabase signed URL as before, and are queued for copying (lib/r2-mirror.ts) when the
// caller passes `onUnmirrored`. docs/architecture/r2.md.
//
// `client` decides who is asking. A visitor's own session reads blob_mirror and signs Supabase URLs through RLS,
// so a non-member gets neither an R2 URL nor a signed one; the service client (a share page, after its own
// access check) reads everything.
import type { SupabaseClient } from "@supabase/supabase-js";
import { BLOB_BUCKET, BLOB_REF_PREFIX } from "./cloud-sync-types";
import { presignGet, r2Config, r2Key, type R2Config } from "./r2";
import { batchBlobRefs, blobPath, buildBlobUrlMap } from "./web-board";

export interface BlobUrlOptions {
  /** R2's settings; read from the environment when left out, and null turns R2 off. */
  r2?: R2Config | null;
  /** Called with the shas that got a Supabase URL because they aren't in R2 yet. */
  onUnmirrored?: (shas: string[]) => void;
  now?: number;
}

const shaOf = (ref: string) => ref.slice(BLOB_REF_PREFIX.length);

/** The shas among `shas` that blob_mirror says are in R2, as `client` may see them. Empty on any error. */
export async function mirroredShas(client: SupabaseClient, orgId: string, shas: readonly string[]): Promise<Set<string>> {
  const found = new Set<string>();
  if (!shas.length) return found;
  try {
    const { data, error } = await client.from("blob_mirror").select("sha").eq("org_id", orgId).in("sha", [...shas]);
    if (error || !Array.isArray(data)) return found;
    for (const row of data as { sha: string }[]) found.add(row.sha);
  } catch {
    // No table yet, or no network: everything stays on Supabase.
  }
  return found;
}

async function supabaseUrls(client: SupabaseClient, orgId: string, refs: readonly string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const batch of batchBlobRefs(refs)) {
    try {
      const { data, error } = await client.storage.from(BLOB_BUCKET).createSignedUrls(batch.map((r) => blobPath(orgId, r)), 3600);
      if (error) continue;
      Object.assign(out, buildBlobUrlMap(data.map((d: { path: string | null; signedUrl: string | null }) => ({ path: d.path ?? "", signedUrl: d.signedUrl })), batch));
    } catch {
      // Skip the batch; the renderer leaves the ref visible and can ask again.
    }
  }
  return out;
}

/** A ref→URL table for `refs`, R2 first. Refs nobody can sign are left out, so the renderer shows them raw. */
export async function resolveBlobUrls(client: SupabaseClient, orgId: string, refs: readonly string[], opts: BlobUrlOptions = {}): Promise<Record<string, string>> {
  if (!refs.length) return {};
  const r2 = opts.r2 === undefined ? r2Config() : opts.r2;
  const out: Record<string, string> = {};
  let rest: readonly string[] = refs;
  if (r2) {
    const mirrored = await mirroredShas(client, orgId, refs.map(shaOf));
    for (const ref of refs) if (mirrored.has(shaOf(ref))) out[ref] = presignGet(r2, r2Key(orgId, shaOf(ref)), opts.now);
    rest = refs.filter((ref) => !out[ref]);
  }
  if (!rest.length) return out;
  const fromSupabase = await supabaseUrls(client, orgId, rest);
  Object.assign(out, fromSupabase);
  const signed = Object.keys(fromSupabase);
  if (r2 && signed.length) opts.onUnmirrored?.(signed.map(shaOf));
  return out;
}
