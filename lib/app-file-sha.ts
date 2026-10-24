// A file's sha256, remembered by its path, size and mtime. lib/app-share-row.ts's currentPage hashes
// every file of a folder app to know what the share points at; the preview timer (lib/app-preview-refresh.ts)
// asks the same question every few minutes, so the answer is cached: a file whose size and mtime are
// unchanged has the same bytes, and doesn't need reading again.
//
// The cache lives on globalThis, so a dev-mode reload doesn't make a second one, and it's small: one
// entry per file, dropped when the file's mtime moves.
import fs from "node:fs";
import { sha256Of } from "./blob-store";
import { globalSingleton } from "./global-singleton";

interface Entry {
  size: number;
  mtimeMs: number;
  sha: string;
}

type Cache = Map<string, Entry>;

function cache(): Cache {
  return globalSingleton("__weftFileSha", () => new Map<string, Entry>());
}

// The sha of a file, from the cache when its size and mtime say it hasn't changed. null when the file
// is gone, as sha256Of says.
export async function sha256Cached(localPath: string): Promise<string | null> {
  const stat = fs.statSync(localPath, { throwIfNoEntry: false });
  if (!stat || !stat.isFile()) return null;
  const hit = cache().get(localPath);
  if (hit && hit.size === stat.size && hit.mtimeMs === stat.mtimeMs) return hit.sha;
  const sha = await sha256Of(localPath);
  if (sha) cache().set(localPath, { size: stat.size, mtimeMs: stat.mtimeMs, sha });
  return sha;
}

// The cache forgets a file (it was deleted, or its name is reused for something else).
export function forgetSha(localPath: string): void {
  cache().delete(localPath);
}
