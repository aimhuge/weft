// The Mac's side of a shared mini app's link preview (lib/app-preview.ts): after each share, the page's own meta
// tags, the folder's weft-app.json, a Haiku sentence when neither says what the app is, and a 1200×630 capture from
// a hidden window in Electron main (electron/page-snapshot.cjs), uploaded as a blob, into cloud_app_shares.preview.
// In the background: the Share dialog never waits for it, and asks again while isPreviewing() says it's running.
// It's made again when the page changed since the last one (`of`), when it's older than PREVIEW_MAX_AGE_MS (a data
// app's numbers move while its page doesn't; lib/app-preview-refresh.ts checks every shared app on a timer), sooner
// when the last capture failed (PREVIEW_RETRY_MS), and whenever you ask (Refresh preview). Haiku only runs again for
// a changed page. A failed capture keeps the last picture and leaves `shotFailedAt`, so the retry is never lost.
import fs from "node:fs";
import path from "node:path";
import {
  authorPreview, cleanImage, cleanPreview, descriptionPrompt, mergePreview, MIN_TEXT_FOR_SUMMARY, pageMeta,
  parseDescription, type AppPreview, type PageMeta,
} from "./app-preview";
import type { AppShareKind } from "./app-share-types";
import type { Ready } from "./app-share-row";
import { shell } from "./browser-tools";
import { createBlobStore } from "./blob-store";
import { BLOB_REF_PREFIX } from "./cloud-sync-types";
import { complete } from "./haiku";
import { DATA_DIR } from "./store";

// What the row says now (lib/app-share-row.ts currentPage) and its id: enough to tell a stale preview.
export interface PreviewTarget {
  id: string;
  preview?: unknown;
  org_id?: string;
}
export interface PreviewPage {
  kind: AppShareKind;
  page: string;
  files: Record<string, string> | null;
}

const HTML_MAX = 2 * 1024 * 1024;
const SITE_TIMEOUT_MS = 8000;
const IMAGE_EXT = /\.(png|jpe?g|webp|gif)$/i;
const previewing = new Set<string>();

// How long a preview stands before it's made again, and how soon a preview that should have a capture but has none
// (the desktop app was down, the page wouldn't load) tries again.
export const PREVIEW_MAX_AGE_MS = 6 * 60 * 60 * 1000;
export const PREVIEW_RETRY_MS = 30 * 60 * 1000;

// Whether the preview needs making again: a changed page, its age, or a capture that failed (or never came).
export function isStale(current: AppPreview | null, key: string, now = Date.now()): boolean {
  if (!current || current.of !== key || !current.at) return true;
  const age = now - current.at;
  if (age >= PREVIEW_MAX_AGE_MS) return true;
  if (current.shotFailedAt && now - current.shotFailedAt >= PREVIEW_RETRY_MS) return true;
  return !current.shot && !current.image && age >= PREVIEW_RETRY_MS;
}

export function isPreviewing(appId: string): boolean {
  return previewing.has(appId);
}

// The page the preview was made from: a folder's entry file by its sha, else the row's page (blob ref or address).
export function previewKey(now: PreviewPage): string {
  if (now.kind === "folder") return now.files?.[now.page] ?? now.page;
  return now.page;
}

// Where the dialog's card finds this Mac's capture of the app (app/api/apps/share/preview).
export function shotPath(appId: string): string {
  return path.join(DATA_DIR, "app-previews", `${appId.replace(/[^\w-]/g, "_")}.png`);
}

async function siteHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(SITE_TIMEOUT_MS),
    headers: { "user-agent": "WeftPreview/1.0 (+https://weft.zip)", accept: "text/html" },
  });
  if (!res.ok || !/html/i.test(res.headers.get("content-type") ?? "")) return "";
  return (await res.text()).slice(0, HTML_MAX);
}

function fileHtml(file: string): string {
  const stat = fs.statSync(file, { throwIfNoEntry: false });
  return stat && stat.size <= HTML_MAX ? fs.readFileSync(file, "utf8") : "";
}

export async function readPageHtml(t: Ready): Promise<string> {
  if (t.page.kind === "site") return siteHtml(t.page.url).catch(() => "");
  if (t.page.kind === "folder") return fileHtml(path.join(t.page.folder, t.page.entry));
  return fileHtml(t.page.local);
}

function readAuthor(t: Ready): ReturnType<typeof authorPreview> {
  if (t.page.kind !== "folder") return {};
  try {
    return authorPreview(JSON.parse(fs.readFileSync(path.join(t.page.folder, "weft-app.json"), "utf8")));
  } catch {
    return {};
  }
}

// A picture the page or weft-app.json names, as the row may hold it: https as is (a site's relative path against the
// site), a folder's own image file by its blob. Anything else (a Mac path, data:, http) is dropped.
export function resolveImage(raw: string | undefined, t: Ready, files: Record<string, string> | null): string | undefined {
  if (!raw) return undefined;
  const absolute = cleanImage(raw.startsWith("//") ? `https:${raw}` : raw);
  if (absolute) return absolute;
  if (t.page.kind === "site") {
    try {
      return cleanImage(new URL(raw, t.page.url).href);
    } catch {
      return undefined;
    }
  }
  if (t.page.kind !== "folder" || !IMAGE_EXT.test(raw)) return undefined;
  const rel = path.posix.normalize(raw.replace(/^\.?\//, ""));
  const sha = rel.startsWith("..") ? undefined : files?.[rel];
  return sha ? `${BLOB_REF_PREFIX}${sha}` : undefined;
}

async function describe(name: string, meta: PageMeta): Promise<string | undefined> {
  if (meta.text.length < MIN_TEXT_FOR_SUMMARY) return undefined;
  try {
    return parseDescription(await complete(descriptionPrompt(name, meta.text)));
  } catch {
    return undefined;
  }
}

// The app in a hidden 1200×630 window, saved beside the board's data and uploaded under the row's workspace.
async function captureShot(t: Ready, orgId: string): Promise<string | undefined> {
  try {
    const { png } = await shell("/page/snapshot", { url: t.app.url, width: 1200, height: 630 });
    if (typeof png !== "string" || !png) return undefined;
    const file = shotPath(t.app.id);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(png, "base64"));
    return (await createBlobStore({ client: t.client }).upload(file, orgId)) ?? undefined;
  } catch {
    return undefined; // no desktop app (next dev alone), or the page wouldn't load: the card draws without it
  }
}

async function writePreview(t: Ready, rowId: string, preview: AppPreview): Promise<void> {
  const { error } = (await t.client.from("cloud_app_shares").update({ preview }).eq("id", rowId)) as { error: { message: string } | null };
  if (error) throw new Error(error.message);
}

// What the last preview of this same page already had: Haiku's sentence and the capture. A refresh of an
// unchanged page reuses them, so Haiku only runs for a page that changed and a failed capture keeps the last one.
function fromSamePage(current: AppPreview | null, key: string): { description?: string; shot?: string } {
  if (!current || current.of !== key) return {};
  const kept: { description?: string; shot?: string } = {};
  if (current.by?.description === "weft") kept.description = current.description;
  if (current.shot) kept.shot = current.shot;
  return kept;
}

// The preview for what the page is now, from every source; `you` keeps a description typed in the dialog.
export async function buildPreview(t: Ready, now: PreviewPage, orgId: string, current: AppPreview | null): Promise<AppPreview> {
  const meta = pageMeta(await readPageHtml(t));
  const author = readAuthor(t);
  const you = current?.by?.description === "you" ? { description: current.description } : undefined;
  const app = { ...author, image: resolveImage(author.image, t, now.files) };
  const page = { title: meta.title, description: meta.description, image: resolveImage(meta.image, t, now.files) };
  const needsWords = !you?.description && !app.description && !page.description;
  const key = previewKey(now);
  const last = fromSamePage(current, key);
  const weft = needsWords ? { description: last.description ?? (await describe(t.app.name, meta)) } : undefined;
  // A page with its own picture needs no capture; otherwise we take one, and a failed capture keeps the last
  // picture but leaves a mark, so the next tick tries again (isStale reads shotFailedAt).
  const hasImage = Boolean(app.image || page.image);
  const captured = hasImage ? undefined : await captureShot(t, orgId);
  const shot = hasImage ? undefined : (captured ?? last.shot);
  const shotFailedAt = hasImage || captured ? undefined : Date.now();
  return mergePreview({ you, app, page, weft, shot, of: key, at: Date.now(), shotFailedAt });
}

// Makes the preview when the page changed since the last one (or `force`), once at a time per app. Never throws:
// a link without a preview still unfurls, as Weft's generic card.
export async function refreshAppPreview(t: Ready, row: PreviewTarget, now: PreviewPage, force = false): Promise<void> {
  const current = cleanPreview(row.preview);
  if (previewing.has(t.app.id) || (!force && !isStale(current, previewKey(now)))) return;
  previewing.add(t.app.id);
  try {
    await writePreview(t, row.id, await buildPreview(t, now, row.org_id ?? t.orgId, current));
  } catch (err) {
    console.error(`app-preview: ${t.app.name}: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    previewing.delete(t.app.id);
  }
}

// The Share dialog's description: yours until you clear it, which hands it back to the page and Haiku.
export async function setPreviewDescription(t: Ready, row: PreviewTarget, now: PreviewPage, text: string | null): Promise<void> {
  const current = cleanPreview(row.preview) ?? {};
  const typed = text?.trim() ? mergePreview({ you: { description: text } }).description : undefined;
  if (!typed) {
    const by = { ...current.by, description: undefined };
    await writePreview(t, row.id, { ...current, description: undefined, by, of: undefined });
    return refreshAppPreview(t, { ...row, preview: { ...current, by, of: undefined } }, now, true);
  }
  await writePreview(t, row.id, { ...current, description: typed, by: { ...current.by, description: "you" } });
}
