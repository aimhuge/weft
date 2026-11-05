// Copies weft-blobs objects from Supabase Storage to Cloudflare R2, once each, and records every copy in
// public.blob_mirror (supabase/migrations/20261029105650_blob_mirror.sql). Readers sign R2 URLs only for blobs
// with a row there (lib/blob-urls.ts), so a half-done copy is never read. docs/architecture/r2.md.
//
// Three callers: the daily cron (/api/cron/r2-mirror) and the backfill (`pnpm r2:backfill`) drain
// blob_mirror_pending(); a read that had to fall back to Supabase queues just that blob with `after()`, so new
// blobs move within a request or two instead of waiting for the cron. Each copy downloads the object from
// Supabase once (its one egress), PUTs it to R2, then inserts the row.
import type { SupabaseClient } from "@supabase/supabase-js";
import { BLOB_BUCKET } from "./cloud-sync-types";
import { r2Put, r2Key, type R2Config } from "./r2";

export interface PendingBlob {
  org_id: string;
  sha: string;
  bytes: number;
  content_type: string;
}

export interface MirrorResult {
  copied: number;
  bytes: number;
  failed: string[];
  /** True when the run stopped with work left (the time budget, or the batch was full). */
  more: boolean;
}

export interface MirrorOptions {
  /** Objects per pending read (default 100). */
  batch?: number;
  /** Copies in flight at once (default 8). */
  concurrency?: number;
  /** Stop starting new batches after this many ms (default 240 s, inside Vercel's 300 s). */
  budgetMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/** Copies one object and records it. Throws on a failed download, write or insert. */
export async function mirrorOne(service: SupabaseClient, r2: R2Config, blob: Pick<PendingBlob, "org_id" | "sha"> & { content_type?: string }, fetchImpl?: typeof fetch): Promise<number> {
  const { data, error } = await service.storage.from(BLOB_BUCKET).download(`${blob.org_id}/${blob.sha}`);
  if (error) throw new Error(`download ${blob.org_id}/${blob.sha}: ${error.message}`);
  const bytes = new Uint8Array(await data.arrayBuffer());
  await r2Put(r2, r2Key(blob.org_id, blob.sha), bytes, blob.content_type || data.type || "application/octet-stream", fetchImpl);
  const { error: insertError } = await service.from("blob_mirror").upsert({ org_id: blob.org_id, sha: blob.sha, bytes: bytes.byteLength }, { onConflict: "org_id,sha", ignoreDuplicates: true });
  if (insertError) throw new Error(`record ${blob.sha}: ${insertError.message}`);
  return bytes.byteLength;
}

async function pending(service: SupabaseClient, max: number): Promise<PendingBlob[]> {
  const result: { data: unknown; error: { message: string } | null } = await service.rpc("blob_mirror_pending", { max_rows: max });
  if (result.error) throw new Error(`blob_mirror_pending: ${result.error.message}`);
  return Array.isArray(result.data) ? (result.data as PendingBlob[]) : [];
}

// Runs `work` over `items`, `limit` at a time.
async function pool<T>(items: T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (let i = next++; i < items.length; i = next++) await work(items[i] as T);
  });
  await Promise.all(lanes);
}

/** Drains blob_mirror_pending() until it's empty, three batches in a row copy nothing, or the time budget runs out. */
export async function mirrorPending(service: SupabaseClient, r2: R2Config, opts: MirrorOptions = {}): Promise<MirrorResult> {
  const now = opts.now ?? Date.now;
  const batch = opts.batch ?? 100;
  const deadline = now() + (opts.budgetMs ?? 240_000);
  const result: MirrorResult = { copied: 0, bytes: 0, failed: [], more: false };
  const failedKeys = new Set<string>();
  // Three batches in a row with nothing copied means R2 or Supabase is down: stop and let the next run retry.
  let dryBatches = 0;
  while (now() < deadline && dryBatches < 3) {
    // Ask for the failures again plus a batch, so a few that keep failing can't stall the queue.
    const rows = (await pending(service, batch + failedKeys.size)).filter((r) => !failedKeys.has(`${r.org_id}/${r.sha}`));
    if (!rows.length) return result;
    const before = result.copied;
    await pool(rows, opts.concurrency ?? 8, async (row) => {
      try {
        // Await first: `result.bytes += await …` reads the total before the copy, and parallel lanes lose bytes.
        const bytes = await mirrorOne(service, r2, row, opts.fetchImpl);
        result.bytes += bytes;
        result.copied++;
      } catch (err) {
        failedKeys.add(`${row.org_id}/${row.sha}`);
        result.failed.push((err as Error).message);
      }
    });
    dryBatches = result.copied === before ? dryBatches + 1 : 0;
  }
  result.more = (await pending(service, failedKeys.size + 1)).some((r) => !failedKeys.has(`${r.org_id}/${r.sha}`));
  return result;
}

/** Copies the given shas of one org, quietly: the background half of a read that fell back to Supabase. */
export async function mirrorShas(service: SupabaseClient, r2: R2Config, orgId: string, shas: readonly string[], fetchImpl?: typeof fetch): Promise<void> {
  await pool([...new Set(shas)], 4, async (sha) => {
    try {
      await mirrorOne(service, r2, { org_id: orgId, sha }, fetchImpl);
    } catch {
      // The cron picks it up.
    }
  });
}
