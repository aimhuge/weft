// Pasted and dropped files are saved to Weft's attachments folder, and a message refers to each one
// where it was pasted as Markdown image syntax: ![name](/Users/me/.weft/attachments/shot-1a2b3c4d.png).
// These helpers are shared by the server and the board UI, so nothing here touches the file system.

export type MediaKind = "image" | "video" | "audio" | "file";

// Images the Claude API accepts as image blocks.
export const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp"]);
export const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "m4v", "webm"]);
export const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "m4a", "aac", "ogg", "oga", "flac", "opus"]);

// "<slug>-<id>.<ext>", as saveAttachment names files.
export const ATTACHMENT_NAME = /^[a-z0-9][a-z0-9_-]*\.[a-z0-9]{1,8}$/;

// The attachment refs in a message: ![name](path) or ![name](<path with spaces>).
export const MEDIA_REF = /!\[([^\]\n]*)\]\((?:<([^>\n]+)>|([^)\s]+))\)/g;

export function extensionOf(src: string) {
  const base = src.split(/[?#]/)[0] ?? "";
  const dot = base.lastIndexOf(".");
  return dot > base.lastIndexOf("/") ? base.slice(dot + 1).toLowerCase() : "";
}

// A signed link to a synced blob (the weft.zip board): it has no file extension, and nearly every blob in a
// thread is a screenshot or a pasted picture, so it shows as an image (MediaView falls back if it isn't one).
const SIGNED_BLOB = /\/storage\/v1\/object\/sign\/weft-blobs\//;
// The same blob served from Cloudflare R2 (lib/r2.ts presignGet): `<account>.r2.cloudflarestorage.com/<bucket>/<org>/<sha>?X-Amz-…`.
const R2_BLOB = /^https:\/\/[0-9a-f]{32}\.r2\.cloudflarestorage\.com\/[^/]+\/[0-9a-f-]{36}\/[0-9a-f]{64}\?/i;

export function mediaKind(src: string): MediaKind {
  const ext = extensionOf(src);
  if (!ext && (SIGNED_BLOB.test(src) || R2_BLOB.test(src))) return "image";
  if (IMAGE_EXTENSIONS.has(ext) || ext === "svg") return "image";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  if (AUDIO_EXTENSIONS.has(ext)) return "audio";
  return "file";
}

// The attachment's file name, when src is a path in an attachments folder.
export function attachmentName(src: string) {
  const match = /\/attachments\/([^/]+)$/.exec(src);
  const name = match?.[1];
  return name && ATTACHMENT_NAME.test(name) ? name : null;
}

// Where the board loads an attachment from: "/…/.weft/attachments/x.png" -> "/api/attachments/x.png".
// Web URLs pass through; any other path can't be shown.
export function mediaUrl(src: string) {
  const name = attachmentName(src);
  if (name) return `/api/attachments/${name}`;
  return /^https?:\/\//.test(src) ? src : null;
}

// The Markdown for one attachment. Angle brackets keep a path with spaces in one piece.
export function mediaMarkdown(name: string, path: string) {
  const alt = name.replace(/[[\]\n]/g, " ").trim() || "attachment";
  return `![${alt}](${/\s/.test(path) ? `<${path}>` : path})`;
}
