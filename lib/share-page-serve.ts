// One uploaded page, served for a share link's frame: a card's pane (app/api/s/[id]/page/[sha]), a mini app
// (app/api/a/[id]/page), or any one file in a folder app (app/api/a/[id]/f/[...path]). The route decides the
// visitor may see this blob; this streams weft-blobs/<orgId>/<sha> with a strict CSP sandbox, so the page's
// scripts run in an opaque origin and can't read weft.zip's cookies.
import type { SupabaseClient } from "@supabase/supabase-js";
import { NO_STORE } from "./app-share-reply";
import { isTextType, pageContentType } from "./share-page";
import { redactPageText } from "./share-redact";

export const SHA_RE = /^[0-9a-f]{64}$/;

const HEADERS = {
  // `sandbox` (without `allow-same-origin`) gives the iframe an opaque origin: scripts run, but
  // they can't see weft.zip's cookies, localStorage, or the parent. `allow-popups` lets links in
  // the page open in a new tab; `allow-forms` lets the page's own forms submit. The CSP mirrors
  // the sandbox so an HTML `<meta http-equiv>` can't lift it.
  "Content-Security-Policy": "sandbox allow-scripts allow-popups allow-forms",
  "X-Content-Type-Options": "nosniff",
  // 5 minutes: a stale page on the iframe side is fine; the browser fetches it again when it reloads.
  "Cache-Control": "private, max-age=300",
} as const;

export { NO_STORE } from "./app-share-reply";

// A small map from a file extension to the Content-Type the route sets on the response. Used by
// the folder file route, where the extension tells us what the file is (HTML's stored as text/plain
// so a bucket can't host a live page, but the file name still says .html). The map is intentionally
// tiny: every other extension falls through to application/octet-stream and the response still works.
const FOLDER_TYPE: Record<string, string> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  svg: "image/svg+xml; charset=utf-8",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  txt: "text/plain; charset=utf-8",
  map: "application/json; charset=utf-8",
};

// A folder file's content type, from its extension (lower-cased, no leading dot). Returns
// application/octet-stream for anything the map doesn't know, so the route still works.
export function folderFileType(extension: string): string {
  const key = extension.toLowerCase().replace(/^\./, "");
  return FOLDER_TYPE[key] ?? "application/octet-stream";
}

// Strip the redaction-friendly extension. Sandboxed HTML and other text files still get the
// secret-shaped redaction the page route uses; binary bytes pass through untouched.
function applyTextRedaction(type: string, bytes: ArrayBuffer): string | ArrayBuffer {
  return isTextType(type) ? redactPageText(new TextDecoder().decode(bytes)) : bytes;
}

async function downloadBlob(service: SupabaseClient, orgId: string, sha: string): Promise<{ data: Blob; declared: string } | null> {
  const { data } = await service.storage.from("weft-blobs").download(`${orgId}/${sha}`);
  if (!data) return null;
  return { data, declared: data.type };
}

export async function serveBlobPage(service: SupabaseClient, orgId: string, sha: string): Promise<Response> {
  const got = await downloadBlob(service, orgId, sha);
  if (!got) return new Response("Not found", { status: 404, headers: NO_STORE });
  // Storage answers HTML as text/plain, so the type comes from the file (lib/share-page.ts), not the header. Anything
  // that isn't text (an image, a PDF) passes through as bytes.
  const bytes = await got.data.arrayBuffer();
  const type = pageContentType(got.declared, new TextDecoder().decode(bytes.slice(0, 512)));
  // The page is the owner's own file, but a key typed into it shouldn't reach a stranger: mask text the way the thread is.
  const body = applyTextRedaction(type, bytes);
  return new Response(body, { status: 200, headers: { ...HEADERS, "Content-Type": type } });
}

// A folder file: same sandbox, the type from the file's extension, and the same key-shaped text
// redaction serveBlobPage uses. The route decides the path is a key of row.files and passes the
// sha; this just streams weft-blobs/<org>/<sha> with the right headers.
export async function serveBlobFile(
  service: SupabaseClient,
  orgId: string,
  sha: string,
  extension: string,
): Promise<Response> {
  const got = await downloadBlob(service, orgId, sha);
  if (!got) return new Response("Not found", { status: 404, headers: NO_STORE });
  const bytes = await got.data.arrayBuffer();
  const type = folderFileType(extension);
  const body = applyTextRedaction(type, bytes);
  return new Response(body, { status: 200, headers: { ...HEADERS, "Content-Type": type } });
}
