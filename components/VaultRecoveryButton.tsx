"use client";

import { useRouter } from "next/navigation";
import type { VaultSummary } from "@/lib/vault-view";
import Icon from "./Icon";

// The shared vault's recovery key, as a menu item (docs/architecture/teams-vault.md, "Recovery key").
//
// The words are shown on their own page, where they stay put while the user writes them down; the
// item here is the way there. It offers itself only for a vault that is shared with a workspace —
// a local vault has nothing to recover — and it says when the key was last shown, so the user can
// see whether they have done this before.
//
// The menu is the shell's own (window.weft.popupMenu), the same one the card and secret menus use:
// the item is a native menu entry, not a styled button, so it behaves like every other menu on the
// Mac.
export function VaultRecoveryButton({ vault }: { vault: VaultSummary | null }) {
  const shared = vault?.shared;
  const router = useRouter();
  if (!shared?.vaultId) return null;
  const org = shared.org;
  const url = `/${org.slug}/team/vaults/${shared.vaultId}/recovery`;

  const open = async () => {
    const shell = (window as { weft?: { popupMenu?: (items: unknown[]) => Promise<string | null> } }).weft;
    if (!shell?.popupMenu) return;
    const picked = await shell.popupMenu([
      { id: "recovery", label: "Show recovery key" },
      { type: "separator" },
      { id: "recovery-page", label: "Open the recovery page" },
    ]);
    if (picked === "recovery" || picked === "recovery-page") {
      // The page is the only place the words are shown: it asks the desktop for them, behind Touch
      // ID, and keeps them in the page and nowhere else.
      router.push(url);
    }
  };

  return (
    <div className="flex items-center gap-1.5 text-[11px] text-muted">
      <button
        type="button"
        onClick={() => void open()}
        title={shared.recoveryShownAt ? `Recovery key last shown ${shared.recoveryShownAt}` : "The words that open this vault when every machine is gone"}
        className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-sunken hover:text-ink"
      >
        <Icon name="lock" size={11} /> Show recovery key
      </button>
      {shared.recoveryShownAt ? <span className="text-faint">shown before</span> : <span className="text-faint">never shown</span>}
    </div>
  );
}
