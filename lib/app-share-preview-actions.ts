// The Share dialog's link preview (components/ShareAppPreview.tsx, through app/api/apps/share/preview): the card a
// chat would show, drawn here from this Mac's capture so it matches weft.zip's /api/a/<id>/og; your own description;
// and Refresh preview, which makes it again even though the page hasn't changed. lib/app-preview-capture.ts does the work.
// The drawn card is cached beside the capture, keyed by what it shows, so opening the dialog again doesn't redraw it.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { appCardImage, imageDataUrl } from "./app-card-image";
import { blobRefSha, cleanPreview, type AppPreview } from "./app-preview";
import { refreshAppPreview, setPreviewDescription, shotPath } from "./app-preview-capture";
import { AppShareError, getAppShare, target } from "./app-share";
import { listOwners } from "./app-share-owners";
import { currentPage, readShare, type AppShareRow, type Ready } from "./app-share-row";
import type { AppShareState } from "./app-share-types";

async function shared(appId: string): Promise<{ t: Ready; row: AppShareRow; now: Awaited<ReturnType<typeof currentPage>> }> {
  const t = await target(appId);
  if (t.kind === "blocked") throw new AppShareError("Share this app first.", 400);
  const row = await readShare(t);
  if (!row) throw new AppShareError("Share this app first.", 400);
  return { t, row, now: await currentPage(t, false, row.org_id ?? t.orgId) };
}

export async function describeApp(appId: string, text: string | null): Promise<AppShareState> {
  const { t, row, now } = await shared(appId);
  await setPreviewDescription(t, row, now, text);
  return getAppShare(appId);
}

// The background refresh (lib/app-preview-refresh.ts): makes the preview again only when it's stale, and waits for it.
export async function refreshIfStale(appId: string): Promise<void> {
  const { t, row, now } = await shared(appId);
  await refreshAppPreview(t, row, now);
}

export async function refreshPreview(appId: string): Promise<AppShareState> {
  const { t, row, now } = await shared(appId);
  void refreshAppPreview(t, row, now, true);
  return getAppShare(appId);
}

async function byline(t: Ready, row: AppShareRow): Promise<string> {
  const owners = await listOwners(t);
  if (row.owner === "org") return owners.orgs.find((o) => o.id === row.org_id)?.name ?? "weft.zip";
  return owners.user ? `@${owners.user.username}` : "weft.zip";
}

function readBytes(file: string): ArrayBuffer | null {
  try {
    const buf = fs.readFileSync(file);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  } catch {
    return null;
  }
}

// A folder app's own picture, from the folder on disk by the sha the row names.
function folderImage(t: Ready, files: Record<string, string> | null, preview: AppPreview): string | null {
  const sha = blobRefSha(preview.image);
  const rel = sha && files ? Object.keys(files).find((k) => files[k] === sha) : undefined;
  const bytes = rel && t.page.kind === "folder" ? readBytes(path.join(t.page.folder, rel)) : null;
  return bytes ? imageDataUrl(bytes) : null;
}

async function drawCard(input: Parameters<typeof appCardImage>[0]): Promise<ArrayBuffer> {
  try {
    return await (await appCardImage(input)).arrayBuffer();
  } catch {
    // twemoji is fetched; offline, the glyph falls back to a letter.
    return (await appCardImage(input, { emoji: false })).arrayBuffer();
  }
}

// The card for these words and this capture, from the cache when it was drawn before; one file per app, replaced.
export function cardCachePath(appId: string, key: string): string {
  return shotPath(appId).replace(/\.png$/, `.card-${key}.png`);
}

async function cachedCard(appId: string, input: Parameters<typeof appCardImage>[0], shotRef: string | undefined): Promise<string> {
  const key = crypto.createHash("sha256").update(JSON.stringify([{ ...input, shot: undefined }, shotRef ?? null])).digest("hex").slice(0, 16);
  const file = cardCachePath(appId, key);
  const hit = readBytes(file);
  if (hit) return imageDataUrl(hit);
  const bytes = await drawCard(input);
  const dir = path.dirname(file);
  const prefix = path.basename(shotPath(appId)).replace(/\.png$/, ".card-");
  for (const old of fs.readdirSync(dir, { withFileTypes: true })) {
    if (old.isFile() && old.name.startsWith(prefix)) fs.rmSync(path.join(dir, old.name), { force: true });
  }
  fs.writeFileSync(file, Buffer.from(bytes));
  return imageDataUrl(bytes);
}

// What the link unfurls as, for the dialog: the app's or page's own picture, else the branded card.
export async function previewCard(appId: string): Promise<{ image: string | null; preview: AppPreview | null }> {
  const { t, row, now } = await shared(appId);
  const preview = cleanPreview(row.preview);
  if (!preview) return { image: null, preview: null };
  if (preview.image?.startsWith("https:")) return { image: preview.image, preview };
  const own = folderImage(t, now.files, preview);
  if (own) return { image: own, preview };
  const shot = preview.shot ? readBytes(shotPath(appId)) : null;
  const input = { name: t.app.name, title: preview.title, description: preview.description, byline: await byline(t, row), shot };
  fs.mkdirSync(path.dirname(shotPath(appId)), { recursive: true });
  const image = await cachedCard(appId, input, shot ? preview.shot : undefined);
  return { image, preview };
}
