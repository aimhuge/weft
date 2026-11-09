// Linking a repo to a team shares its 🔐 vault (docs/architecture/teams-vault.md, "A linked repo shares its vault").
// Settings → Teams → Projects' Add project links the repo on weft.zip, then asks this Mac's main to share its vault
// for the repo with the team (one Touch ID). The browser on weft.zip has no main and no vault, so there the link is
// all that happens; the vault is shared from the 🔐 drawer, or by the first teammate on a Mac that has one.
import { vaultBridge } from "./vault-view";
import type { RepoShareResult } from "./vault-shared";

// Shares this Mac's vault for a just-linked repo. null when there is no vault bridge to ask (the browser, an older shell).
export async function shareLinkedRepo(orgId: string, orgName: string, repo: string): Promise<RepoShareResult | { error: string } | null> {
  const bridge = vaultBridge();
  if (!bridge?.shareRepo) return null;
  try {
    return await bridge.shareRepo(orgId, orgName, repo);
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// The line Add project shows after a link: what happened to the repo's secrets.
export function linkNote(repo: string, team: string, vault: RepoShareResult | { error: string } | null): string {
  const linked = `Linked ${repo}.`;
  if (!vault) return `${linked} Its 🔐 secrets go to ${team} when someone on the team shares them from a Mac.`;
  if ("error" in vault) return `${linked} Its 🔐 secrets weren't shared: ${vault.error}`;
  if (vault.denied) return `${linked} Its 🔐 secrets stay on this Mac for now: share them from the 🔐 drawer.`;
  if (vault.skipped === "none") return `${linked} No 🔐 secrets for it on this Mac yet: once you add some, Share… in the 🔐 drawer offers ${team}.`;
  if (vault.skipped === "shared") return `${linked} Its 🔐 secrets are already shared.`;
  if (vault.skipped === "exists") return `${linked} ${team} already has its 🔐 secrets; this Mac asks to join them by itself.`;
  const n = vault.secrets ?? 0;
  const kept = vault.keptLocal?.length ? ` ${vault.keptLocal.join(", ")} stayed on this Mac (the team vault takes upper-case names).` : "";
  return `${linked} ${n} 🔐 secret${n === 1 ? "" : "s"} shared with ${team}; teammates' Macs you approve once get them.${kept}`;
}
