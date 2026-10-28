"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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
import type { VaultOrg } from "@/lib/vault-shared";
import { vaultEventsBridge } from "@/lib/vault-events";
import Icon from "./Icon";
import RemoveSecretDialog from "./RemoveSecretDialog";
import { type RowAction } from "./SecretRow";
import { ImportPreview, Note, ProjectFilter, SecretForm } from "./VaultParts";
import VaultEventsList, { VaultTabs, type VaultTab } from "./VaultEventsList";
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
  // The drawer's two tabs: the secrets, and the shared vault's event log (docs/architecture/teams-vault.md).
  const [tab, setTab] = useState<VaultTab>("secrets");
  const actions = useVaultActions(bridge, overview, reload, notify);

  const lock = () => actions.lock();
  useIdle(idleWhile(actions), lock);
  useEscape(Boolean(actions.editing), () => actions.setEditing(null));
  // ⇧S (lib/use-vault.ts): the Add form opens on the first vault shown, once there is one.
  useSecretAsk(overview, project, pick, actions);

  if (!bridge) return <Note>The vault lives in Weft&apos;s desktop app, where Electron keeps its key in the Keychain.</Note>;
  const note = noteWhenEmpty(overview, error);
  if (note || !overview) return <Note>{note}</Note>;
  const all = overview.vaults;
  const filter = vaultFilter(project, pick);
  const inProject = filterVaults(all, filter);
  const shown = vaultsWithMatches(inProject, query, actions.editing?.vault ?? null);
  // The select names a vault by its first folder, so a second clone of the same repo still selects it.
  const filterValue = (filter && inProject[0]?.folder) || "";

  if (actions.importing) {
    return <ImportPreviewFor actions={actions} />;
  }

  const form = <SecretFormFor actions={actions} canBlank={Boolean(bridge.addBlank)} />;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <VaultTabs tab={tab} onTab={setTab} />
      <ProjectFilter vaults={all} value={filterValue} picked={pick?.top === project} onPick={(folder) => setPick({ top: project, folder })} />
      <RecoveryMenu vault={shown[0] ?? null} />
      <VaultTabBody tab={tab} shown={shown} query={query} onQuery={setQuery} form={form} actions={actions} notify={notify} bridge={bridge} orgs={overview.orgs ?? []} onShared={() => void reload()} />
    </div>
  );
}

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
function RecoveryMenu({ vault }: { vault: VaultSummary | null }) {
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
    <div className="mx-3 mt-1 flex items-center gap-1.5 text-[11px] text-muted">
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

// The drawer locks itself once nothing is open: not unlocked, no revealed value, no value being typed.
function idleWhile(actions: VaultActions): boolean {
  return actions.unlocked || actions.revealed.size > 0 || Boolean(actions.editing?.value);
}

// The Add/Change form, when a secret is being typed in.
function SecretFormFor({ actions, canBlank }: { actions: VaultActions; canBlank: boolean }) {
  const editing = actions.editing;
  if (!editing) return null;
  return (
    <SecretForm editing={editing} busy={actions.busy} canBlank={canBlank} onChange={actions.setEditing} onSave={() => { void actions.save(editing); }} onCancel={() => { actions.setEditing(null); }} />
  );
}

// The tab's body: the secrets, or the shared vault's event log.
function VaultTabBody({
  tab,
  shown,
  query,
  onQuery,
  form,
  actions,
  notify,
  bridge,
  orgs,
  onShared,
}: {
  tab: VaultTab;
  shown: VaultSummary[];
  query: string;
  onQuery: (query: string) => void;
  form: React.ReactNode;
  actions: VaultActions;
  notify: (err: unknown) => void;
  bridge: VaultBridge | null;
  orgs: VaultOrg[];
  onShared: () => void;
}) {
  if (tab === "events") return <EventsTab shown={shown} />;
  return (
    <>
      <RemoveFor actions={actions} />
      <VaultSearch query={query} onQuery={onQuery} />
      <VaultList shown={shown} query={query} form={form} actions={actions} notify={notify} bridge={bridge} orgs={orgs} onShared={onShared} />
    </>
  );
}

// The Event log tab: the shared vault's audit log for the vault under the filter — who did what,
// never a value (docs/architecture/teams-vault.md, "What the 🔐 drawer shows").
function EventsTab({ shown }: { shown: VaultSummary[] }) {
  const vault = shown[0] ?? null;
  const bridge = vaultEventsBridge();
  if (!vault) return <Note>Pick a project to see its event log.</Note>;
  return <VaultEventsList bridge={bridge} vaultId={vault.id} vaultLabel={vault.label} />;
}

// ⇧S (lib/use-vault.ts): the Add form opens on the first vault shown, once there is one.
function useSecretAsk(overview: VaultOverview | null, project: string | null, pick: VaultFilterPick | null, actions: VaultActions) {
  useEffect(
    () =>
      onSecretAsk(() => {
        const first = overview && filterVaults(overview.vaults, vaultFilter(project, pick))[0];
        if (first) actions.setEditing(newSecret(first));
        return Boolean(first);
      }),
    [overview, project, pick, actions],
  );
}

// The scrolling list under the filters: each shown vault's section, a note when the search matches nothing, and Lock now.
function VaultList({
  shown,
  query,
  form,
  actions,
  notify,
  bridge,
  orgs,
  onShared,
}: {
  shown: VaultSummary[];
  query: string;
  form: React.ReactNode;
  actions: VaultActions;
  notify: (err: unknown) => void;
  bridge: VaultBridge | null;
  orgs: VaultOrg[];
  onShared: () => void;
}) {
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
          onAct={(s, action: RowAction) => void actions.act(v, s, action)}
          onMenu={(s, e) => void actions.menu(v, s, e)}
          notify={notify}
          bridge={bridge}
          orgs={orgs}
          onShared={onShared}
          conflicts={actions.conflicts}
          onKeepMine={(key) => void actions.keepMine(key)}
          onKeepTheirs={(key) => void actions.keepTheirs(key)}
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

// The import's preview, open while actions.importing holds the scan.
function ImportPreviewFor({ actions }: { actions: VaultActions }) {
  const importing = actions.importing;
  if (!importing) return null;
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
    />
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
