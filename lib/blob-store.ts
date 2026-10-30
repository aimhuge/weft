// The content-addressed blob store for server-side cards: file paths in a ThreadItem (a pasted
// image, a tool screenshot, a ~/.weft/show page) are swapped for `blob:sha256:<hex>` refs and
// uploaded once to the weft-blobs bucket. The outbox (lib/cloud-sync.ts) calls rewriteItem on
// each row before it goes to Supabase; the receiver calls fetchBlob to materialise a ref back
// into a file under DATA_DIR/blob-cache/. Which paths may go up (home only, never the vault or
// a secret) is lib/blob-paths.ts.
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { SupabaseClient } from "@supabase/supabase-js";
import { rewritePageHtml } from "./blob-page-assets";
import { contentTypeFor, findMarkdownLocalPaths, resolveLocalPath, resolvePage } from "./blob-paths";
import {
  BLOB_BUCKET,
  BLOB_REF_PREFIX,
  isBlobRef,
  type BlobRef,
} from "./cloud-sync-types";
import { MEDIA_REF, extensionOf } from "./media";
import { DATA_DIR } from "./store";
import type { ThreadItem } from "./types";

// The path rules live in lib/blob-paths.ts; callers keep importing the check from here.
export { isLocalUploadPath } from "./blob-paths";

// The cache lives in DATA_DIR/blob-cache, but tests (and an alternate DATA_DIR) override it.
const DEFAULT_CACHE_DIR = path.join(DATA_DIR, "blob-cache");

// SHA-256 of a local file, streamed so a 2 GB screenshot doesn't pin itself in memory; null when
// the file isn't there (or isn't a regular file).
export async function sha256Of(localPath: string): Promise<string | null> {
  if (!fs.existsSync(localPath) || !fs.statSync(localPath).isFile()) return null;
  const hash = createHash("sha256");
  await pipeline(fs.createReadStream(localPath), hash);
  return hash.digest("hex");
}

function blobRefFor(sha: string): BlobRef {
  return `${BLOB_REF_PREFIX}${sha}`;
}

function objectPath(orgId: string, sha: string) {
  return `${orgId}/${sha}`;
}

function isAlreadyExists(err: { name?: string; statusCode?: string; message?: string } | null | undefined) {
  if (!err) return false;
  if (err.name === "StorageApiError" && (err.statusCode === "409" || err.statusCode === "400")) return true;
  const msg = (err.message ?? "").toLowerCase();
  return msg.includes("already exists") || msg.includes("duplicate");
}


export interface CreateBlobStoreOptions {
  client: SupabaseClient;
  dataDir?: string;
  cacheDir?: string;
  // A veto over every file that would go up, page assets included: a Weft Worker's narrower rule (lib/worker-blobs.ts).
  mayUpload?: (localPath: string) => boolean;
}

export interface BlobStoreBundle {
  refFor(localPath: string): Promise<BlobRef | null>;
  upload(localPath: string, orgId: string): Promise<BlobRef | null>;
  uploadPage(localPath: string, orgId: string): Promise<BlobRef | null>;
  rewriteItem(item: ThreadItem, orgId: string): Promise<ThreadItem>;
  fetchBlob(ref: BlobRef, orgId: string): Promise<string | null>;
}

function cacheDirFor(opts: CreateBlobStoreOptions) {
  if (opts.cacheDir) return opts.cacheDir;
  if (opts.dataDir) return path.join(opts.dataDir, "blob-cache");
  return DEFAULT_CACHE_DIR;
}

export function createBlobStore(opts: CreateBlobStoreOptions): BlobStoreBundle {
  const client = opts.client;
  const cacheDir = cacheDirFor(opts);
  const uploaded = new Set<string>();
  const allowed = opts.mayUpload ?? (() => true);
  const bucket = () => client.storage.from(BLOB_BUCKET);

  async function refFor(localPath: string): Promise<BlobRef | null> {
    const sha = await sha256Of(localPath);
    return sha ? blobRefFor(sha) : null;
  }

  // Puts bytes in the bucket under their sha, once: the sha is content-addressed, so a 409 (or a 400 with
  // "already exists") means the same bytes are there, which counts as success.
  async function uploadBytes(sha: string, body: Buffer, type: string, orgId: string): Promise<BlobRef> {
    const ref = blobRefFor(sha);
    if (uploaded.has(ref)) return ref;
    const { error } = await bucket().upload(objectPath(orgId, sha), body, { contentType: type, upsert: false });
    if (error && !isAlreadyExists(error)) throw error;
    uploaded.add(ref);
    return ref;
  }

  async function upload(localPath: string, orgId: string): Promise<BlobRef | null> {
    if (!allowed(localPath)) return null;
    const sha = await sha256Of(localPath);
    if (!sha) return null;
    if (uploaded.has(blobRefFor(sha))) return blobRefFor(sha);
    return uploadBytes(sha, fs.readFileSync(localPath), contentTypeFor(localPath), orgId);
  }

  // A page the pane showed: an HTML file goes up with each local image, stylesheet or video it names uploaded too
  // and swapped for its ref (lib/blob-page-assets.ts), so the copy in the bucket is a different blob from the file.
  // Any other file, or a page that names nothing local, goes up as it is.
  async function uploadPage(localPath: string, orgId: string, home = os.homedir()): Promise<BlobRef | null> {
    if (!allowed(localPath)) return null;
    if (!["html", "htm"].includes(extensionOf(localPath))) return upload(localPath, orgId);
    const html = fs.readFileSync(localPath, "utf8");
    const next = await rewritePageHtml(html, localPath, (asset) => upload(asset, orgId), home, allowed);
    if (next === null) return upload(localPath, orgId);
    const body = Buffer.from(next, "utf8");
    return uploadBytes(createHash("sha256").update(body).digest("hex"), body, contentTypeFor(localPath), orgId);
  }

  // A tool item's images array: each entry is rewritten to a blob ref (or left as-is).
  async function rewriteToolImages(images: string[], orgId: string, home: string): Promise<string[] | null> {
    let changed = false;
    const refs: string[] = [];
    for (const url of images) {
      const local = resolveLocalPath(url, home);
      if (local) {
        const ref = await upload(local, orgId);
        if (ref) {
          refs.push(ref);
          if (ref !== url) changed = true;
          continue;
        }
      }
      refs.push(url);
    }
    return changed ? refs : null;
  }

  // A page the pane showed (a user item's page, an open_url call's URL): a file:// URL or absolute
  // path under home becomes `<blob ref><#hash>`; http(s) and localhost stay as they are.
  async function rewritePage(page: string, orgId: string, home: string): Promise<string | null> {
    const found = resolvePage(page.trim(), home);
    const ref = found ? await uploadPage(found.local, orgId, home) : null;
    return ref && found ? `${ref}${found.hash}` : null;
  }

  // Rewrites a markdown body's local image targets, returning the new text (or null when
  // nothing changed). The replacement is exactly the input with each match's target swapped;
  // markdown text we can't resolve stays where it was.
  async function rewriteMarkdownText(text: string, orgId: string, home: string): Promise<string | null> {
    const locals = findMarkdownLocalPaths(text, home);
    if (!locals.some(Boolean)) return null;
    const refsByLocal: Array<BlobRef | null> = [];
    for (const local of locals) {
      if (!local) {
        refsByLocal.push(null);
        continue;
      }
      refsByLocal.push(await upload(local, orgId));
    }
    let i = 0;
    const next = text.replace(MEDIA_REF, (whole, alt: string) => {
      const ref = refsByLocal[i++];
      return ref ? `![${alt}](${ref})` : whole;
    });
    return next !== text ? next : null;
  }

  // A tool item's images, and for an open_url call (the pane's history) the page it opened, whose
  // summary is that URL.
  async function rewriteTool(item: Extract<ThreadItem, { kind: "tool" }>, orgId: string, home: string): Promise<ThreadItem> {
    const images = item.images?.length ? await rewriteToolImages(item.images, orgId, home) : null;
    const summary = item.name === "mcp__browser__open_url" ? await rewritePage(item.summary, orgId, home) : null;
    if (!images && !summary) return item;
    return { ...item, ...(images ? { images } : {}), ...(summary ? { summary } : {}) };
  }

  async function rewriteItem(item: ThreadItem, orgId: string): Promise<ThreadItem> {
    const home = os.homedir();

    if (item.kind === "tool") return rewriteTool(item, orgId, home);

    if (item.kind === "user" || item.kind === "assistant") {
      const page = item.kind === "user" && item.page ? await rewritePage(item.page, orgId, home) : null;
      const text = item.text ? await rewriteMarkdownText(item.text, orgId, home) : null;
      if (!page && !text) return item;
      return { ...item, ...(page ? { page } : {}), ...(text ? { text } : {}) };
    }

    return item;
  }

  async function fetchBlob(ref: BlobRef, orgId: string): Promise<string | null> {
    if (!isBlobRef(ref)) return null;
    const sha = ref.slice(BLOB_REF_PREFIX.length);
    fs.mkdirSync(cacheDir, { recursive: true });
    const file = path.join(cacheDir, sha);
    if (fs.existsSync(file) && fs.statSync(file).isFile()) return file;
    const { data, error } = await bucket().download(objectPath(orgId, sha));
    if (error) return null;
    // The storage client returns a Blob; write it to the cache file. A non-Blob falls back to
    // the ArrayBuffer path.
    const bytes = data instanceof Blob ? Buffer.from(await data.arrayBuffer()) : Buffer.from(new Uint8Array(data).buffer);
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, bytes);
    fs.renameSync(temp, file);
    return file;
  }

  return { refFor, upload, uploadPage: (localPath, orgId) => uploadPage(localPath, orgId), rewriteItem, fetchBlob };
}
