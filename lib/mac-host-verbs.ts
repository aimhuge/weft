// Asking another of your Macs for its uncommitted work (docs/architecture/wip-sync.md#mac-to-mac): a `host` row addressed
// to that Mac's device id, carrying tree.snapshot and the approval this Mac's main signed after Touch ID. The row names
// the project by its folder's name, since the path there is that Mac's own; it answers only if it paired with this Mac
// and switched that project on in Settings → Sync (lib/mac-snapshot.ts).
import type { SupabaseClient } from "@supabase/supabase-js";
import { hostLevelRow } from "@weft/client";
import { accountClient } from "./account";
import { syncOrgId } from "./cloud-sync";
import { orgForFolder } from "./cloud-sync-route";
import { listDevices } from "./device-registry";
import type { MacSource } from "./mac-host-verbs-source";

export { macSource, parseMacSource, type MacSource } from "./mac-host-verbs-source";

export async function sendMacSnapshot(source: MacSource, root: string, args: Record<string, unknown>, client: SupabaseClient = accountClient()): Promise<{ commandId: string }> {
  const { data } = await client.auth.getSession();
  const uid = data.session?.user.id;
  const home = uid ? await syncOrgId(client, uid) : null;
  if (!home) throw new Error("Sign in to Weft to reach your other Mac.");
  const mac = (await listDevices(client)).devices.find((d) => d.kind === "mac" && d.host === source.device);
  if (!mac || mac.here || mac.revokedAt) throw new Error("That isn't one of your other Macs.");
  // The workspace this project's cards sync to, which the other Mac checks against its own copy's.
  const orgId = await orgForFolder(client, home, root);
  const row = { ...hostLevelRow({ orgId, device: source.device }, "tree.snapshot", { ...args, folder: source.folder }), folder: source.folder };
  const { data: made, error } = await client.from("cloud_commands").insert(row).select("id").single<{ id: string }>();
  if (error) throw new Error(`Couldn't reach your other Mac: ${error.message}`);
  return { commandId: made.id };
}
