// The files a single-file page links to beside it (docs/architecture/mini-app-hosting.md). A page an agent
// writes under ~/.weft/show/<topic>/index.html often says <img src="us.webp">; shared as one blob, that
// image resolves to nothing on weft.zip. lib/app-share.ts asks this module for the page's relative
// assets and, when there are any, shares the page as a folder of just those files (not the whole
// folder: ~/.weft/show holds every other page too), so the link serves them by path.
import fs from "node:fs";
import path from "node:path";
import { isLocalUploadPath } from "./blob-paths";
import { APP_FOLDER_MAX_FILE_BYTES, APP_FOLDER_MAX_TOTAL_BYTES, type AppFolderFile } from "./app-folder";

// The attributes and CSS that load a file: src, href, poster, data, srcset's comma list, and url() in
// inline styles or <style> blocks. Quoted or bare attribute values both count.
const ATTR_REF = /\b(?:src|href|poster|data)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;
const SRCSET_REF = /\bsrcset\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const CSS_URL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"']*))\s*\)/gi;

// The path segments the folder route serves (app/api/a/[id]/f): anything else would 404 there anyway.
const SEGMENT_RE = /^[A-Za-z0-9._-]+$/;

// Every raw reference in the page, in source order, duplicates and all.
function rawRefs(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(ATTR_REF)) out.push(m[1] ?? m[2] ?? m[3] ?? "");
  for (const m of html.matchAll(SRCSET_REF)) {
    for (const candidate of (m[1] ?? m[2] ?? "").split(",")) out.push(candidate.trim().split(/\s+/)[0] ?? "");
  }
  for (const m of html.matchAll(CSS_URL)) out.push((m[1] ?? m[2] ?? m[3] ?? "").trim());
  return out;
}

// A reference as a path relative to the page's folder, or null when it isn't one we upload: a scheme
// (https:, data:, mailto:), a protocol-relative or root-absolute path, a bare #anchor, a path that
// climbs out of the folder, or a segment the folder route wouldn't serve.
export function relativeAssetPath(ref: string): string | null {
  const bare = ref.split(/[?#]/)[0] ?? "";
  if (!bare || /^[a-z][a-z0-9+.-]*:/i.test(bare) || bare.startsWith("/")) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(bare);
  } catch {
    return null;
  }
  const normal = path.posix.normalize(decoded.replace(/^\.\//, ""));
  if (normal === "." || normal.startsWith("..")) return null;
  const parts = normal.split("/");
  if (parts.some((p) => !SEGMENT_RE.test(p) || p.startsWith("."))) return null;
  return normal;
}

// The files beside `entry` (an absolute path to an .html file) that its HTML links to and that exist on
// disk, safe to upload (lib/blob-paths.ts rules), in source order without duplicates. Size caps match a
// folder app's; a file over them is left out, so the page still shares and only that file stays broken.
export function pageAssets(entry: string, home: string): AppFolderFile[] {
  if (!/\.html?$/i.test(entry)) return [];
  const folder = path.dirname(entry);
  let html: string;
  let realFolder: string;
  try {
    html = fs.readFileSync(entry, "utf8");
    realFolder = fs.realpathSync(folder) + path.sep;
  } catch {
    return [];
  }
  const entryName = path.basename(entry);
  const seen = new Set<string>([entryName]);
  const out: AppFolderFile[] = [];
  let total = 0;
  for (const ref of rawRefs(html)) {
    const relative = relativeAssetPath(ref);
    if (!relative || seen.has(relative)) continue;
    seen.add(relative);
    const absolute = path.join(folder, ...relative.split("/"));
    if (!isLocalUploadPath(absolute, home)) continue;
    let stat: fs.Stats;
    let real: string;
    try {
      stat = fs.lstatSync(absolute);
      real = fs.realpathSync(absolute);
    } catch {
      continue;
    }
    // A symlinked folder on the way could point anywhere; the real file must sit inside the page's folder.
    if (!stat.isFile() || !real.startsWith(realFolder) || stat.size > APP_FOLDER_MAX_FILE_BYTES || total + stat.size > APP_FOLDER_MAX_TOTAL_BYTES) continue;
    total += stat.size;
    out.push({ absolute, relative, size: stat.size });
  }
  return out;
}

// A single-file page as a folder share of itself plus its linked files, or null when it links to none
// (it stays a plain blob, which keeps its #hash).
export function pageWithAssets(entry: string, home: string): { kind: "folder"; folder: string; entry: string; files: AppFolderFile[]; manifest: Record<string, never> } | null {
  // The entry is served by name too (lib/app-share-frame.ts), so it needs a name the route serves.
  if (!SEGMENT_RE.test(path.basename(entry))) return null;
  const assets = pageAssets(entry, home);
  if (!assets.length) return null;
  const self: AppFolderFile = { absolute: entry, relative: path.basename(entry), size: fs.statSync(entry).size };
  return { kind: "folder", folder: path.dirname(entry), entry: self.relative, files: [self, ...assets], manifest: {} };
}
