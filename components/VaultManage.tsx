"use client";

// One project's vault on Settings → Secrets (docs/architecture/secrets.md, "The drawer and Settings → Secrets"): what
// you set up once or now and then, moved out of the 🔐 drawer so the drawer is for using secrets. Sharing (Share…,
// Ask to join, the Macs asking, the recovery key), env files (Import…, Locate…, .env.local), and the shared vault's
// event log. Every action is the drawer's own component on the same bridge; nothing here sees a value.
import { useEffect, useRef, useState } from "react";
import type { VaultActions } from "@/lib/use-vault-actions";
import { useShareAsked } from "@/lib/vault-ask";
import { repoOf, shareTargets, type VaultOrg } from "@/lib/vault-shared";
import { offersShare } from "@/lib/vault-status";
import type { VaultBridge, VaultSummary } from "@/lib/vault-view";
import { vaultEventsBridge } from "@/lib/vault-events";
import { SettingsCard } from "./SettingsLayout";
import VaultEventsList from "./VaultEventsList";
import { VaultRecoveryButton } from "./VaultRecoveryButton";
import { DeviceRequests, JoinHint, JoinOffer, ShareOffer, SharedBadge } from "./VaultShared";

const BUTTON = "rounded-md border border-line-strong px-2.5 py-1 text-[12px] text-ink hover:bg-sunken disabled:opacity-50";
const ROW = "flex flex-wrap items-center gap-2 border-t border-line pt-2.5";
const LABEL = "w-24 shrink-0 text-[12px] text-muted";

// "45 values · 22 to fill in"
export function countsText(v: VaultSummary): string {
  const blanks = v.secrets.filter((s) => s.missing).length;
  const values = v.secrets.length - blanks;
  const parts = [`${values} ${values === 1 ? "value" : "values"}`];
  if (blanks) parts.push(`${blanks} to fill in`);
  return parts.join(" · ");
}

export function VaultManage({
  vault: v,
  bridge,
  orgs,
  actions,
  onChanged,
  notify,
  focused = false,
}: {
  vault: VaultSummary;
  bridge: VaultBridge | null;
  orgs: VaultOrg[];
  actions: VaultActions;
  // After a share, a join or an approve: load the vaults again.
  onChanged: () => void;
  notify: (err: unknown) => void;
  // Brought into view: the drawer's ⚙ or a weft://secrets link asked for this vault.
  focused?: boolean;
}) {
  const repo = repoOf(v.id);
  const shareAsked = useShareAsked(repo);
  const [log, setLog] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focused || shareAsked) ref.current?.scrollIntoView({ block: "start" });
  }, [focused, shareAsked]);
  return (
    <div ref={ref}>
      <SettingsCard>
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center gap-2">
            <h3 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink" title={v.folders.join("\n")}>
              {v.label}
            </h3>
            <SharedBadge vault={v} />
            <span className="shrink-0 text-[12px] text-muted">{countsText(v)}</span>
          </div>
          <Sharing vault={v} repo={repo} bridge={bridge} orgs={orgs} onChanged={onChanged} notify={notify} startOpen={shareAsked} />
          <div className={ROW}>
            <span className={LABEL}>Env files</span>
            <button type="button" onClick={() => void actions.startImport(v)} className={BUTTON} title="Read this project's .env files and pick what goes in">
              Import…
            </button>
            {bridge?.locate ? (
              <button type="button" onClick={() => void actions.locate(v)} className={BUTTON} title="Pick an env file anywhere on this Mac; Weft reads it for this vault from then on">
                Locate…
              </button>
            ) : null}
            {v.managed ? <span className="text-[12px] text-muted">Weft writes .env.local from this vault</span> : null}
          </div>
          {v.shared ? (
            <div className={ROW}>
              <span className={LABEL}>Event log</span>
              <button type="button" onClick={() => setLog((o) => !o)} aria-expanded={log} className={BUTTON}>
                {log ? "Hide" : "Show"} who changed what
              </button>
              {log ? (
                <div className="basis-full">
                  <VaultEventsList bridge={vaultEventsBridge()} vaultId={v.id} vaultLabel={v.label} />
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </SettingsCard>
    </div>
  );
}

type SharingProps = { vault: VaultSummary; repo: string; bridge: VaultBridge | null; orgs: VaultOrg[]; onChanged: () => void; notify: (err: unknown) => void; startOpen: boolean };

// Shared: the recovery key and the Macs asking. Shared elsewhere: Ask to join. Local: Share…, or why there's no join.
function Sharing({ vault: v, repo, bridge, orgs, onChanged, notify, startOpen }: SharingProps) {
  return (
    <div className={ROW}>
      <span className={LABEL}>Sharing</span>
      {v.shared ? <span className="text-[12px] text-ink">Shared with {v.shared.org.name || "a workspace"}</span> : null}
      {v.shared ? <VaultRecoveryButton vault={v} /> : null}
      {offersShare(v) ? (
        <>
          <span className="text-[12px] text-muted">{repo ? "On this Mac only" : "No GitHub repo, so it stays on this Mac"}</span>
          <ShareOffer
            folder={v.folder}
            org={shareTargets(orgs, repo)[0] ?? null}
            orgs={orgs}
            bridge={bridge}
            label={v.label}
            repo={repo}
            secrets={v.secrets.filter((s) => !s.missing).length}
            onShared={onChanged}
            notify={notify}
            startOpen={startOpen}
          />
        </>
      ) : null}
      {v.joinHint || v.join || v.requests ? (
        <div className="flex basis-full flex-col gap-1.5">
          {v.joinHint ? <JoinHint hint={v.joinHint} onDone={onChanged} notify={notify} /> : null}
          {v.join ? <JoinOffer folder={v.folder} join={v.join} bridge={bridge} onDone={onChanged} notify={notify} /> : null}
          {v.requests ? <DeviceRequests requests={v.requests} bridge={bridge} onDone={onChanged} notify={notify} /> : null}
        </div>
      ) : null}
    </div>
  );
}
