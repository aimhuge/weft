"use client";

import { useState } from "react";
import { openSecretsSettings } from "@/lib/secrets-settings";
import { pushedText, vaultStatus } from "@/lib/vault-status";
import { vaultBridge, type VaultSummary } from "@/lib/vault-view";

// The 🔐 drawer's one line under a vault's name: where it stands with the team, and its next step, which opens
// Settings → Secrets on this vault (lib/vault-status.ts). Push (values on this Mac only) runs in place: one Touch ID in
// main names them, and the drawer reloads on the vault's change event.
export function VaultStatusLine({ vault, notify = () => undefined }: { vault: VaultSummary; notify?: (err: unknown) => void }) {
  const [busy, setBusy] = useState(false);
  const status = vaultStatus(vault);
  if (!status) return null;
  const bridge = vaultBridge();
  const pushLocal = bridge?.pushLocal?.bind(bridge);
  const push = status.push && pushLocal;
  const onClick = async () => {
    if (!push) {
      openSecretsSettings(vault.id);
      return;
    }
    setBusy(true);
    try {
      const text = pushedText(await push(vault.folder));
      if (text) notify(new Error(text));
    } catch (err) {
      notify(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => void onClick()}
      title={push ? "Share the values only this Mac has with your team (Touch ID names them first)" : "Open Settings → Secrets on this vault"}
      className={`flex w-full items-center gap-1 px-1.5 pt-0.5 text-left text-[10.5px] leading-snug ${status.tone === "accent" ? "text-accent" : "text-faint"} hover:text-ink disabled:opacity-60`}
    >
      <span className="min-w-0 truncate">{status.text}</span>
      {status.action && (!status.push || push) ? <span className="shrink-0 font-medium underline decoration-current/40 underline-offset-2">{busy ? "Pushing…" : status.action}</span> : null}
    </button>
  );
}
