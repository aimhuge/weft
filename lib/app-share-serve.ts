// Serving a shared mini app's page and its folder files (docs/architecture/mini-app-hosting.md), for the routes
// app/api/a/[id]/page, page/[sha], f/[...path] and v/[ver]/[...path]. Each request is capped (lib/app-page-limit.ts),
// gated (lib/app-share-access.ts), checked against what the row names now, then streamed from weft-blobs with the
// sandbox headers (lib/share-page-serve.ts) and, for HTML, the bridge script (lib/app-bridge-inject.ts).
//
// Caching: a versioned URL (the sha or the files map's version in the path, lib/app-share-frame.ts) of a public
// link is cacheable. Vercel's CDN keeps it for APP_CDN_SECONDS and the browser for a year: the URL names one
// version, so it can never go stale, only stop being linked. The CDN key is the whole URL with its host, and the
// only per-request thing in the body is the bridge's parent origin, which is that same host, so a cached page
// can't carry one origin's bridge to another. Private, email and password links, and the unversioned URLs, stay
// private to the browser and the gate runs on every request. A link switched from public to private stops
// being linked at once (the viewer page runs the gate) and its cached copies end within APP_CDN_SECONDS.
import "server-only";
import { injectBridgeScript, parentOriginFromRequest } from "./app-bridge-inject";
import { appShareAccess } from "./app-share-access";
import { folderVersion } from "./app-share-frame";
import { NO_STORE, rateLimited } from "./app-share-reply";
import { appBlobSha, type CloudAppShareRow } from "./app-share-types";
import { pageLimitVerdict } from "./app-page-limit";
import { serveBlobFile, serveBlobPage } from "./share-page-serve";
import { serviceClient } from "./web-session";

// How long Vercel's CDN keeps a public link's page or file: the most a saved URL keeps answering after the link
// is made private. An hour costs one function call per file per CDN region per hour, however big the crowd.
export const APP_CDN_SECONDS = 3600;

const PRIVATE_CACHE = "private, max-age=300";

// A sha256 in hex: the one shape a blob's storage name may have.
const SHA_RE = /^[0-9a-f]{64}$/;

export function appCacheHeaders(mode: string, versioned: boolean): Record<string, string> {
  if (versioned && mode === "public") {
    return { "Cache-Control": "public, max-age=31536000, immutable", "Vercel-CDN-Cache-Control": `max-age=${APP_CDN_SECONDS}` };
  }
  return { "Cache-Control": PRIVATE_CACHE };
}

const notFound = () => new Response("Not found", { status: 404, headers: NO_STORE });
const changed = () => new Response("This app has changed. Reload the page to see the latest.", { status: 404, headers: NO_STORE });

// The cap, then the gate. Answers the share, or the reply that ends the request.
async function admit(req: Request, id: string): Promise<CloudAppShareRow | Response> {
  const limit = pageLimitVerdict(id, req.headers);
  if (!limit.ok) return rateLimited(limit.retryAfter, "too many requests for this app");
  const access = await appShareAccess(id);
  if (access.kind === "missing") return notFound();
  if (access.kind !== "ok") return new Response("Forbidden", { status: 403, headers: NO_STORE });
  return access.share;
}

// A folder share names its entry file in `page` and maps each path to its blob in `files`.
export function folderEntrySha(row: Pick<CloudAppShareRow, "kind" | "page" | "files">): string | null {
  if (row.kind !== "folder" || !row.files || typeof row.files !== "object") return null;
  const sha = (row.files as Record<string, unknown>)[row.page];
  return typeof sha === "string" && SHA_RE.test(sha) ? sha : null;
}

// Splice the bridge into an HTML response and set the cache headers. The injector fails closed (the HTML
// unchanged) when the request has no real origin.
async function withBridge(req: Request, served: Response, cache: Record<string, string>): Promise<Response> {
  const body = injectBridgeScript(await served.text(), parentOriginFromRequest(req));
  const headers = new Headers(served.headers);
  for (const [k, v] of Object.entries(cache)) headers.set(k, v);
  headers.set("Content-Length", String(new TextEncoder().encode(body).byteLength));
  return new Response(body, { status: served.status, headers });
}

function withCache(served: Response, cache: Record<string, string>): Response {
  const headers = new Headers(served.headers);
  for (const [k, v] of Object.entries(cache)) headers.set(k, v);
  return new Response(served.body, { status: served.status, headers });
}

// The share's one page. wantSha is the sha in a versioned URL; undefined for the old /page URL.
export async function serveAppPage(req: Request, id: string, wantSha?: string): Promise<Response> {
  if (wantSha !== undefined && !SHA_RE.test(wantSha)) return notFound();
  const share = await admit(req, id);
  if (share instanceof Response) return share;
  const sha = appBlobSha(share) ?? folderEntrySha(share);
  if (!sha) return notFound();
  if (wantSha !== undefined && wantSha !== sha) return changed();
  const service = serviceClient();
  if (!service) return new Response("Sharing isn't set up on this server.", { status: 503, headers: NO_STORE });
  const served = await serveBlobPage(service, share.org_id, sha);
  if (!served.ok) return served;
  return withBridge(req, served, appCacheHeaders(share.mode, wantSha !== undefined));
}

// One allowed character class for a path segment: letters, digits, dot, dash, underscore. This rejects slashes,
// backslashes, percent-encoding and NULs by construction.
const SEGMENT_RE = /^[A-Za-z0-9._-]+$/;

// Next.js already decodes the catch-all param; decode again and check each segment so an encoded `/` or `..`
// can't slip through, and refuse a whole "." or ".." segment so the files map can't be probed for what it lacks.
export function safeParts(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: string[] = [];
  for (const part of raw) {
    if (typeof part !== "string" || part.length === 0) return null;
    let decoded: string;
    try {
      decoded = decodeURIComponent(part);
    } catch {
      return null;
    }
    if (!SEGMENT_RE.test(decoded) || decoded === "." || decoded === "..") return null;
    out.push(decoded);
  }
  return out;
}

// Files the bridge goes into. Anything else (JS, CSS, images, fonts) is served byte-identical.
const HTML_EXTENSIONS = new Set(["html", "htm"]);

// One file of a folder share, by its path in the row's files map. wantVersion is the files map's version in a
// versioned URL; undefined for the old /f/ URL.
export async function serveAppFile(req: Request, id: string, rawPath: unknown, wantVersion?: string): Promise<Response> {
  const parts = safeParts(rawPath);
  if (!parts) return notFound();
  const relative = parts.join("/");
  const share = await admit(req, id);
  if (share instanceof Response) return share;
  if (share.kind !== "folder" || !share.files) return notFound();
  if (wantVersion !== undefined && folderVersion(share.files) !== wantVersion) return changed();
  const sha = share.files[relative];
  // The storage path is `${orgId}/${sha}`: a sha that isn't one 64-hex segment never reaches the bucket.
  if (!sha || !SHA_RE.test(sha)) return notFound();
  const service = serviceClient();
  if (!service) return new Response("Sharing isn't set up on this server.", { status: 503, headers: NO_STORE });
  const dot = relative.lastIndexOf(".");
  const ext = dot >= 0 ? relative.slice(dot + 1) : "";
  const served = await serveBlobFile(service, share.org_id, sha, ext);
  if (!served.ok) return served;
  const cache = appCacheHeaders(share.mode, wantVersion !== undefined);
  return HTML_EXTENSIONS.has(ext.toLowerCase()) ? withBridge(req, served, cache) : withCache(served, cache);
}
