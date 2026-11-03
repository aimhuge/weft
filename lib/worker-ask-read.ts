// What Electron main reads before it signs an Allow on a worker card (electron/approval-sign.cjs, "The desktop signs
// too" in docs/architecture/mobile-security.md): the card's row as the worker published it, read fresh with the
// account's session on this Mac's server (GET /api/worker-board?ask=<card>), never anything the board window says.
// Main words Touch ID from it and signs over its workspace and `worker:<id>`, the names the worker rebuilds the message
// from (lib/worker-approve.ts). Only a card one of your workers owns; null otherwise.
import type { SupabaseClient } from "@supabase/supabase-js";
import { accountClient } from "./account";
import type { Card, PendingPermission } from "./types";
import { requireSession } from "./worker-board";
import { workerDevice } from "./worker-commands";

export interface WorkerAsk {
  orgId: string;
  // `worker:<id>`, as worker_put_card writes owner_device.
  device: string;
  workerId: string;
  card: { id: string; title: string; pending: PendingPermission | null };
}

interface AskRow {
  org_id: string;
  owner_device: string;
  owner_worker: string | null;
  owner_user: string;
  card: Card;
  deleted?: boolean;
}

export async function readWorkerAsk(cardId: string, client: SupabaseClient = accountClient()): Promise<WorkerAsk | null> {
  const who = await requireSession(client);
  const { data } = await client
    .from("cloud_cards")
    .select("org_id, owner_device, owner_worker, owner_user, card, deleted")
    .eq("org_id", who.org)
    .eq("card_id", cardId)
    .maybeSingle<AskRow>();
  if (!data?.owner_worker || data.owner_user !== who.uid || data.deleted) return null;
  // A row whose device isn't its worker's names a host the worker won't rebuild the message with.
  if (data.owner_device !== workerDevice(data.owner_worker)) return null;
  return { orgId: data.org_id, device: data.owner_device, workerId: data.owner_worker, card: { id: cardId, title: data.card.title, pending: data.card.pending ?? null } };
}
