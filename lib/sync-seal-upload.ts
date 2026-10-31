// The uploader's sealing hook (docs/architecture/mobile-security.md, "Sealing"): when Settings → Sync's Seal switch
// (kept in main, lib/sync-security.ts) is on and main holds the workspace key (POST /sync/key), rows go up sealed;
// otherwise as they were. A card with a share link stays plain, since /s/… reads it on the server with no key. The key
// is asked for once a minute.
import { shell } from "./browser-shell";
import type { CloudCardRow, CloudThreadItemRow, CloudToolOutputRow } from "./cloud-sync-types";
import { globalSingleton } from "./global-singleton";
import { sodium, type Sodium } from "./sodium";
import { pairingStatus } from "./sync-security";
import { sealCardRow, sealItemRow, sealToolRow, type SyncKey } from "./sync-seal";
import { getCard } from "./store";

const KEY_TTL_MS = 60_000;

export interface Sealer {
  card(row: CloudCardRow): CloudCardRow;
  item(row: CloudThreadItemRow): CloudThreadItemRow;
  tool(row: CloudToolOutputRow): CloudToolOutputRow;
}

const cache = () => globalSingleton("__weftSyncKey", () => new Map<string, { key: SyncKey | null; at: number }>());

async function keyFor(orgId: string, now: number): Promise<SyncKey | null> {
  const hit = cache().get(orgId);
  if (hit && now - hit.at < KEY_TTL_MS) return hit.key;
  let key: SyncKey | null = null;
  try {
    const r = await shell("/sync/key", { orgId, create: true });
    key = typeof r.version === "number" && typeof r.key === "string" ? { version: r.version, key: r.key } : null;
  } catch {
    // No desktop shell, signed out in main, or offline: upload plain this time.
  }
  cache().set(orgId, { key, at: now });
  return key;
}

// A card a share link shows stays plain, and so do its items.
const shared = (cardId: string) => Boolean(getCard(cardId)?.share?.id);

export function makeSealer(s: Sodium, key: SyncKey, isShared: (cardId: string) => boolean = shared): Sealer {
  return {
    card: (row) => (isShared(row.card_id) ? row : sealCardRow(s, row, key)),
    item: (row) => (isShared(row.card_id) ? row : sealItemRow(s, row, key)),
    tool: (row) => (isShared(row.card_id) ? row : sealToolRow(s, row, key)),
  };
}

// The sealer for this flush, or null when rows go up plain.
export async function sealerFor(orgId: string, now = Date.now()): Promise<Sealer | null> {
  if (!(await pairingStatus()).seal) return null;
  const key = await keyFor(orgId, now);
  return key ? makeSealer(await sodium(), key) : null;
}

export const forgetSyncKey = () => cache().clear();
