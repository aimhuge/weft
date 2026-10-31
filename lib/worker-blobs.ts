// How a Weft Worker's pages reach weft-blobs. Two halves: what may go up at all (workerMayUpload), and a stand-in for
// the Supabase client the blob store takes (workerBlobClient), which uploads through the key-checked route
// app/api/worker-blob instead of as a member, so lib/blob-store.ts runs on a worker unchanged.
//
// A Mac uploads anything under home that isn't a known secret. A worker can't use that rule: ~/.weft-worker/worker.json
// holds its key, worker.env its Claude token and github-credentials its GitHub token, and none of those names looks
// like a secret, while a page a card wrote can name any path. So a worker goes the other way: only web files, only
// inside its show folder or its checkouts, never in a dot folder (.git, .ssh), with symlinks followed first.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hasWebType, isLocalUploadPath } from "./blob-paths";
import { BLOB_BUCKET } from "./cloud-sync-types";
import { SITE } from "./site";

const real = (file: string) => {
  try {
    return fs.realpathSync(file);
  } catch {
    return null;
  }
};

// Inside `root` by a path that has no dot folder or dot file on the way.
function underRoot(file: string, root: string) {
  const rel = path.relative(root, file);
  return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel) && !rel.split(path.sep).some((part) => part.startsWith("."));
}

export function workerMayUpload(file: string, roots: string[], home = os.homedir()): boolean {
  const place = real(file);
  const realHome = real(home);
  if (!place || !realHome || !hasWebType(place) || !isLocalUploadPath(place, realHome)) return false;
  return roots.some((root) => {
    const realRoot = real(root);
    return !!realRoot && underRoot(place, realRoot);
  });
}

// supabase-js's storage, as far as a signed upload needs it.
export interface SignedStorage {
  from(bucket: string): { uploadToSignedUrl(path: string, token: string, body: Buffer, opts: { contentType?: string }): PromiseLike<{ error: { message: string } | null }> };
}

interface Options {
  contentType?: string;
}

// The bucket calls the blob store makes, over the route. The storage error comes back as it is, so the store's own
// "already exists counts as uploaded" holds.
export function workerBlobClient(key: string, storage: SignedStorage, site = SITE, fetcher: typeof fetch = fetch): SupabaseClient {
  const upload = async (objectPath: string, body: Buffer, opts: Options = {}) => {
    const sha = objectPath.split("/").pop();
    const res = await fetcher(`${site}/api/worker-blob`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ sha }),
    });
    const got = (await res.json().catch(() => ({}))) as { path?: string; token?: string; exists?: boolean; error?: string };
    if (got.exists) return { error: null };
    if (!res.ok || !got.path || !got.token) return { error: { message: got.error || `worker-blob: HTTP ${res.status}` } };
    return storage.from(BLOB_BUCKET).uploadToSignedUrl(got.path, got.token, body, { contentType: opts.contentType });
  };
  // A worker never reads blobs back, so download stays out.
  const bucket = { upload, download: () => Promise.resolve({ data: null, error: { message: "A worker doesn't read blobs." } }) };
  return { storage: { from: () => bucket } } as unknown as SupabaseClient;
}
