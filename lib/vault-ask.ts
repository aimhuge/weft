"use client";

// weft://secrets?repo=owner/name&share=1 (docs/architecture/teams-vault.md, "Sharing from the team page"): the team
// page on weft.zip can't share a vault itself (the key and the values live only on a Mac), so its Share secrets opens
// the desktop app on the 🔐 drawer, filtered to that repo, with the share dialog up. Main sends the link to the board
// as the "open-secrets" menu action; this file carries it to the drawer, which may not be open or loaded yet.
import { useEffect, useSyncExternalStore } from "react";
import { openSecretsSettings } from "./secrets-settings";
import { REPO_PATTERN } from "./team-types";
import { repoOf } from "./vault-shared";
import type { VaultSummary } from "./vault-view";

export type VaultAsk = { repo: string; share: boolean };

// The menu payload ({ repo, share } as JSON) as an ask, or null for anything else.
export function parseVaultAsk(payload: string | undefined): VaultAsk | null {
  try {
    const raw = JSON.parse(payload ?? "") as { repo?: unknown; share?: unknown };
    const repo = typeof raw.repo === "string" ? raw.repo.trim().toLowerCase() : "";
    // A vault's repo is owner/name (lib/vault-shared.ts repoOf), and never a dot segment.
    return REPO_PATTERN.test(repo) && !repo.split("/").some((part) => /^\.+$/.test(part)) ? { repo, share: raw.share === true } : null;
  } catch {
    return null;
  }
}

// The link the team page's rows open in a plain browser.
export function secretsLink(repo: string, share: boolean): string {
  return `weft://secrets?repo=${encodeURIComponent(repo.toLowerCase())}${share ? "&share=1" : ""}`;
}

type Taker = (ask: VaultAsk) => boolean;
let pending: VaultAsk | null = null;
let taker: Taker | null = null;

// Opens the 🔐 drawer and hands it the ask, or keeps it until the drawer has its vaults.
export function askVault(openDrawer: (panel: "vault") => void, ask: VaultAsk | null) {
  if (!ask) return;
  openDrawer("vault");
  pending = taker?.(ask) ? null : ask;
}

// The repo whose Share… should open its dialog, until that section has taken it.
let shareAsk: string | null = null;
const listeners = new Set<() => void>();
function setShareAsk(repo: string | null) {
  shareAsk = repo;
  for (const l of listeners) l();
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

// The drawer's side: filter to the asked repo's vault and, for share=1, open Settings → Secrets on it with its Share…
// dialog up (sharing is managed there, components/VaultManage.tsx).
// False while the drawer has no vault for the repo yet, so the ask waits for the next overview.
export function useVaultAsk(vaults: VaultSummary[] | undefined, pickFolder: (folder: string) => void) {
  useEffect(() => {
    const take: Taker = (ask) => {
      const vault = vaults?.find((v) => repoOf(v.id) === ask.repo);
      if (!vault) return false;
      pickFolder(vault.folder);
      if (ask.share) {
        setShareAsk(ask.repo);
        openSecretsSettings(vault.id);
      }
      return true;
    };
    taker = take;
    if (pending && take(pending)) pending = null;
    return () => {
      if (taker === take) taker = null;
    };
  }, [vaults, pickFolder]);
}

// Settings → Secrets' side: true once, for the repo the link asked to share. Its ShareOffer opens on it
// (its effect runs before this one, child first), then the ask is cleared so a later render doesn't open it again.
export function useShareAsked(repo: string): boolean {
  const asked = useSyncExternalStore(
    subscribe,
    () => Boolean(repo) && shareAsk === repo,
    () => false,
  );
  useEffect(() => {
    if (asked) setShareAsk(null);
  }, [asked]);
  return asked;
}
