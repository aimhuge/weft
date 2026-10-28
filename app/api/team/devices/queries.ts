// The server-side reads and writes behind the team's Devices page and its API routes
// (app/[orgSlug]/team/devices, app/api/team/devices). The page is a server component; the routes are
// the thin wrappers the client's forms post to.
//
// The device list crosses users — it shows every machine the team has registered, whoever owns it — so
// RLS alone can't scope it (`devices` has no org column, and `private.device_visible_to` only shows a
// device to its owner or to a member of an org that already granted it). The read therefore goes through
// the service client and scopes itself explicitly: the org's member ids go in, and only the devices
// owned by those ids come out.
//
// The service client stays on the server. Nothing here is ever handed to a client component: a device
// row carries a public key and a fingerprint, and a grant carries a wrapped key that never leaves
// Electron main.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DeviceRow, PendingGrantRow, PendingDeviceGrant, TeamDevice } from "@/lib/team-devices-view";
import { deviceView, pendingGrantView, sortDevices, sortPendingGrants } from "@/lib/team-devices-view";

// The columns the page renders. Named explicitly so a new column can't leak into the list by accident —
// `public_key` is here (the granter's Weft needs it to seal the vault key) and `wrapped_key` never is.
const DEVICE_COLUMNS = "id,user_id,name,public_key,fingerprint,platform,last_seen_at,revoked_at";
const GRANT_COLUMNS = "id,vault_id,granter_user_id,target_user_id,target_fingerprint,status,matched_device_id,created_at,expires_at";

// The user ids of an org's members. A device that belongs to nobody else is the only thing that may
// appear on the page.
export async function memberUserIds(service: SupabaseClient, orgId: string): Promise<string[]> {
  const { data } = await service.from("org_memberships").select("user_id").eq("org_id", orgId);
  return (data ?? []).map((m) => m.user_id as string);
}

// Every device in the org, newest-seen first, with the owner's name where we know it.
export async function listTeamDevices(service: SupabaseClient, orgId: string, viewerId: string | null): Promise<TeamDevice[]> {
  const userIds = await memberUserIds(service, orgId);
  if (userIds.length === 0) return [];
  // The recovery device has no user id, so it is not in the member list and never shows up here: it
  // belongs to the vault, not to a person, and the recovery page owns it.
  const { data } = await service.from("devices").select(DEVICE_COLUMNS).in("user_id", userIds);
  const rows = (data ?? []) as DeviceRow[];
  const profiles = await profileInfo(service, [...new Set(rows.map((r) => r.user_id).filter((id): id is string => Boolean(id)))]);
  return sortDevices(rows.map((row) => deviceView(row, profiles[row.user_id ?? ""]?.name ?? null)), viewerId);
}

// The pending grants of the org's vaults — the ones waiting for a TOFU check. A vault the org has isn't
// shared yet has no row here, so an admin who asks to add a device needs a vault first.
export async function listPendingGrants(service: SupabaseClient, orgId: string, viewerId: string | null): Promise<PendingDeviceGrant[]> {
  const { data: vaults } = await service.from("vaults").select("id,label").eq("org_id", orgId);
  const vaultIds = (vaults ?? []).map((v) => v.id as string);
  if (vaultIds.length === 0) return [];
  const { data } = await service.from("pending_device_grants").select(GRANT_COLUMNS).in("vault_id", vaultIds);
  const rows = (data ?? []) as PendingGrantRow[];
  const labels = new Map((vaults ?? []).map((v) => [v.id as string, v.label as string]));
  const users = [...new Set(rows.flatMap((r) => [r.granter_user_id, r.target_user_id]))];
  const profiles = await profileInfo(service, users);
  return sortPendingGrants(
    rows.map((row) => pendingGrantView(row, { vaultLabel: labels.get(row.vault_id) ?? "", granterName: profiles[row.granter_user_id]?.name ?? null, targetName: profiles[row.target_user_id]?.name ?? null })),
    viewerId,
  );
}

// The profile bits for a set of user ids: the name to show and the email to show under it. A missing
// row (a user who never filled one in, or left the workspace) simply has no profile — the caller falls
// back to the id.
type ProfileInfo = { name: string; email: string | null };

async function profileInfo(service: SupabaseClient, userIds: string[]): Promise<Record<string, ProfileInfo>> {
  if (userIds.length === 0) return {};
  const { data } = await service.from("profiles").select("id,display_name,name,email").in("id", userIds);
  const out: Record<string, ProfileInfo> = {};
  for (const p of (data ?? []) as { id: string; display_name?: string | null; name?: string | null; email?: string | null }[]) {
    out[p.id] = { name: p.display_name || p.name || p.email || p.id, email: p.email ?? null };
  }
  return out;
}

// The vault a grant belongs to, read back so the route can check the org and the admin role itself
// rather than trusting the request body.
export async function vaultOrgId(service: SupabaseClient, vaultId: string): Promise<string | null> {
  const { data } = await service.from("vaults").select("org_id").eq("id", vaultId).maybeSingle<{ org_id: string }>();
  return data?.org_id ?? null;
}

// The pending grant row, read back before anything is written to it.
export async function findPendingGrant(service: SupabaseClient, pendingId: string): Promise<PendingGrantRow | null> {
  const { data } = await service.from("pending_device_grants").select(GRANT_COLUMNS).eq("id", pendingId).maybeSingle<PendingGrantRow>();
  return data ?? null;
}

// The device row for an id. The accept route reads it to get the public key it hands back to the
// granter's Weft — from the database, never from the request body.
export async function findDevice(service: SupabaseClient, deviceId: string): Promise<DeviceRow | null> {
  const { data } = await service.from("devices").select(DEVICE_COLUMNS).eq("id", deviceId).maybeSingle<DeviceRow>();
  return data ?? null;
}

// The vault ids of an org, for the grant form's vault picker.
export async function listOrgVaults(service: SupabaseClient, orgId: string): Promise<{ id: string; label: string; repo: string }[]> {
  const { data }: { data: { id: string; label: string; repo: string }[] | null } = await service.from("vaults").select("id,label,repo").eq("org_id", orgId).order("label");
  return data ?? [];
}

// The workspace's members, for the grant form's "whose machine" picker. A grant to somebody outside the
// workspace would never be heard about, so the picker only offers people who are in it.
export async function listOrgMembersForGrant(service: SupabaseClient, orgId: string): Promise<{ id: string; name: string; email: string | null }[]> {
  const { data } = await service.from("org_memberships").select("user_id").eq("org_id", orgId).order("created_at");
  const rows = (data ?? []) as { user_id: string }[];
  const ids = rows.map((r) => r.user_id);
  const profiles = await profileInfo(service, ids);
  return rows.map((r) => ({ id: r.user_id, name: profiles[r.user_id]?.name ?? r.user_id, email: profiles[r.user_id]?.email ?? null }));
}
