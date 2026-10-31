// The cloud_cards rows a flush uploads (lib/cloud-sync.ts), thumbnails included. After each turn
// lib/show.ts saves the pane's capture as an attachment and sets `card.thumb` to its
// `/api/attachments/<name>` URL (or the latest thread image, lib/card-pictures.ts). Neither resolves off
// this Mac, so the file goes up as a blob and the row's copy of the card carries the ref instead; the
// local card keeps its own value. The share viewer shows this capture when the pane is on localhost,
// which a remote viewer can't reach, and the web board draws it on the card.
import { attachmentFile } from "./attachments";
import { resolveLocalPath, resolvePage } from "./blob-paths";
import type { BlobStore, CloudCardRow, OutboxEntry } from "./cloud-sync-types";
import { deviceId } from "./device-id";
import { attachmentName } from "./media";
import { paneFromUrl } from "./share-types";
import { getCard } from "./store";

// Every live card the batch touches, not just those with a card entry: a card that changed before its folder
// was opted in still needs its row before its items can reference it.
export async function cardRows(blobs: BlobStore, orgId: string, pending: OutboxEntry[], at: number): Promise<CloudCardRow[]> {
  const ids = new Set(pending.filter((e) => e.op !== "card_deleted").map((e) => e.cardId));
  const rows: CloudCardRow[] = [];
  for (const id of ids) {
    const card = getCard(id);
    if (!card) continue;
    rows.push({
      org_id: orgId,
      card_id: id,
      owner_device: deviceId(),
      folder: card.cwd,
      card,
      deleted: false,
      updated_at: new Date(at).toISOString(),
    });
  }
  const withThumbs = await withUploadedThumbs(rows, blobs, orgId);
  return Promise.all(withThumbs.map((row) => withUploadedPage(row, blobs, orgId)));
}

// The row's page, page_thumb and pages (docs/architecture/cloud-sync.md#the-cards-page), from the card's own `page`
// (lib/card-page.ts). A page Weft can upload (a ~/.weft/show file, Weft's starter and update pages included) goes up as a
// blob and reads `blob:sha256:<hex>#anchor`, like an open_url item; a public site stays its URL; a page only this Mac can
// reach (localhost, a dev server, a file outside home) keeps its URL and points at the pane capture to draw instead.
// Run after withUploadedThumbs, so that capture is already a blob ref.
export async function withUploadedPage(row: CloudCardRow, blobs: BlobStore, orgId: string): Promise<CloudCardRow> {
  const raw = row.card.page?.trim();
  const pages = row.card.pages ?? 0;
  if (!raw) return { ...row, page: null, page_thumb: null, pages };
  const found = resolvePage(raw);
  const ref = found ? await (blobs.uploadPage ?? blobs.upload)(found.local, orgId) : null;
  const page = ref && found ? `${ref}${found.hash}` : raw;
  const site = paneFromUrl(page)?.kind;
  const page_thumb = site === "blob" || site === "site" ? null : (row.card.thumb ?? null);
  return { ...row, card: { ...row.card, page }, page, page_thumb, pages };
}

// The local file a thumb names: an attachment (by its board URL or its path in an attachments folder), or
// another file the blob store may upload (home only, never a secret). Web URLs and refs give null.
function thumbFile(thumb: string): string | null {
  const name = attachmentName(thumb);
  if (name) return attachmentFile(name);
  return resolveLocalPath(thumb);
}

// The rows with each local thumb swapped for its blob ref. A thumb whose file is gone goes up as it was.
export async function withUploadedThumbs(rows: CloudCardRow[], blobs: BlobStore, orgId: string): Promise<CloudCardRow[]> {
  return Promise.all(
    rows.map(async (row) => {
      const file = row.card.thumb ? thumbFile(row.card.thumb) : null;
      const ref = file ? await blobs.upload(file, orgId) : null;
      return ref ? { ...row, card: { ...row.card, thumb: ref } } : row;
    }),
  );
}
