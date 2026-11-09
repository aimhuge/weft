// The words and the offer on a team project's row for its 🔐 vault (docs/architecture/teams-vault.md, "Sharing from
// the team page"): the chip ("Secrets shared · 2 devices", "Secrets on m5air only") and which button the row gets.
// Pure, so components/team/ProjectVault.tsx stays markup.
import type { TeamProjectVault, TeamVaultDevice } from "./team-types";
import type { VaultSummary } from "./vault-view";

export type VaultChip = { tone: "shared" | "local"; text: string; title: string };

// This Mac's own vault for the repo holds at least one value.
export const holdsValues = (here: VaultSummary | null | undefined) => Boolean(here?.secrets.some((s) => !s.missing));

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

// "m5air", "m5air and m1mini", "3 Macs".
export function macsText(names: string[]): string {
  if (names.length <= 2) return names.join(" and ");
  return plural(names.length, "Mac");
}

const listed = (devices: TeamVaultDevice[]) => devices.map((d) => `${d.name} (${d.person})`).join("\n");

// Shared beats local: once the workspace has the vault, where it started doesn't matter. This Mac's own copy counts
// before the server hears of it (a share that just finished, a beat not sent yet).
export function vaultChip(vault: TeamProjectVault | undefined, here: VaultSummary | null | undefined): VaultChip | null {
  const shared = vault?.shared;
  if (shared) {
    const n = shared.devices.length;
    return { tone: "shared", text: `Secrets shared · ${plural(n, "device")}`, title: n ? `Holding the key:\n${listed(shared.devices)}` : "Shared with this workspace" };
  }
  if (here?.shared) return { tone: "shared", text: "Secrets shared", title: "Shared with a workspace from this Mac" };
  if (holdsValues(here)) return { tone: "local", text: "Secrets on this Mac only", title: "Only this Mac has them. Share them to reach your other Macs and your team." };
  const on = vault?.localOn ?? [];
  if (!on.length) return null;
  return { tone: "local", text: `Secrets on ${macsText(on.map((d) => d.name))} only`, title: `Not shared yet. They're on:\n${listed(on)}` };
}

// What the row offers beside the chip.
// devices: the shared vault's Devices…. share: this Mac's own Share secrets (the drawer's dialog, through the bridge).
// link: a plain browser's Share secrets, a weft:// link to the desktop's drawer. elsewhere: the secrets are on another
// Mac, so the row says which one to press it on.
export type VaultOffer = { kind: "devices" } | { kind: "share" } | { kind: "link"; on: string } | { kind: "elsewhere"; on: string } | null;

export function vaultOffer({ vault, here, desktop, canShare }: { vault?: TeamProjectVault; here?: VaultSummary | null; desktop: boolean; canShare: boolean }): VaultOffer {
  if (vault?.shared) return { kind: "devices" };
  if (here?.shared || !canShare) return null;
  if (desktop && holdsValues(here)) return { kind: "share" };
  const on = macsText((vault?.localOn ?? []).map((d) => d.name));
  if (!desktop) return on ? { kind: "link", on } : null;
  return on ? { kind: "elsewhere", on } : null;
}

// "seen 5 min ago" for a device's last beat.
export function seenText(lastSeen: string | null, now = Date.now()): string {
  if (!lastSeen) return "";
  const min = Math.max(0, Math.round((now - Date.parse(lastSeen)) / 60_000));
  if (Number.isNaN(min)) return "";
  if (min < 2) return "seen just now";
  if (min < 60) return `seen ${min} min ago`;
  const hours = Math.round(min / 60);
  if (hours < 48) return `seen ${plural(hours, "hour")} ago`;
  return `seen ${plural(Math.round(hours / 24), "day")} ago`;
}
