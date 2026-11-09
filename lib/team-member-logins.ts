import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// Each member's GitHub login, read from Auth (`user_metadata.user_name`, set when they signed in with GitHub), so
// "People on your projects" can tell a collaborator is already on the team even when GitHub hides their email.
// One admin read per member, in parallel: teams are small and the team page isn't a hot path. Null when unknown.
export async function memberLogins(service: SupabaseClient, userIds: string[]): Promise<Map<string, string | null>> {
  const pairs = await Promise.all(userIds.map(async (id) => [id, await loginOf(service, id)] as const));
  return new Map(pairs);
}

async function loginOf(service: SupabaseClient, id: string): Promise<string | null> {
  try {
    const { data, error } = await service.auth.admin.getUserById(id);
    if (error) return null;
    const name: unknown = data.user.user_metadata.user_name;
    return typeof name === "string" && name.trim() ? name.trim() : null;
  } catch {
    return null;
  }
}
