// Card thumbnails on the weft.zip board. The outbox uploads a card's pane capture as a blob and puts its
// ref in the row's `card.thumb` (lib/card-rows-blobs.ts); the board resolves those refs to signed URLs
// alongside the thread's (lib/web-board.ts), and CardView draws the URL like any other thumb.
import { isBlobRef, type CloudCardRow } from "./cloud-sync-types";

// Every thumb ref the cards name, deduped and sorted so the list is stable across renders.
export function cardThumbRefs(rows: readonly CloudCardRow[]): string[] {
  const refs = new Set<string>();
  for (const row of rows) if (row.card.thumb && isBlobRef(row.card.thumb)) refs.add(row.card.thumb);
  return [...refs].sort();
}

// The rows with each thumb ref swapped for its signed URL. A ref with no URL yet stays a ref, which
// CardPicture can't load and so hides; rows with nothing to swap come back as they were.
export function withThumbUrls(rows: CloudCardRow[], urls: Record<string, string>): CloudCardRow[] {
  return rows.map((row) => {
    const url = row.card.thumb ? urls[row.card.thumb] : undefined;
    return url ? { ...row, card: { ...row.card, thumb: url } } : row;
  });
}
