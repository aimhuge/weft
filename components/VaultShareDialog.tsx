"use client";

import { useState } from "react";
import type { VaultOrg } from "@/lib/vault-shared";
import Modal from "./Modal";

// The dialog behind the vault header's Share…: sharing hands every secret in the vault to every member
// of a workspace, so it says what that means before it does it (docs/architecture/teams-vault.md), and
// the Share button waits for the user to tick that they understand.
export function VaultShareDialog({
  label,
  secrets,
  choices,
  chosen,
  onPick,
  busy,
  onShare,
  onClose,
}: {
  // The vault's name, e.g. "aimhuge/weft".
  label?: string;
  // How many secrets the vault holds today.
  secrets: number;
  // The workspaces it can go to; a picker shows when there's more than one.
  choices: VaultOrg[];
  chosen: VaultOrg;
  onPick: (id: string) => void;
  busy: boolean;
  onShare: () => void;
  onClose: () => void;
}) {
  const [understood, setUnderstood] = useState(false);
  const people = chosen.members === 1 ? "1 person" : `${chosen.members} people`;
  const count = secrets === 1 ? "1 secret" : `${secrets} secrets`;
  return (
    <Modal title="Share this vault?" onClose={onClose} className="w-full max-w-[440px]">
      <div className="space-y-3 px-5 py-4 text-[12.5px] leading-relaxed text-ink">
        {choices.length > 1 ? (
          <label className="flex items-center gap-2">
            <span className="shrink-0 text-muted">Share with</span>
            <select
              value={chosen.id}
              onChange={(e) => onPick(e.target.value)}
              aria-label="Workspace to share with"
              className="min-w-0 flex-1 rounded border border-line-strong bg-card px-1.5 py-1 text-[12px] text-ink"
            >
              {choices.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <p>
          You&apos;re about to give <b>everyone in {chosen.name}</b> ({people}) the {count} in{" "}
          <span className="font-mono">{label ?? "this vault"}</span>, and every secret added to it later.
        </p>
        <ul className="list-disc space-y-1.5 pl-4 text-muted">
          <li>
            <b className="text-ink">They can see and use every value</b>, in every environment, production included, on each of their
            devices, and change or delete them. Their agents can use them too, after their own Touch ID.
          </li>
          <li>
            <b className="text-ink">It&apos;s end-to-end encrypted.</b> Weft&apos;s servers keep only ciphertext; the key is sealed to each
            member&apos;s device, and Weft never holds it.
          </li>
          <li>
            <b className="text-ink">It can&apos;t be taken back.</b> Removing someone later rotates the vault key so they can&apos;t read new
            values, but whatever they already saw stays seen: rotate those keys at the provider.
          </li>
        </ul>
        <label className="flex items-start gap-2 rounded-md border border-line bg-sunken px-2.5 py-2">
          <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} className="mt-0.5" />
          <span>I understand everyone in {chosen.name} can read these secrets.</span>
        </label>
      </div>
      <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
        <button type="button" onClick={onClose} className="rounded-md px-3 py-1 text-[12px] text-muted hover:bg-sunken hover:text-ink">
          Cancel
        </button>
        <button
          type="button"
          onClick={onShare}
          disabled={!understood || busy}
          className="rounded-md bg-accent px-3 py-1 text-[12px] font-medium text-on-accent disabled:opacity-50"
        >
          {busy ? "Sharing…" : `Share with ${chosen.name}`}
        </button>
      </div>
    </Modal>
  );
}
