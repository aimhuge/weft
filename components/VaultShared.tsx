"use client";

import { useState } from "react";
import type { VaultBridge, VaultSummary } from "@/lib/vault-view";
import { keyVersionTitle, shareTargets, type VaultDeviceRequest, type VaultJoin, type VaultOrg } from "@/lib/vault-shared";
import Icon from "./Icon";
import { VaultShareDialog } from "./VaultShareDialog";

// The shared vault's pieces of the 🔐 drawer (docs/architecture/teams-vault.md, "What the 🔐 drawer
// shows"): the badge on a shared vault's header and the Share… that offers a local one to a workspace.

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

// Share… in a local vault's header, beside Add and Import…: it opens a dialog that says what sharing
// hands over before it shares. Only offered when the user is in a workspace with someone else in it —
// a team of one has nobody to share with (Q15).
export function ShareOffer({
  folder,
  org,
  orgs,
  bridge,
  label,
  repo,
  secrets = 0,
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
  // How many secrets the vault holds, for the dialog.
  secrets?: number;
  // Called once the vault is shared, so the drawer loads the new header.
  onShared: () => void;
  // Shows an error as a toast.
  notify: (err: unknown) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState(org?.id ?? "");
  const share = bridge?.share?.bind(bridge);
  if (!share || !org) return null;
  const choices = shareTargets(orgs ?? [], repo);
  const chosen = choices.find((o) => o.id === picked) ?? org;

  const run = async () => {
    if (!repo) return;
    setBusy(true);
    try {
      const { keptLocal } = await share(folder, chosen.id, repo, label);
      setOpen(false);
      onShared();
      if (keptLocal?.length) notify(new Error(`Shared. ${keptLocal.join(", ")} stayed on this Mac: the team vault only takes upper-case names.`));
    } catch (err) {
      notify(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={!repo}
        title={`Share this vault with ${chosen.name}`}
        className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-sunken hover:text-ink disabled:opacity-50"
      >
        <Icon name="share" size={11} /> Share…
      </button>
      {open && (
        <VaultShareDialog
          label={label}
          secrets={secrets}
          choices={choices}
          chosen={chosen}
          onPick={setPicked}
          busy={busy}
          onShare={() => void run()}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

const BANNER = "mx-1.5 mt-1.5 flex flex-col gap-1 rounded-md border border-accent/40 bg-accent-soft px-2 py-1.5 text-[11px] leading-snug text-accent";
const ACT = "shrink-0 rounded-md bg-accent px-2 py-0.5 text-[11px] font-medium text-on-accent disabled:opacity-50";

// Runs one banner action: busy while it goes, the drawer reloaded after, a failure as a toast.
function useBannerAction(onDone: () => void, notify: (err: unknown) => void) {
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
      onDone();
    } catch (err) {
      notify(err);
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

// The workspace already shares this repo and this Mac isn't in it: ask, wait, open.
export function JoinOffer({ folder, join, bridge, onDone, notify }: { folder: string; join: VaultJoin; bridge: VaultBridge | null; onDone: () => void; notify: (err: unknown) => void }) {
  const { busy, run } = useBannerAction(onDone, notify);
  const requestJoin = bridge?.requestJoin?.bind(bridge);
  const open = bridge?.join?.bind(bridge);
  if (!requestJoin || !open) return null;
  if (join.state === "asked") {
    return (
      <div className={BANNER}>
        <span>Waiting for an admin. Read them this Mac&apos;s fingerprint:</span>
        <code className="font-mono text-[10px] break-all">{join.fingerprint}</code>
      </div>
    );
  }
  const granted = join.state === "granted";
  return (
    <div className={BANNER}>
      <div className="flex items-center gap-1.5">
        <span className="min-w-0 flex-1">{granted ? "An admin approved this Mac." : "Your team shares this vault. This Mac isn't in it yet."}</span>
        <button type="button" disabled={busy} className={ACT} onClick={() => void run(() => (granted ? open(folder, join) : requestJoin(join.vaultId)))}>
          {granted ? "Open shared vault" : "Ask to join"}
        </button>
      </div>
    </div>
  );
}

// The Macs waiting on this vault. One device gets every key, so the banner says so before Approve.
export function DeviceRequests({ requests, bridge, onDone, notify }: { requests: VaultDeviceRequest[]; bridge: VaultBridge | null; onDone: () => void; notify: (err: unknown) => void }) {
  const { busy, run } = useBannerAction(onDone, notify);
  const deviceGrant = bridge?.deviceGrant?.bind(bridge);
  const deviceDecline = bridge?.deviceDecline?.bind(bridge);
  if (!deviceGrant || !deviceDecline) return null;
  return (
    <>
      {requests.map((r) => (
        <div key={r.id} className={BANNER}>
          <span>
            {r.person} asks to add {r.deviceName}. Approving gives it every key in this vault, production too.
          </span>
          <code className="font-mono text-[10px] break-all">{r.fingerprint}</code>
          <div className="flex items-center justify-end gap-1.5">
            <button type="button" disabled={busy} className="shrink-0 px-1 text-[11px] disabled:opacity-50" onClick={() => void run(() => deviceDecline(r.id))}>
              Decline
            </button>
            <button type="button" disabled={busy} className={ACT} onClick={() => void run(() => deviceGrant(r.id))}>
              Approve
            </button>
          </div>
        </div>
      ))}
    </>
  );
}
