"use client";

import { openSecretsSettings } from "@/lib/secrets-settings";
import { vaultStatus } from "@/lib/vault-status";
import type { VaultSummary } from "@/lib/vault-view";

// The 🔐 drawer's one line under a vault's name: where it stands with the team, and its next step, which opens
// Settings → Secrets on this vault (lib/vault-status.ts).
export function VaultStatusLine({ vault }: { vault: VaultSummary }) {
  const status = vaultStatus(vault);
  if (!status) return null;
  return (
    <button
      type="button"
      onClick={() => openSecretsSettings(vault.id)}
      title="Open Settings → Secrets on this vault"
      className={`flex w-full items-center gap-1 px-1.5 pt-0.5 text-left text-[10.5px] leading-snug ${status.tone === "accent" ? "text-accent" : "text-faint"} hover:text-ink`}
    >
      <span className="min-w-0 truncate">{status.text}</span>
      {status.action ? <span className="shrink-0 font-medium underline decoration-current/40 underline-offset-2">{status.action}</span> : null}
    </button>
  );
}
