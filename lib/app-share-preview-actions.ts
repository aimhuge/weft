// The Share dialog's link preview (components/ShareAppPreview.tsx, through app/api/apps/share/preview): the card a
// chat would show, drawn here from this Mac's capture so it matches weft.zip's /api/a/<id>/og; your own description;
// and Refresh preview, which makes it again even though the page hasn't changed. lib/app-preview-capture.ts does the work.
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

async function drawCard(input: Parameters<typeof appCardImage>[0]): Promise<string> {
  try {
    return imageDataUrl(await (await appCardImage(input)).arrayBuffer());
  } catch {
    // twemoji is fetched; offline, the glyph falls back to a letter.
    return imageDataUrl(await (await appCardImage(input, { emoji: false })).arrayBuffer());
  }
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
  const image = await drawCard({ name: t.app.name, title: preview.title, description: preview.description, byline: await byline(t, row), shot });
  return { image, preview };
}
