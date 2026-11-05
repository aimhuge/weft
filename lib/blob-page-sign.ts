// A synced page's assets, made loadable where it's served. The blob store uploads a page with its local images
// named by `blob:sha256:<hex>` refs (lib/blob-page-assets.ts); a browser can't load those, so the routes that send
// the page (the web board's pane, a share link's frame) swap each one for a signed URL from lib/blob-urls.ts, R2
// first. Signed URLs, not a cookie route per asset: the page is sent with a CSP sandbox, so it runs in an opaque
// origin and its image requests carry no weft.zip session cookie. The phone does the same with the pure halves:
// pageBlobRefs on the page's text, POST them to /api/web-board/<org>/blob-urls, signPageRefs with the answer.
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveBlobUrls } from "./blob-urls";
import { queueMirror } from "./r2-queue";

const PAGE_REF = /blob:sha256:[0-9a-f]{64}/g;
/** A page names at most this many assets for signing; the rest stay as refs. */
export const MAX_PAGE_REFS = 200;

/** Every distinct blob ref a page's text names, in first-seen order. */
export function pageBlobRefs(html: string): string[] {
  return [...new Set(html.match(PAGE_REF) ?? [])].slice(0, MAX_PAGE_REFS);
}

/** The page with each ref `urls` signs swapped for its URL; a ref nobody could sign stays as it was. */
export function signPageRefs(html: string, urls: Record<string, string>): string {
  return html.replace(PAGE_REF, (ref) => urls[ref] ?? ref);
}

/** The page's refs signed as `client` may see them (a member's session, or the service client after a share's check). */
export async function signPageAssets(client: SupabaseClient, orgId: string, html: string): Promise<string> {
  const refs = pageBlobRefs(html);
  if (!refs.length) return html;
  const urls = await resolveBlobUrls(client, orgId, refs, { onUnmirrored: queueMirror(orgId) });
  return signPageRefs(html, urls);
}
