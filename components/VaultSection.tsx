"use client";

// One project's vault in the 🔐 drawer, for using its secrets: its name with Add and ⚙ (Settings → Secrets, where
// sharing, env files and the event log live), one status line (./VaultStatusLine), the ▲ Vercel line with Pull and
// Push, the nudge with Import all, its blanks in one "To fill in" list (./VaultBlanks), then its values by environment. editing is set when the form is open in this vault: at the top when adding, in place of the row when
// changing one.

import { keyLabel } from "@/lib/hotkeys";
import { searchSecrets } from "@/lib/vault-search";
import { environmentsOf, groupSecrets, nudgeText, secretKey, type VaultConflict, type VaultSecret, type VaultSummary } from "@/lib/vault-view";
import { conflictKey } from "@/lib/use-vault-conflicts";
import { openSecretsSettings } from "@/lib/secrets-settings";
import type { RowAction } from "./SecretRow";
import type { Editing } from "./VaultParts";
import { Note } from "./VaultParts";
import { VaultStatusLine } from "./VaultStatusLine";
import { SecretRow } from "./SecretRow";
import { VaultBlanks } from "./VaultBlanks";
import { blanksOf } from "@/lib/vault-blanks";
import Icon from "./Icon";
import VaultVercel from "./VaultVercel";

export function VaultSection({
  vault: v,
  editing,
  form,
  query,
  revealed,
  onAdd,
  onImport,
  onImportAll,
  onAct,
  onMenu,
  notify,
  conflicts,
  onKeepMine,
  onKeepTheirs,
}: {
  vault: VaultSummary;
  editing: Editing | null;
  form: React.ReactNode;
  // The drawer's search box; the section lists only the secrets that match it.
  query: string;
  revealed: Map<string, string>;
  onAdd: () => void;
  onImport: () => void;
  // The nudge's Import all.
  onImportAll: () => void;
  onAct: (s: VaultSecret, action: RowAction) => void;
  onMenu: (s: VaultSecret, e: React.MouseEvent) => void;
  // Toasts from the ▲ line's Push to Vercel.
  notify: (err: unknown) => void;
  // The conflicts of the writes that lost against a teammate's, and the two ways out of one.
  conflicts: Map<string, VaultConflict>;
  onKeepMine: (key: string) => void;
  onKeepTheirs: (key: string) => void;
}) {
  const changing = (s: VaultSecret) => editing?.fixed && editing.name === s.name && editing.from === s.environment;
  const found = searchSecrets(v.secrets, query);
  const row = rowMaker({ v, form, revealed, changing, onAct, onMenu, conflicts, onKeepMine, onKeepTheirs });
  return (
    <section className="mt-2">
      <div className="flex items-center gap-1 px-1.5">
        <h3 className="min-w-0 flex-1 truncate text-[12px] font-semibold text-ink" title={`${v.folders.join("\n")}${v.managed ? "\nWeft writes .env.local from this vault" : ""}`}>
          {v.label}
        </h3>
        <button
          onClick={onAdd}
          title={`Add a secret by hand (${keyLabel("shift+s")})`}
          className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-sunken hover:text-ink"
        >
          <Icon name="plus" size={11} /> Add
        </button>
        <button
          onClick={() => openSecretsSettings(v.id)}
          aria-label={`Manage ${v.label}`}
          title="Sharing, its Macs, the recovery key, env files and the event log: Settings → Secrets"
          className="rounded p-0.5 text-muted hover:bg-sunken hover:text-ink"
        >
          <Icon name="sliders" size={12} />
        </button>
      </div>
      <VaultStatusLine vault={v} />
      <VaultVercel folder={v.folder} changed={v.secrets.map((s) => `${secretKey(s)}${s.missing ? "" : s.updatedAt}`).join("\n")} notify={notify} />
      {editing && !editing.fixed && form}
      {v.nudge && (
        <div className="mx-1 mt-1.5 flex items-start gap-1 rounded-md border border-accent/40 bg-accent-soft px-2 py-1.5 text-[11px] leading-snug text-accent">
          <button onClick={onImport} title="Review each name before it goes in" className="min-w-0 flex-1 text-left hover:underline">
            {nudgeText(v.nudge)}
          </button>
          <button onClick={onImportAll} className="shrink-0 rounded bg-accent px-1.5 py-0.5 font-medium text-on-accent hover:opacity-90">
            Import all
          </button>
        </div>
      )}
      {v.secrets.length === 0 && !v.nudge && !editing && <Note>No secrets yet. Add one, import this project&apos;s .env files, or locate an env file elsewhere.</Note>}
      <VaultBlanks blanks={blanksOf(found)} values={found.filter((s) => !s.missing).length} query={query} editing={found.some((s) => s.missing && changing(s))} row={row} />
      {groupSecrets(found.filter((s) => !s.missing)).map((group) => (
        <div key={group.id}>
          <h4 className="px-1.5 pb-0.5 pt-2 text-[10.5px] font-semibold uppercase tracking-wider text-faint">{group.label}</h4>
          {group.secrets.map((s) => row(s))}
        </div>
      ))}
    </section>
  );
}

type RowDeps = Pick<Parameters<typeof VaultSection>[0], "form" | "revealed" | "onAct" | "onMenu" | "conflicts" | "onKeepMine" | "onKeepTheirs"> & {
  v: VaultSummary;
  changing: (s: VaultSecret) => boolean | undefined;
};

// One secret's row, or the form in its place while it's being changed. note: a blank's few words (lib/vault-blanks.ts).
function rowMaker({ v, form, revealed, changing, onAct, onMenu, conflicts, onKeepMine, onKeepTheirs }: RowDeps) {
  return function row(s: VaultSecret, note?: string | null) {
    if (changing(s)) return <div key={secretKey(s)}>{form}</div>;
    const key = conflictKey(v.id, s.name, s.environment);
    return (
      <SecretRow
        key={secretKey(s)}
        secret={s}
        note={note}
        value={revealed.get(`${v.id}\n${secretKey(s)}`)}
        spread={environmentsOf(v.secrets, s.name).length > 1}
        onAct={(action) => onAct(s, action)}
        onMenu={(e) => onMenu(s, e)}
        conflict={conflicts.get(key)}
        onKeepMine={() => onKeepMine(key)}
        onKeepTheirs={() => onKeepTheirs(key)}
      />
    );
  };
}

// The Add form's start: a new name for development in vault v.
export const newSecret = (v: VaultSummary): Editing => ({ vault: v.id, folder: v.folder, name: "", environments: ["development"], value: "", fixed: false });