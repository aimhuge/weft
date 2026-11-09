// The share gate's second door (docs/architecture/sharing.md#people): a person the card's owner named by GitHub
// account (public.cloud_share_grants) gets in once signed in to weft.zip with that account, whatever the link's mode:
// a private link as if they were in the workspace, a password or email link with no gate. One service-role RPC
// (share_grant_admits) matches the visitor's GitHub identity to the grants and stamps opened_at the first time.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { WebUser } from "./web-session";

// Whether the gate's refusal can be answered by a grant: a private link's "sign in" / "not a member", or a password
// or email form. Missing and unconfigured stay what they are.
export function grantCanAnswer(kind: string): boolean {
  return kind === "login" || kind === "denied" || kind === "gate";
}

// True when the signed-in visitor's GitHub identity is granted on this share. Fails closed on any error.
export async function grantAdmits(service: SupabaseClient | null, shareId: string, user: WebUser | null): Promise<boolean> {
  if (!service || !user) return false;
  const { data, error } = (await service.rpc("share_grant_admits", { share: shareId, uid: user.id })) as { data: unknown; error: { message: string } | null };
  if (error) {
    console.error(`share-grant-gate: ${error.message}`);
    return false;
  }
  return data === true;
}
