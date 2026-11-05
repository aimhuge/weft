// The cloud_cards rows a Mac's flush uploads (lib/cloud-sync.ts): each card's projection (lib/card-rows.ts, thumbs
// and pages up as blobs, redacted, scrubbed) under this Mac's identity. The flush seals them, if sealing is on.
import { withBlobSeal } from "./blob-seal";
import { projectCard, publishes, type RowHost } from "./card-rows";
import type { BlobSeal, BlobStore, CloudCardRow, OutboxEntry } from "./cloud-sync-types";
import { deviceId } from "./device-id";
import { githubRepoOf } from "./repos";
import { getCard } from "./store";
import type { Card } from "./types";

// A Mac's choices where the hosts differ (lib/card-rows.ts): thumbs from its pane, a failed upload fails the flush
// (which backs off and keeps the entries), and the copilot syncs like any card in a synced folder.
export const macRowHost = (orgId: string, blobs: BlobStore): RowHost => ({ orgId, blobs, thumbs: true, copilot: true });

// Every live card the batch touches, not just those with a card entry: a card that changed before its folder
// was opted in still needs its row before its items can reference it. `sealFor` names the card's blob seal (the flush's
// Sealer.blob), so its thumb and pages go up sealed when its row does.
export async function cardRows(blobs: BlobStore, orgId: string, pending: OutboxEntry[], at: number, sealFor: (cardId: string) => BlobSeal | null = () => null): Promise<CloudCardRow[]> {
  const ids = new Set(pending.filter((e) => e.op !== "card_deleted").map((e) => e.cardId));
  const host = macRowHost(orgId, blobs);
  const live = [...ids].map((id) => getCard(id)).filter((card): card is Card => card !== undefined && publishes(card, host));
  return Promise.all(
    live.map(async (card) => ({
      org_id: orgId,
      card_id: card.id,
      owner_device: deviceId(),
      folder: card.cwd,
      // The repo, so a teammate's board files the card under its own checkout (lib/team-board.ts).
      repo: githubRepoOf(card.cwd)?.toLowerCase() ?? null,
      deleted: false,
      updated_at: new Date(at).toISOString(),
      ...(await projectCard(card, macRowHost(orgId, withBlobSeal(blobs, sealFor(card.id))))),
    })),
  );
}
