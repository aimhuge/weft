// The local files an HTML page leans on, for the blob store's page upload (lib/blob-store.ts uploadPage): a page
// from ~/.weft/show names its images by relative paths (`<img src="shot.png">`), which mean nothing on weft.zip or
// the phone. rewritePageHtml finds each one (img/video/audio/source/track/script/embed src, poster, srcset, icon
// links, CSS url() in <style> and style="", and a local <link rel=stylesheet>, which is inlined so its own url()s
// can be rewritten too), uploads it through the caller's `upload` under lib/blob-paths.ts's rules, and puts its
// `blob:sha256:<hex>` ref in its place. The routes that serve the page swap those refs for signed URLs
// (lib/blob-page-sign.ts). Only the uploaded copy changes; the file on disk is never touched.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveLocalPath } from "./blob-paths";
import type { BlobRef } from "./cloud-sync-types";
import { extensionOf } from "./media";

/** An asset bigger than this stays a dead link rather than filling the bucket (Supabase's own cap is 50 MB). */
export const MAX_ASSET_BYTES = 50 * 1024 * 1024;

export type AssetUpload = (local: string) => Promise<BlobRef | null>;

const SRC_TAG = /<(?:img|video|audio|source|track|script|embed|input)\b[^>]*>/gi;
const URL_ATTR = /(\s)(src|poster)(\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;
const SRCSET_ATTR = /(\s)(srcset)(\s*=\s*)(?:"([^"]*)"|'([^']*)')/gi;
const HREF_ATTR = /(\s)(href)(\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;
const LINK_TAG = /<link\b[^>]*>/gi;
const STYLE_BLOCK = /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi;
const STYLE_ATTR = /(\sstyle\s*=\s*)(?:"([^"]*)"|'([^']*)')/gi;
const CSS_URL = /url\(\s*(["']?)([^"')]+)\1\s*\)/gi;
// A URL with a scheme (http:, data:, blob:, mailto:…), protocol-relative, or a bare #fragment: nothing local.
const NOT_LOCAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i;

/** The local file a page's raw reference names, read against `baseDir`; null when it isn't one we may upload. */
export function resolveAssetPath(raw: string, baseDir: string, home = os.homedir()): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (/^file:\/\//i.test(value)) return sizeOk(resolveLocalPath(value.replace(/[?#].*$/, ""), home));
  if (NOT_LOCAL.test(value)) return null;
  const bare = value.replace(/[?#].*$/, "");
  let decoded = bare;
  try {
    decoded = decodeURIComponent(bare);
  } catch {
    // A stray % in a file name: try the path as written.
  }
  return sizeOk(resolveLocalPath(path.resolve(baseDir, decoded), home));
}

function sizeOk(local: string | null): string | null {
  return local && fs.statSync(local).size <= MAX_ASSET_BYTES ? local : null;
}

// A #fragment rides along after the ref (an SVG sprite's `icons.svg#star`), so the signed URL keeps it.
const fragmentOf = (raw: string) => /#.*$/.exec(raw.trim())?.[0] ?? "";

async function replaceAsync(text: string, re: RegExp, fn: (m: RegExpExecArray) => Promise<string | null>): Promise<string> {
  const parts: string[] = [];
  let last = 0;
  for (const m of text.matchAll(re) as IterableIterator<RegExpExecArray>) {
    parts.push(text.slice(last, m.index), (await fn(m)) ?? m[0]);
    last = m.index + m[0].length;
  }
  parts.push(text.slice(last));
  return parts.join("");
}

function attrOf(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i").exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3] ?? "") : null;
}

class PageRewriter {
  private refs = new Map<string, Promise<BlobRef | null>>();

  constructor(private upload: AssetUpload, private home: string, private allowed: (local: string) => boolean) {}

  // The ref for one raw reference, uploading its file once however often the page names it.
  async refFor(raw: string, baseDir: string): Promise<string | null> {
    const local = resolveAssetPath(raw, baseDir, this.home);
    if (!local) return null;
    if (!this.refs.has(local)) this.refs.set(local, this.upload(local).catch(() => null));
    const ref = await this.refs.get(local);
    return ref ? `${ref}${fragmentOf(raw)}` : null;
  }

  // One attribute match (quoted either way or bare), its value swapped for its ref.
  async attr(m: RegExpExecArray, baseDir: string): Promise<string | null> {
    const [, space, name, eq, dq, sq, bare] = m;
    const value = dq ?? sq ?? bare ?? "";
    const ref = await this.refFor(value, baseDir);
    if (!ref) return null;
    const quote = dq !== undefined ? '"' : sq !== undefined ? "'" : "";
    return `${space}${name}${eq}${quote}${ref}${quote}`;
  }

  async srcset(m: RegExpExecArray, baseDir: string): Promise<string | null> {
    const [, space, name, eq, dq, sq] = m;
    const value = dq ?? sq ?? "";
    const candidates = await Promise.all(
      value.split(",").map(async (part) => {
        const [url = "", ...descriptor] = part.trim().split(/\s+/);
        const ref = url ? await this.refFor(url, baseDir) : null;
        return ref ? [ref, ...descriptor].join(" ") : part.trim();
      }),
    );
    const next = candidates.join(", ");
    const quote = dq !== undefined ? '"' : "'";
    return next === value ? null : `${space}${name}${eq}${quote}${next}${quote}`;
  }

  async css(text: string, baseDir: string): Promise<string> {
    return replaceAsync(text, CSS_URL, async (m) => {
      const ref = await this.refFor(m[2] ?? "", baseDir);
      return ref ? `url("${ref}")` : null;
    });
  }

  async srcTag(tag: string, baseDir: string): Promise<string> {
    const withUrls = await replaceAsync(tag, URL_ATTR, (m) => this.attr(m, baseDir));
    return replaceAsync(withUrls, SRCSET_ATTR, (m) => this.srcset(m, baseDir));
  }

  // A local stylesheet comes in as a <style> block, its url()s read against the stylesheet's own folder; an icon
  // link's href becomes a ref. Every other link (a canonical, a font CDN) stays as it was.
  async linkTag(tag: string, baseDir: string): Promise<string | null> {
    const rel = (attrOf(tag, "rel") ?? "").toLowerCase();
    const href = attrOf(tag, "href");
    if (href === null) return null;
    if (/\bstylesheet\b/.test(rel)) {
      const local = resolveAssetPath(href, baseDir, this.home);
      // Read here rather than uploaded, so the store's veto has to be asked here too.
      if (!local || extensionOf(local) !== "css" || !this.allowed(local)) return null;
      const css = await this.css(fs.readFileSync(local, "utf8"), path.dirname(local));
      const media = attrOf(tag, "media");
      return `<style${media ? ` media="${media.replace(/"/g, "&quot;")}"` : ""}>\n${css.replace(/<\/style/gi, "<\\/style")}\n</style>`;
    }
    if (!/\bicon\b/.test(rel)) return null;
    return replaceAsync(tag, HREF_ATTR, (m) => this.attr(m, baseDir));
  }

  async page(html: string, baseDir: string): Promise<string> {
    let out = await replaceAsync(html, LINK_TAG, (m) => this.linkTag(m[0], baseDir));
    out = await replaceAsync(out, SRC_TAG, (m) => this.srcTag(m[0], baseDir));
    out = await replaceAsync(out, STYLE_BLOCK, async (m) => `${m[1]}${await this.css(m[2] ?? "", baseDir)}${m[3]}`);
    return replaceAsync(out, STYLE_ATTR, async (m) => {
      const [, lead, dq, sq] = m;
      const css = await this.css(dq ?? sq ?? "", baseDir);
      return dq !== undefined ? `${lead}"${css.replace(/"/g, "'")}"` : `${lead}'${css}'`;
    });
  }
}

/** The page with each local asset uploaded and named by its blob ref, or null when it names none. */
export async function rewritePageHtml(html: string, pageFile: string, upload: AssetUpload, home = os.homedir(), allowed: (local: string) => boolean = () => true): Promise<string | null> {
  const next = await new PageRewriter(upload, home, allowed).page(html, path.dirname(pageFile));
  return next === html ? null : next;
}
