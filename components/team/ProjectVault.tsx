"use client";

// A team project's 🔐 vault on its row (docs/architecture/teams-vault.md, "Sharing from the team page"): the chip
// (shared and to how many devices, or which Mac has the secrets) and the one offer that fits. Sharing and approving
// need the vault key, which lives only on a Mac, so this never touches a value or a key: on the desktop's own board it
// runs the 🔐 drawer's own ShareOffer and Approve through main's bridge; in a plain browser it opens the desktop app
// on the drawer (lib/vault-ask.ts), or says which Mac to press it on.
import { useState } from "react";
import type { TeamProjectVault, TeamVaultAsk } from "@/lib/team-types";
import { macsText, seenText, vaultChip, vaultOffer, type VaultOffer } from "@/lib/team-vault-view";
import { secretsLink } from "@/lib/vault-ask";
import type { VaultOrg } from "@/lib/vault-shared";
import type { VaultBridge, VaultSummary } from "@/lib/vault-view";
import { ShareOffer } from "../VaultShared";

const CHIP = "shrink-0 rounded px-1.5 py-0.5 text-[11px] leading-[15px]";
const BUTTON = "rounded-md border border-line-strong px-2.5 py-1 text-[12.5px] text-ink hover:bg-sunken disabled:opacity-50";

type Props = {
  repo: string;
  vault?: TeamProjectVault;
  // This Mac's own vault for the repo (desktop only), and main's bridge to it.
  here?: VaultSummary;
  bridge: VaultBridge | null;
  // The workspace this page is for, as the share dialog's target. Null: no share offered.
  org: VaultOrg | null;
  canShare: boolean;
  // After a share or an approve: load this Mac's vaults again.
  onChanged: () => void;
};

export function ProjectVault({ repo, vault, here, bridge, org, canShare, onChanged }: Props) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chip = vaultChip(vault, here);
  const offer = vaultOffer({ vault, here, desktop: Boolean(bridge), canShare: canShare && Boolean(org) });
  const notify = (err: unknown) => setError(err instanceof Error ? err.message : String(err));
  return (
    <>
      {chip ? (
        <span title={chip.title} className={`${CHIP} ${chip.tone === "shared" ? "bg-accent-soft text-accent" : "bg-sunken text-muted"}`}>
          {chip.text}
        </span>
      ) : null}
      <Offer offer={offer} repo={repo} here={here} bridge={bridge} org={org} open={open} onToggle={() => setOpen((o) => !o)} onChanged={onChanged} notify={notify} />
      {open && vault?.shared ? <VaultDevices repo={repo} shared={vault.shared} here={here} bridge={bridge} onChanged={onChanged} notify={notify} /> : null}
      {error ? (
        <p role="alert" className="basis-full text-[12.5px] text-danger">
          {error}
        </p>
      ) : null}
    </>
  );
}

type OfferProps = Pick<Props, "repo" | "here" | "bridge" | "org" | "onChanged"> & { offer: VaultOffer; open: boolean; onToggle: () => void; notify: (err: unknown) => void };

// The row's one offer (lib/team-vault-view.ts vaultOffer): Devices…, the drawer's Share secrets, a weft:// link, or
// which Mac to do it on.
function Offer({ offer, repo, here, bridge, org, open, onToggle, onChanged, notify }: OfferProps) {
  if (offer?.kind === "devices") {
    return (
      <button type="button" onClick={onToggle} aria-expanded={open} className={BUTTON}>
        Devices…
      </button>
    );
  }
  if (offer?.kind === "share" && here && org) {
    return (
      <ShareOffer
        folder={here.folder}
        org={org}
        orgs={[org]}
        bridge={bridge}
        label={here.label}
        repo={repo.toLowerCase()}
        secrets={here.secrets.filter((s) => !s.missing).length}
        onShared={onChanged}
        notify={notify}
        text="Share secrets"
      />
    );
  }
  if (offer?.kind === "link") {
    return (
      <a href={secretsLink(repo, true)} title={`Opens Weft's 🔐 drawer with the share dialog. Do it on ${offer.on}, where the secrets are.`} className={BUTTON}>
        Share secrets
      </a>
    );
  }
  if (offer?.kind === "elsewhere") return <span className="text-[11.5px] text-muted">Share from {offer.on}</span>;
  return null;
}

type DevicesProps = { repo: string; shared: NonNullable<TeamProjectVault["shared"]>; here?: VaultSummary; bridge: VaultBridge | null; onChanged: () => void; notify: (err: unknown) => void };

// Who holds the key, and the Macs asking to. Approve seals the vault key to the asking Mac, so it runs only where
// the key is: this Mac when it holds the shared vault, else a link to the desktop's drawer.
function VaultDevices({ repo, shared, here, bridge, onChanged, notify }: DevicesProps) {
  const holds = Boolean(here?.shared) && typeof bridge?.deviceGrant === "function";
  return (
    <div className="basis-full rounded-md border border-line bg-sunken/40 px-2 py-1.5 text-[12px]">
      {shared.devices.length ? (
        <ul className="flex flex-col gap-0.5">
          {shared.devices.map((d) => (
            <li key={`${d.name}\n${d.person}`} className="text-ink">
              {d.name} <span className="text-muted">· {d.person}{d.lastSeen ? ` · ${seenText(d.lastSeen)}` : ""}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted">No Mac holds the key yet.</p>
      )}
      {shared.asks.map((a) => (
        <AskRow key={a.id} ask={a} repo={repo} bridge={holds ? bridge : null} elsewhere={bridge && !holds ? macsText(shared.devices.map((d) => d.name)) || "a Mac that holds the key" : null} onChanged={onChanged} notify={notify} />
      ))}
    </div>
  );
}

// bridge: this Mac holds the key, so Approve runs here. elsewhere: a desktop without the key names the Macs with it.
// Neither: a plain browser, which links to the desktop's drawer.
type AskProps = { ask: TeamVaultAsk; repo: string; bridge: VaultBridge | null; elsewhere: string | null; onChanged: () => void; notify: (err: unknown) => void };

function AskRow({ ask, repo, bridge, elsewhere, onChanged, notify }: AskProps) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const grant = bridge?.deviceGrant?.bind(bridge);
  const decline = bridge?.deviceDecline?.bind(bridge);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
      setDone(true);
      onChanged();
    } catch (err) {
      notify(err);
    } finally {
      setBusy(false);
    }
  };
  if (done) return null;
  return (
    <div className="mt-1.5 flex flex-col gap-1 border-t border-line pt-1.5">
      <span>
        {ask.person} asks to add {ask.deviceName}. Approving gives it every key in this vault, production too.
      </span>
      <code className="font-mono text-[11px] break-all text-muted">{ask.fingerprint}</code>
      <div className="flex items-center justify-end gap-1.5">
        {grant && decline ? (
          <>
            <button type="button" disabled={busy} className={BUTTON} onClick={() => void run(() => decline(ask.id))}>
              Decline
            </button>
            <button type="button" disabled={busy} className={BUTTON} onClick={() => void run(() => grant(ask.id))}>
              Approve
            </button>
          </>
        ) : elsewhere ? (
          <span className="text-[11.5px] text-muted">Approve it on {elsewhere}</span>
        ) : (
          <a href={secretsLink(repo, false)} title="Approve on a Mac that holds this vault's key: its 🔐 drawer lists the ask" className={BUTTON}>
            Approve in Weft
          </a>
        )}
      </div>
    </div>
  );
}
