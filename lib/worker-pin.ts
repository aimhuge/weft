// Sending a Mac's passkey endorsements to one of its workers (docs/architecture/project-hosts.md#signed-widening-as-built):
// main signs them after Touch ID (electron/widen-sign.cjs `approval:endorse`), this Mac's server inserts them as a
// `pin` command, and the worker pins each passkey only once its signature checks out against the Mac key it took
// from the pairing code (lib/host-signers.ts). The row itself is trusted for nothing.
import type { SupabaseClient } from "@supabase/supabase-js";
import { accountClient } from "./account";
import { myWorkers, requireSession } from "./worker-board";
import { workerDevice } from "./worker-commands";

export interface PinAction {
  action: "pin";
  workerId: string;
  endorsements: unknown[];
}

export async function pinWorkerPasskeys(body: PinAction, client: SupabaseClient = accountClient()): Promise<{ commandId: string }> {
  if (!Array.isArray(body.endorsements) || !body.endorsements.length || body.endorsements.length > 20) throw new Error("There are no passkeys to send.");
  const who = await requireSession(client);
  if (!(await myWorkers(client, who)).some((w) => w.id === body.workerId)) throw new Error("That worker isn't one of yours.");
  const row = { org_id: who.org, kind: "pin", target_device: workerDevice(body.workerId), folder: "-", payload: { endorsements: body.endorsements } };
  const { data, error } = await client.from("cloud_commands").insert(row).select("id").single<{ id: string }>();
  if (error) throw new Error(`Couldn't reach your worker: ${error.message}`);
  return { commandId: data.id };
}
