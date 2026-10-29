// `pnpm r2:backfill`: copies every weft-blobs object that isn't in Cloudflare R2 yet (lib/r2-mirror.ts), the
// one-time move of the ~4,500 objects that were there before R2 (docs/architecture/r2.md). Safe to stop and run
// again: each copy is recorded in blob_mirror as it lands, and the next run starts from what's left.
//
// It needs SUPABASE_SECRET_KEY and the four R2_* values, so run it through the vault, never with keys in a shell:
// mcp__secrets__run("pnpm r2:backfill", [SUPABASE_SECRET_KEY, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET]).
import { createClient } from "@supabase/supabase-js";
import { r2Config } from "../lib/r2";
import { mirrorPending } from "../lib/r2-mirror";
import { SUPABASE_URL } from "../lib/supabase-project";

async function main() {
  const key = process.env.SUPABASE_SECRET_KEY;
  const r2 = r2Config();
  if (!key || !r2) {
    console.error("Needs SUPABASE_SECRET_KEY and R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY (R2_BUCKET defaults to weft-blobs).");
    process.exit(1);
  }
  const service = createClient(SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
  let copied = 0;
  let bytes = 0;
  for (;;) {
    const run = await mirrorPending(service, r2, { budgetMs: 60_000, concurrency: 12 });
    copied += run.copied;
    bytes += run.bytes;
    console.log(`copied ${copied} objects, ${(bytes / 1024 / 1024).toFixed(1)} MB${run.failed.length ? `, ${run.failed.length} failed: ${run.failed[0]}` : ""}`);
    if (!run.more || !run.copied) break;
  }
  const stats: { data: unknown } = await service.rpc("blob_mirror_stats");
  console.log(JSON.stringify(stats.data));
}

void main();
