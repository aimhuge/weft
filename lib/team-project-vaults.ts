// Each team project's 🔐 vault as the team page shows it (docs/architecture/teams-vault.md, "Sharing from the team
// page"): shared to the workspace and which Macs hold its key, the asks waiting on an admin, or which members' Macs
// keep an unshared vault for the repo. Metadata only: names, fingerprints, last seen. The wrapped keys and the
// ciphertext stay in their tables; nothing here selects them.
//
// Read through the service client, like the rest of the snapshot, because the rows cross users (a teammate's Mac).
// A read that fails leaves the projects without `vault`, and the page shows no chip rather than a wrong one.
import "server-only";
import { roleCan } from "@aimhuge/teams";
import type { TeamContext } from "./teams";
import type { TeamMember, TeamProject, TeamProjectVault, TeamVaultAsk, TeamVaultDevice } from "./team-types";

type DeviceRow = { id?: string; name: string; user_id: string | null; fingerprint?: string; last_seen_at: string | null; revoked_at?: string | null };
type VaultRow = { id: string; repo: string; current_key_version: number };
type GrantRow = { vault_id: string; key_version: number; device: DeviceRow | null };
type AskRow = { id: string; vault_id: string; target_user_id: string; device: DeviceRow | null };
type LocalRow = { name: string; user_id: string; last_seen_at: string | null; local_vaults: string[] };

export type VaultRows = { vaults: VaultRow[]; grants: GrantRow[]; asks: AskRow[]; local: LocalRow[] };

// "Weft on Alex's m5air" reads as "Alex's m5air" in a chip.
export const deviceLabel = (name: string) => name.replace(/^Weft on /, "");

function personOf(members: TeamMember[], userId: string | null) {
  const m = members.find((x) => x.userId === userId);
  return m?.name || m?.email || "A teammate";
}

const deviceOf = (members: TeamMember[], d: { name: string; user_id: string | null; last_seen_at: string | null }): TeamVaultDevice => ({
  name: deviceLabel(d.name),
  person: personOf(members, d.user_id),
  lastSeen: d.last_seen_at,
});

// The Macs holding the vault's current key: one per device, not the recovery key, not a revoked one.
function holders(vault: VaultRow, grants: GrantRow[], members: TeamMember[]): { ids: Set<string>; devices: TeamVaultDevice[] } {
  const seen = new Map<string, TeamVaultDevice>();
  for (const g of grants) {
    const d = g.device;
    if (g.vault_id !== vault.id || g.key_version !== vault.current_key_version || !d || d.revoked_at || !d.user_id || d.fingerprint === "recovery") continue;
    seen.set(d.id ?? d.name, deviceOf(members, d));
  }
  return { ids: new Set(seen.keys()), devices: [...seen.values()] };
}

// The rows, put together per project. Pure, so it's tested without a database.
export function projectVaults(projects: TeamProject[], rows: VaultRows, members: TeamMember[]): TeamProject[] {
  return projects.map((p) => {
    const repo = p.repo.toLowerCase();
    const vault = rows.vaults.find((v) => v.repo.toLowerCase() === repo);
    const localOn = rows.local.filter((d) => d.local_vaults.some((r) => r.toLowerCase() === repo)).map((d) => deviceOf(members, d));
    if (!vault) return { ...p, vault: { shared: null, localOn } satisfies TeamProjectVault };
    const held = holders(vault, rows.grants, members);
    const asks: TeamVaultAsk[] = rows.asks.flatMap(({ id, vault_id, target_user_id, device: d }) =>
      vault_id === vault.id && d && !d.revoked_at && !held.ids.has(d.id ?? "")
        ? [{ id, person: personOf(members, target_user_id), deviceName: deviceLabel(d.name), fingerprint: d.fingerprint ?? "" }]
        : [],
    );
    return { ...p, vault: { shared: { vaultId: vault.id, keyVersion: vault.current_key_version, devices: held.devices, asks }, localOn } };
  });
}

// A read's rows, or none when it answered no list (an error, a null).
const rowsOf = <T>(data: unknown): T[] => (Array.isArray(data) ? (data as T[]) : []);

// The four reads. Asks only for those who manage the team: approving is an admin's, and the person asking is who
// sees their own wait in the 🔐 drawer.
async function readRows(ctx: TeamContext, repos: string[], members: TeamMember[]): Promise<VaultRows> {
  const memberIds = members.map((m) => m.userId);
  const [{ data: vaults, error }, { data: local }] = await Promise.all([
    ctx.service.from("vaults").select("id, repo, current_key_version").eq("org_id", ctx.org.id).in("repo", repos),
    // A database without devices.local_vaults yet answers an error, and no Mac is named.
    ctx.service.from("devices").select("name, user_id, last_seen_at, local_vaults").in("user_id", memberIds).is("revoked_at", null).overlaps("local_vaults", repos),
  ]);
  if (error) throw new Error(error.message);
  const ids = rowsOf<VaultRow>(vaults).map((v) => v.id);
  const none = Promise.resolve({ data: [] as unknown[] });
  const [{ data: grants }, { data: asks }] = await Promise.all([
    ids.length ? ctx.service.from("vault_grants").select("vault_id, key_version, device:devices(id, name, user_id, fingerprint, last_seen_at, revoked_at)").in("vault_id", ids) : none,
    ids.length && roleCan(ctx.role, "members.manage")
      ? ctx.service
          .from("pending_device_grants")
          .select("id, vault_id, target_user_id, device:devices(id, name, fingerprint, revoked_at)")
          .in("vault_id", ids)
          .eq("status", "accepted")
          .gt("expires_at", new Date().toISOString())
      : none,
  ]);
  return {
    vaults: rowsOf<VaultRow>(vaults),
    grants: rowsOf<GrantRow>(grants),
    asks: rowsOf<AskRow>(asks),
    local: rowsOf<LocalRow>(local),
  };
}

// The projects with their vaults, or as they came when the reads fail.
export async function withProjectVaults(ctx: TeamContext, projects: TeamProject[], members: TeamMember[]): Promise<TeamProject[]> {
  if (!projects.length) return projects;
  try {
    const repos = [...new Set(projects.map((p) => p.repo.toLowerCase()))];
    return projectVaults(projects, await readRows(ctx, repos, members), members);
  } catch {
    return projects;
  }
}
