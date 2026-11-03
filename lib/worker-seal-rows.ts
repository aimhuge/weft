// The rows a Weft Worker publishes, sealed (docs/architecture/mobile-security.md#step-b-the-worker-seals-and-opens): what
// the worker_put_card / worker_put_items functions take, put through this flush's Sealer (lib/sync-seal-upload.ts) the
// way a Mac's outbox puts its rows through it. Types only, so lib/worker-publish.ts stays free of the store.
import type { CloudCardRow, CloudThreadItemRow } from "./cloud-sync-types";
import type { Sealer } from "./sync-seal-upload";
import type { Card } from "./types";
import type { ItemRow, OutputRow } from "./worker-registry";

// Why a worker that sealed before holds its rows and pages back.
export const HELD = "this worker sealed its threads before and holds no workspace key now, so it keeps them back until its grant is back (Settings → Devices → the worker → Seal…)";

// What the worker_put_* functions take, sealed with this flush's sealer (or as they are with none): the card's secret
// fields as card.sealed, each item whole, each long tool result as its envelope's JSON (lib/sync-seal.ts).
export function sealedCard(seal: Sealer | null, orgId: string, cardId: string, card: Card): Card {
  return seal ? seal.card({ org_id: orgId, card_id: cardId, card } as CloudCardRow).card : card;
}

export function sealedItems(seal: Sealer | null, orgId: string, cardId: string, items: ItemRow[], outputs: OutputRow[]): { items: ItemRow[]; outputs: OutputRow[] } {
  if (!seal) return { items, outputs };
  return {
    items: items.map((row) => ({ ...row, item: seal.item({ org_id: orgId, card_id: cardId, ...row } as CloudThreadItemRow).item })),
    outputs: outputs.map((row) => ({ ...row, result: seal.tool({ org_id: orgId, card_id: cardId, ...row }).result })),
  };
}
