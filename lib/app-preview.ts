// A shared mini app's link preview (docs/architecture/mini-apps.md): the title, description and picture Slack, X or
// iMessage show when someone pastes weft.zip/@you/apps/<slug>. The Mac fills it in when the app is shared
// (lib/app-preview-capture.ts) into cloud_app_shares.preview; weft.zip reads it for the page's metadata
// (lib/app-share-meta.ts) and draws the branded card (lib/app-card-image.tsx). Each field takes the first that exists:
// what you typed in the Share dialog, the app's own weft-app.json, the page's own meta tags, then what Weft made
// (a Haiku sentence, a screenshot). Pure, so the dialog, the Mac and weft.zip all import it.
import { BLOB_REF_PREFIX } from "./cloud-sync-types";

// Who set a field: you in the Share dialog, the app's weft-app.json, the page's meta tags, or Weft.
export type PreviewSource = "you" | "app" | "page" | "weft";

export interface AppPreview {
  // Defaults to the app's name when absent.
  title?: string;
  description?: string;
  // The picture a link shows instead of the branded card: an https address, or a blob ref for a folder app's own file.
  image?: string;
  // A 1200×630 capture of the app, a blob ref, inset in the branded card.
  shot?: string;
  // What the preview was made from (the page's blob, the site's address, the folder entry's sha), so a changed page
  // gets a fresh one.
  of?: string;
  // When it was made (ms), so a data app's picture is taken again once its numbers have moved (lib/app-preview-capture.ts).
  at?: number;
  // When the last capture failed (ms), so a preview that should have a picture tries again sooner (PREVIEW_RETRY_MS).
  shotFailedAt?: number;
  by?: { title?: PreviewSource; description?: PreviewSource; image?: PreviewSource };
}

export const PREVIEW_TITLE_MAX = 80;
export const PREVIEW_DESCRIPTION_MAX = 200;
// How much of the page's text Haiku reads.
const TEXT_MAX = 4000;

const BLOB_REF = /^blob:sha256:[0-9a-f]{64}$/;
const SOURCES: readonly PreviewSource[] = ["you", "app", "page", "weft"];

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] !== "#") return ENTITIES[code.toLowerCase()] ?? whole;
    const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : whole;
  });
}

// One line of plain text, at most `max` characters, cut at a word with an ellipsis; undefined when nothing is left.
export function cleanText(raw: unknown, max: number): string | undefined {
  if (typeof raw !== "string") return undefined;
  const text = decodeEntities(raw).replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const word = cut.replace(/\s+\S*$/, "");
  return `${(word.length > max / 2 ? word : cut).replace(/[\s.,;:–-]+$/, "")}…`;
}

// An https address, a blob ref, or nothing: the only pictures a preview may name.
export function cleanImage(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  if (BLOB_REF.test(raw)) return raw;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && raw.length <= 2000 ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export interface PageMeta {
  title?: string;
  description?: string;
  // As the page wrote it: absolute, or relative to the page (resolved by the caller, which knows where the page lives).
  image?: string;
  // The page's visible text, for Haiku.
  text: string;
}

function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3]) : undefined;
}

// The <meta> tags by their property or name, lowercased; the first of each wins, as unfurlers read them.
function metaTags(html: string): Map<string, string> {
  const tags = new Map<string, string>();
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const key = (attr(tag, "property") ?? attr(tag, "name"))?.toLowerCase();
    const content = attr(tag, "content");
    if (key && content !== undefined && !tags.has(key)) tags.set(key, content);
  }
  return tags;
}

export function pageText(html: string): string {
  const body = html
    .replace(/<(script|style|noscript|template|svg|head)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ");
  return (cleanText(body, TEXT_MAX) ?? "").replace(/…$/, "");
}

// What a page says about itself: Open Graph first, then Twitter's tags, then the plain <title> and description.
export function pageMeta(html: string): PageMeta {
  const tags = metaTags(html);
  const first = (...keys: string[]) => keys.map((k) => tags.get(k)).find((v) => v?.trim());
  const title = first("og:title", "twitter:title") ?? /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  return {
    title: cleanText(title, PREVIEW_TITLE_MAX),
    description: cleanText(first("og:description", "twitter:description", "description"), PREVIEW_DESCRIPTION_MAX),
    image: first("og:image", "og:image:url", "og:image:secure_url", "twitter:image", "twitter:image:src")?.trim(),
    text: pageText(html),
  };
}

// weft-app.json's preview fields: { "title", "description", "image" } (image: an https address or a path in the folder).
export function authorPreview(raw: unknown): { title?: string; description?: string; image?: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const r = raw as Record<string, unknown>;
  const image = typeof r.image === "string" && r.image.trim() ? r.image.trim() : undefined;
  return {
    title: cleanText(r.title, PREVIEW_TITLE_MAX),
    description: cleanText(r.description, PREVIEW_DESCRIPTION_MAX),
    image,
  };
}

// Too little text to say anything true about the page: no Haiku call.
export const MIN_TEXT_FOR_SUMMARY = 40;

export function descriptionPrompt(name: string, text: string): string {
  return [
    `Write the one-sentence description a link preview shows for a small web app called "${name}".`,
    `Say what it shows or lets you do, specifically, in at most 25 words. No quotes, no emoji, no "This app".`,
    `Reply with the sentence only.`,
    "",
    "The page's text:",
    text.slice(0, TEXT_MAX),
  ].join("\n");
}

// Haiku's sentence, or undefined when it didn't give one (an empty reply, a refusal, a question back).
export function parseDescription(reply: string): string | undefined {
  const line = reply.split("\n").map((l) => l.trim()).find(Boolean);
  if (!line) return undefined;
  const text = line.replace(/^(description|sentence)\s*:\s*/i, "").replace(/^["'“‘]+|["'”’]+$/g, "");
  if (/^(i |i'm |sorry|as an ai)/i.test(text) || text.endsWith("?")) return undefined;
  return cleanText(text, PREVIEW_DESCRIPTION_MAX);
}

type Picked<T> = { value?: T; by?: PreviewSource };

function pick<T>(...options: [T | undefined, PreviewSource][]): Picked<T> {
  const hit = options.find(([v]) => v !== undefined);
  return hit ? { value: hit[0], by: hit[1] } : {};
}

// The preview from every source, first that exists wins. `you` is the dialog's description, kept over every refresh.
export function mergePreview(input: {
  you?: { description?: string };
  app?: { title?: string; description?: string; image?: string };
  page?: { title?: string; description?: string; image?: string };
  weft?: { description?: string };
  shot?: string;
  of?: string;
  at?: number;
  shotFailedAt?: number;
}): AppPreview {
  const title = pick([input.app?.title, "app"], [input.page?.title, "page"]);
  const description = pick(
    [input.you?.description, "you"],
    [input.app?.description, "app"],
    [input.page?.description, "page"],
    [input.weft?.description, "weft"],
  );
  const image = pick([input.app?.image, "app"], [input.page?.image, "page"]);
  const by = { title: title.by, description: description.by, image: image.by };
  return cleanPreview({
    title: title.value,
    description: description.value,
    image: image.value,
    shot: input.shot,
    of: input.of,
    at: input.at,
    shotFailedAt: input.shotFailedAt,
    by,
  }) ?? {};
}

function cleanBy(raw: unknown): AppPreview["by"] | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const by: NonNullable<AppPreview["by"]> = {};
  for (const key of ["title", "description", "image"] as const) {
    const v = r[key];
    if (typeof v === "string" && (SOURCES as readonly string[]).includes(v)) by[key] = v as PreviewSource;
  }
  return Object.keys(by).length ? by : undefined;
}

// When the preview was made (ms), as the row may hold it: a whole number of milliseconds, or nothing.
function cleanAt(raw: unknown): number | undefined {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return undefined;
  return Math.round(raw);
}

// The two pointers a preview carries: the capture it was made from, as a blob ref, and what it was made from.
function cleanPointers(raw: Record<string, unknown>): { shot?: string; of?: string } {
  const pointers: { shot?: string; of?: string } = {};
  if (typeof raw.shot === "string" && BLOB_REF.test(raw.shot)) pointers.shot = raw.shot;
  if (typeof raw.of === "string" && raw.of.length <= 2100) pointers.of = raw.of;
  return pointers;
}

// When the last capture failed, as the row may hold it: a whole number of milliseconds, or nothing.
function cleanShotFailedAt(raw: unknown): number | undefined {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return undefined;
  return Math.round(raw);
}

// A preview read back from the row, as weft.zip and the dialog trust it: plain strings at their caps, only https or
// blob pictures, a shot only as a blob ref. Anything else is dropped; null when nothing is left.
export function cleanPreview(raw: unknown): AppPreview | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const { shot, of } = cleanPointers(r);
  const at = cleanAt(r.at);
  const shotFailedAt = cleanShotFailedAt(r.shotFailedAt);
  const preview: AppPreview = {
    ...(cleanText(r.title, PREVIEW_TITLE_MAX) ? { title: cleanText(r.title, PREVIEW_TITLE_MAX) } : {}),
    ...(cleanText(r.description, PREVIEW_DESCRIPTION_MAX) ? { description: cleanText(r.description, PREVIEW_DESCRIPTION_MAX) } : {}),
    ...(cleanImage(r.image) ? { image: cleanImage(r.image) } : {}),
    ...(shot ? { shot } : {}),
    ...(of ? { of } : {}),
    ...(at ? { at } : {}),
    ...(shotFailedAt ? { shotFailedAt } : {}),
  };
  const by = cleanBy(r.by);
  if (by) preview.by = by;
  return Object.keys(preview).length ? preview : null;
}

// The sha a blob ref names, or null.
export function blobRefSha(ref: string | undefined): string | null {
  return ref && BLOB_REF.test(ref) ? ref.slice(BLOB_REF_PREFIX.length) : null;
}
