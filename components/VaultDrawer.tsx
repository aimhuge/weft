"use client";

import { useEffect, useState } from "react";
import { useEscape } from "@/lib/use-escape";
import { onSecretAsk, useIdle } from "@/lib/use-vault";
import {
  environmentsOf,
  filterVaults,
  vaultFilter,
  type VaultBridge,
  type VaultFilterPick,
  type VaultOverview,
  type VaultSummary,
} from "@/lib/vault-view";
import { useVaultActions, type VaultActions } from "@/lib/use-vault-actions";
import { vaultsWithMatches } from "@/lib/vault-search";
import Icon from "./Icon";
import RemoveSecretDialog from "./RemoveSecretDialog";
import { type RowAction } from "./SecretRow";
import { ImportPreview, Note, ProjectFilter, SecretForm } from "./VaultParts";
import VaultSearch from "./VaultSearch";
import { VaultSection, newSecret } from "./VaultSection";

// The 🔐 drawer's body (docs/architecture/secrets.md): every project's vault (filtered to the top bar's
// project unless you pick another), names by environment with masked tails, secrets typed in by hand or
// copied from another project, and the .env import with its preview. Values reach this page only from
// reveal, after Touch ID, or as you type them, and leave it again when the drawer sits idle.
// What the drawer says instead of the vaults: the error, a loading line, or that no project is added yet.
function noteWhenEmpty(overview: VaultOverview | null, error: string | null): string | null {
  if (error) return error;
  if (!overview) return "Opening the vault…";
  if (!overview.vaults.length) return "Add a project to the board to keep its secrets here.";
  return null;
}

export default function VaultDrawer({
  bridge,
  overview,
  error,
  reload,
  project,
  notify,
}: {
  bridge: VaultBridge | null;
  overview: VaultOverview | null;
  error: string | null;
  reload: () => Promise<void>;
  // The top bar's project, which the filter follows by default.
  project: string | null;
  // Shows an error or a short message as a toast.
  notify: (err: unknown) => void;
}) {
  const [pick, setPick] = useState<VaultFilterPick | null>(null);
  const [query, setQuery] = useState("");
  const actions = useVaultActions(bridge, overview, reload, notify);

  const lock = () => actions.lock();
  useIdle(actions.unlocked || actions.revealed.size > 0 || Boolean(actions.editing?.value), lock);
  useEscape(Boolean(actions.editing), () => actions.setEditing(null));
  // ⇧S (lib/use-vault.ts): the Add form opens on the first vault shown, once there is one.
  useEffect(
    () =>
      onSecretAsk(() => {
        const first = overview && filterVaults(overview.vaults, vaultFilter(project, pick))[0];
        if (first) actions.setEditing(newSecret(first));
        return Boolean(first);
      }),
    [overview, project, pick, actions],
  );

  if (!bridge) return <Note>The vault lives in Weft&apos;s desktop app, where Electron keeps its key in the Keychain.</Note>;
  const note = noteWhenEmpty(overview, error);
  if (note || !overview) return <Note>{note}</Note>;
  const all = overview.vaults;
  const filter = vaultFilter(project, pick);
  const inProject = filterVaults(all, filter);
  const shown = vaultsWithMatches(inProject, query, actions.editing?.vault ?? null);
  // The select names a vault by its first folder, so a second clone of the same repo still selects it.
  const filterValue = (filter && inProject[0]?.folder) || "";

  const locatable = bridge.locate !== undefined;
  if (actions.importing) return <PreviewFor importing={actions.importing} actions={actions} vaults={all} locatable={locatable} />;

  const editing = actions.editing;
  const form = editing && (
    <SecretForm editing={editing} busy={actions.busy} canBlank={Boolean(bridge.addBlank)} onChange={actions.setEditing} onSave={() => { void actions.save(editing); }} onCancel={() => { actions.setEditing(null); }} />
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <RemoveFor actions={actions} />
      <ProjectFilter vaults={all} value={filterValue} picked={pick?.top === project} onPick={(folder) => setPick({ top: project, folder })} />
      <VaultSearch query={query} onQuery={setQuery} />
      <VaultList shown={shown} query={query} form={form} actions={actions} notify={notify} locatable={locatable} />
    </div>
  );
}

// The .env import preview, with Locate… for the vault it was opened on when the shell can open main's dialog.
function PreviewFor({ importing, actions, vaults, locatable }: { importing: NonNullable<VaultActions["importing"]>; actions: VaultActions; vaults: VaultSummary[]; locatable: boolean }) {
  const into = locatable ? vaults.find((v) => v.folders.includes(importing.folder)) : undefined;
  return (
    <ImportPreview
      scan={importing.scan}
      picked={importing.picked}
      busy={actions.busy}
      onToggle={actions.toggleImport}
      onImport={() => void actions.finishImport()}
      onClose={() => actions.setImporting(null)}
      manage={importing.manage}
      onManage={(on) => actions.setImporting({ ...importing, manage: on })}
      onLocate={into ? () => void actions.locate(into) : undefined}
    />
  );
}

// The scrolling list under the filters: each shown vault's section, a note when the search matches nothing, and Lock now.
function VaultList({ shown, query, form, actions, notify, locatable }: { shown: VaultSummary[]; query: string; form: React.ReactNode; actions: VaultActions; notify: (err: unknown) => void; locatable: boolean }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
      {query.trim() && !shown.length && <Note>No secrets match “{query.trim()}”.</Note>}
      {shown.map((v) => (
        <VaultSection
          key={v.id}
          vault={v}
          editing={actions.editing?.vault === v.id ? actions.editing : null}
          form={form}
          query={query}
          revealed={actions.revealed}
          onAdd={() => actions.setEditing(newSecret(v))}
          onImport={() => void actions.startImport(v)}
          onImportAll={() => void actions.importAll(v)}
          onLocate={locatable ? () => void actions.locate(v) : undefined}
          onAct={(s, action: RowAction) => void actions.act(v, s, action)}
          onMenu={(s, e) => void actions.menu(v, s, e)}
          notify={notify}
        />
      ))}
      {actions.unlocked && (
        <button onClick={() => actions.lock()} className="mx-1 mt-3 flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-sunken hover:text-ink">
          <Icon name="lock" size={11} /> Lock now
        </button>
      )}
    </div>
  );
}

// The Remove dialog, open while actions.removing names a secret.
function RemoveFor({ actions }: { actions: VaultActions }) {
  const removing = actions.removing;
  if (!removing) return null;
  return (
    <RemoveSecretDialog
      name={removing.s.name}
      environments={environmentsOf(removing.v.secrets, removing.s.name)}
      initial={removing.s.environment}
      busy={actions.busy}
      onRemove={(environments) => void actions.removeFromVault(removing.v.id, removing.s.name, environments)}
      onClose={() => actions.setRemoving(null)}
    />
  );
}
