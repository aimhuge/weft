"use client";

import { useState } from "react";
import type { VaultBridge, VaultSummary } from "@/lib/vault-view";
import { keyVersionTitle, shareTargets, type VaultOrg } from "@/lib/vault-shared";
import Icon from "./Icon";

// The shared vault's pieces of the 🔐 drawer (docs/architecture/teams-vault.md, "What the 🔐 drawer
// shows"): the badge on a shared vault's header and the offer to share a local one with a workspace.

export function SharedBadge({ vault }: { vault: VaultSummary }) {
  const shared = vault.shared;
  if (!shared) return null;
  return (
    <span
      title={keyVersionTitle(shared)}
      className="flex shrink-0 items-center gap-1 rounded bg-accent-soft px-1.5 py-0.5 text-[10px] leading-[15px] text-accent"
    >
      <Icon name="share" size={10} />
      <span className="max-w-[120px] truncate">{shared.org.name}</span>
      <span className="font-mono opacity-80">v{shared.keyVersion}</span>
    </span>
  );
}

// The banner at the top of a local vault: share it with a workspace. Only offered when the user is
// in a workspace with someone else in it — a team of one has nobody to share with (Q15).
export function ShareOffer({
  folder,
  org,
  orgs,
  bridge,
  label,
  repo,
  onShared,
  notify,
}: {
  // The project folder whose vault is shared.
  folder: string;
  // The workspace to share with, or null when there's none to offer.
  org: VaultOrg | null;
  // The other workspaces, for a picker when there's more than one.
  orgs?: VaultOrg[];
  // The vault's bridge, for the share call. Missing in an older shell: no offer.
  bridge: VaultBridge | null;
  // The vault's label and repo, for the server's row.
  label?: string;
  repo?: string;
  // Called once the vault is shared, so the drawer loads the new header.
  onShared: () => void;
  // Shows an error as a toast.
  notify: (err: unknown) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState(org?.id ?? "");
  const share = bridge?.share?.bind(bridge);
  if (!share || !org) return null;
  const choices = shareTargets(orgs ?? []);
  const chosen = choices.find((o) => o.id === picked) ?? org;

  const run = async () => {
    if (!repo) return;
    setBusy(true);
    try {
      await share(folder, chosen.id, repo, label);
      onShared();
    } catch (err) {
      notify(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-1.5 mt-1.5 flex items-center gap-1.5 rounded-md border border-accent/40 bg-accent-soft px-2 py-1.5 text-[11px] leading-snug text-accent">
      {choices.length > 1 ? (
        <select
          value={chosen.id}
          onChange={(e) => setPicked(e.target.value)}
          aria-label="Workspace to share with"
          className="min-w-0 flex-1 rounded border border-line-strong bg-card px-1 py-0.5 text-[11px] text-ink"
        >
          {choices.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      ) : (
        <span className="min-w-0 flex-1 truncate">Share this vault with {chosen.name}</span>
      )}
      <button
        type="button"
        onClick={() => void run()}
        disabled={busy || !repo}
        className="shrink-0 rounded-md bg-accent px-2 py-0.5 text-[11px] font-medium text-on-accent disabled:opacity-50"
      >
        Share
      </button>
    </div>
  );
}
