// The shared vault's types and the words the 🔐 drawer shows for one
// (docs/architecture/teams-vault.md, "What the 🔐 drawer shows"). The vault itself lives in
// lib/vault-view.ts; these types live here so the drawer's parts (components/VaultParts.tsx) and
// the IPC contract can name them without growing that file past the cap.
//
// Everything here is metadata: an org's id, slug and name, the vault key's version, the server
// version the shadow is at, and when the recovery key was last shown. No key material, no
// ciphertext, no wrapped key.

export interface VaultOrg {
  id: string;
  slug: string;
  name: string;
  // How many people are in the workspace. A team of one doesn't need to share with itself (Q15).
  members: number;
}

// What a shared vault's header shows. `org` is the workspace the vault belongs to; the local id
// is replaced by the shared one in the header.
export interface VaultShared {
  org: { id: string; slug: string; name: string };
  // The server's id for this vault — the one the team's pages and the recovery key's page use.
  vaultId: string;
  // The vault key's version. It goes up when the key is rotated (card 9).
  keyVersion: number;
  // The server version the local shadow is at. It changes when a teammate writes.
  serverVersion: number;
  // When the recovery key was last shown (card 10), or null while it hasn't been.
  recoveryShownAt: string | null;
}

// The workspaces the user can share a local vault with: the ones they're in that have someone
// else in them. A personal workspace (a team of one) stays local — there's nobody to share with.
export function shareTargets(orgs: VaultOrg[]): VaultOrg[] {
  return orgs.filter((o) => o.members > 1);
}

// The badge's tooltip: which key version the vault is on, and when it was bumped.
export function keyVersionTitle(shared: VaultShared, bumpedBy?: string | null, bumpedAt?: string | null): string {
  const parts = [`vault key version ${shared.keyVersion}`];
  if (bumpedAt) parts.push(`bumped on ${bumpedAt}`);
  if (bumpedBy) parts.push(`by ${bumpedBy}`);
  return parts.join(" — ");
}

// The header's name for a shared vault: the workspace's name, then the repo.
export function sharedTitle(shared: VaultShared, repo: string): string {
  return `${shared.org.name} · ${repo}`;
}

// The GitHub repo a vault belongs to: "owner/name" out of the vault's id ("github:owner/name").
// A vault with no GitHub remote (a plain folder) has no repo, and can't be shared.
export function repoOf(vaultId: string): string {
  const id = vaultId.startsWith("github:") ? vaultId.slice("github:".length) : "";
  return /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/.test(id) ? id : "";
}
