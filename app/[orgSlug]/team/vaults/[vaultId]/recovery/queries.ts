// The one read the recovery page needs: which vault is this?
//
// The page asks for the vault by its server id and checks the org itself, so a vault from another
// workspace is a 404 rather than a page about somebody else's secrets. The service client stays on
// the server; the page hands its client component a label, a repo and an id — never a key.
import type { SupabaseClient } from "@supabase/supabase-js";

/** The vault as the recovery page sees it: a name, a repo, and the workspace it belongs to. */
export interface RecoveryVault {
  id: string;
  orgId: string;
  label: string;
  repo: string;
}

/**
 * The vault with that id, or null when there is none.
 *
 * The columns are named: `org_id` is here because the page checks it, and nothing about a vault's
 * contents is.
 */
export async function recoveryVault(service: SupabaseClient, vaultId: string): Promise<RecoveryVault | null> {
  const { data } = await service.from("vaults").select("id,org_id,label,repo").eq("id", vaultId).maybeSingle<{
    id: string;
    org_id: string;
    label: string;
    repo: string;
  }>();
  if (!data) return null;
  return { id: data.id, orgId: data.org_id, label: data.label, repo: data.repo };
}
