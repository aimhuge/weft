// The frame URL a shared mini app's viewer hands its iframe (app/a/[id], the /@user and /<org> app pages), with
// the content's version in the path: /api/a/<id>/page/<sha> for a single page, /api/a/<id>/v/<ver>/<entry> for a
// folder, where <ver> is folderVersion of the row's files map and every sibling file resolves under the same
// /v/<ver>/ by relative URL. A public link's responses are cached by Vercel's CDN on that URL
// (lib/app-share-serve.ts), so a cache entry can only ever be the content the row named when it was made: an edit
// is a new URL, and the uncached path refuses a version the row no longer names.
//
// Server-only for node:crypto; lib/app-share-types.ts appFrameSrc stays the pure, unversioned shape.
import "server-only";
import { createHash } from "node:crypto";
import { appBlobSha, appFrameSrc, type CloudAppShareRow } from "./app-share-types";

// 32 hex characters (128 bits) of sha256 over the files map, keys sorted, so the same files always make the
// same version and any added, removed or changed file makes a new one.
export const VERSION_RE = /^[0-9a-f]{32}$/;

export function folderVersion(files: Record<string, string>): string {
  const sorted = Object.keys(files)
    .sort()
    .map((k) => [k, files[k]]);
  return createHash("sha256").update(JSON.stringify(sorted)).digest("hex").slice(0, 32);
}

export function versionedFrameSrc(id: string, row: Pick<CloudAppShareRow, "kind" | "page" | "files">): string {
  if (row.kind === "folder" && row.files && Object.keys(row.files).length) {
    return `/api/a/${id}/v/${folderVersion(row.files)}/${row.page || "index.html"}`;
  }
  const sha = row.kind === "blob" ? appBlobSha(row) : null;
  if (sha) {
    const at = row.page.indexOf("#");
    return `/api/a/${id}/page/${sha}${at < 0 ? "" : row.page.slice(at)}`;
  }
  return appFrameSrc(id, row);
}
