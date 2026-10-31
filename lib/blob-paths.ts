// Which local files the blob store (lib/blob-store.ts) may upload, and how a string in a ThreadItem
// (a markdown target, a page, an open_url call's URL) resolves to one. Pure path rules, no Supabase.
//
// We refuse paths outside the user's home directory, the vault, anything that looks like a
// secret (account*, *-token.json, device-key.json, anything starting with .env). A file:// URL
// or an absolute path that doesn't exist on disk is left alone, so a row that mentions a missing
// image still round-trips.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MEDIA_REF, extensionOf } from "./media";

// Per-extension mime for the upload's content-type. The list matches what the outbox might actually upload:
// images, the HTML pages from lib/show.ts, SVGs and PDFs, and the files a page names (lib/blob-page-assets.ts):
// stylesheets, scripts, fonts, videos and audio. A browser refuses a stylesheet or script sent as octet-stream.
const BLOB_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  avif: "image/avif",
  ico: "image/x-icon",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  json: "application/json",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  ogg: "audio/ogg",
  vtt: "text/vtt; charset=utf-8",
};

export function contentTypeFor(file: string) {
  return BLOB_MIME[extensionOf(file)] ?? "application/octet-stream";
}

// A file a browser can show: what a Weft Worker limits itself to (lib/worker-blobs.ts). JSON stays out: on disk it's
// config far more often than a page's asset.
export function hasWebType(file: string) {
  const ext = extensionOf(file);
  return ext !== "json" && ext in BLOB_MIME;
}

// A basename that we never want to upload: secrets, account state, the device key, any token
// file, the whole vault folder. Matched case-insensitively.
const SECRET_BASENAMES = new Set(["device-key.json", "account.json", "account.sealed"]);

function basenameIsSecret(base: string) {
  const lower = base.toLowerCase();
  if (lower.startsWith(".env")) return true;
  if (SECRET_BASENAMES.has(lower)) return true;
  return lower.endsWith("-token.json") || lower.endsWith("-token");
}

// A path is safe to upload only when it lives under the home directory and doesn't point at
// secrets the vault owns. The outbox already filters by these rules; this is a defence in depth
// so a misbehaving caller can't push a token out.
export function isLocalUploadPath(p: string, home = os.homedir()): boolean {
  if (!p) return false;
  // file:// URLs get resolved to their path before the rest of the check.
  const fileUrl = /^file:\/\/(.+)$/i.exec(p);
  const target = fileUrl ? decodeURI(fileUrl[1] ?? "") : p;
  if (!target.startsWith("/")) return false;
  if (!target.startsWith(home + path.sep) && target !== home) return false;
  if (basenameIsSecret(path.basename(target))) return false;
  // Anywhere under ~/.weft/vault holds decrypted secrets; never upload from there.
  const vault = path.join(home, ".weft", "vault");
  if (target === vault || target.startsWith(vault + path.sep)) return false;
  return true;
}

// Resolves a string the item named (a markdown target, a page field) to a local file path when
// it's safe to upload; null when it should be left alone (http, localhost, missing, secret).
export function resolveLocalPath(raw: string, home = os.homedir()): string | null {
  if (!raw) return null;
  // http(s) and any localhost reference stays as-is so the row's reader can still fetch it.
  if (/^https?:\/\//i.test(raw)) return null;
  if (/^[a-z]+:\/\/localhost(?::\d+)?/i.test(raw)) return null;
  if (!isLocalUploadPath(raw, home)) return null;
  // Strip file:// if it slipped through and resolve to a real path on disk.
  const fileUrl = /^file:\/\/(.+)$/i.exec(raw);
  const local = fileUrl ? decodeURI(fileUrl[1] ?? "") : raw;
  if (!fs.existsSync(local) || !fs.statSync(local).isFile()) return null;
  return local;
}

// A page the pane showed, often `file:///…/.weft/show/x/index.html#step-2`: the file to upload plus
// the #hash, kept verbatim so the ref reads `blob:sha256:<hex>#step-2` (paneFromUrl in
// lib/share-types.ts parses that). The whole string is tried first, since a file name may hold a '#'.
export function resolvePage(raw: string, home = os.homedir()): { local: string; hash: string } | null {
  const whole = resolveLocalPath(raw, home);
  if (whole) return { local: whole, hash: "" };
  const at = raw.indexOf("#");
  if (at <= 0) return null;
  const local = resolveLocalPath(raw.slice(0, at), home);
  return local ? { local, hash: raw.slice(at) } : null;
}

// Collects every local-path substring a markdown body's image / link targets point at, in
// source order. Each target is resolved (or null) up front; the caller awaits the uploads and
// splices the refs back in. Angle-bracketed and bare targets both come back as the raw string.
export function findMarkdownLocalPaths(text: string, home: string): string[] {
  const locals: string[] = [];
  for (const match of text.matchAll(MEDIA_REF)) {
    // MEDIA_REF guarantees one of the two capture groups: an angled target first, else the bare one.
    const target = (match[2] ?? match[3] ?? "").trim();
    const local = resolveLocalPath(target, home);
    locals.push(local ?? "");
  }
  return locals;
}
