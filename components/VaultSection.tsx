"use client";

// One project's vault: its name with Add, Import… and Locate…, the nudge with Import all, and its secrets by environment. editing
// is set when the form is open in this vault: at the top when adding, in place of the row when changing one.

import { keyLabel } from "@/lib/hotkeys";
import { searchSecrets } from "@/lib/vault-search";
import { environmentsOf, groupSecrets, nudgeText, secretKey, type VaultSecret, type VaultSummary } from "@/lib/vault-view";
import type { RowAction } from "./SecretRow";
import type { Editing } from "./VaultParts";
import { Note } from "./VaultParts";
import { SecretRow } from "./SecretRow";
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
  onLocate,
  onAct,
  onMenu,
  notify,
}: {
  vault: VaultSummary;
  editing: Editing | null;
  form: React.ReactNode;
  // The drawer's search box; the section lists only the secrets that match it.
  query: string;
  revealed: Map<string, string>;
  onAdd: () => void;
  onImport: () => void;
  // The nudge's Import all, and Locate… (absent in a shell too old to open main's file dialog).
  onImportAll: () => void;
  onLocate?: () => void;
  onAct: (s: VaultSecret, action: RowAction) => void;
  onMenu: (s: VaultSecret, e: React.MouseEvent) => void;
  // Toasts from the ▲ line's Push to Vercel.
  notify: (err: unknown) => void;
}) {
  const changing = (s: VaultSecret) => editing?.fixed && editing.name === s.name && editing.from === s.environment;
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
        <button onClick={onImport} className="rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-sunken hover:text-ink">
          Import…
        </button>
        {onLocate && (
          <button
            onClick={onLocate}
            title="Pick an env file anywhere on this Mac; Weft reads it for this vault from then on"
            className="rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-sunken hover:text-ink"
          >
            Locate…
          </button>
        )}
      </div>
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
      {groupSecrets(searchSecrets(v.secrets, query)).map((group) => (
        <div key={group.id}>
          <h4 className="px-1.5 pb-0.5 pt-2 text-[10.5px] font-semibold uppercase tracking-wider text-faint">{group.label}</h4>
          {group.secrets.map((s) =>
            changing(s) ? (
              <div key={secretKey(s)}>{form}</div>
            ) : (
              <SecretRow
                key={secretKey(s)}
                secret={s}
                value={revealed.get(`${v.id}\n${secretKey(s)}`)}
                spread={environmentsOf(v.secrets, s.name).length > 1}
                onAct={(action) => onAct(s, action)}
                onMenu={(e) => onMenu(s, e)}
              />
            ),
          )}
        </div>
      ))}
    </section>
  );
}

// The Add form's start: a new name for development in vault v.
export const newSecret = (v: VaultSummary): Editing => ({ vault: v.id, folder: v.folder, name: "", environments: ["development"], value: "", fixed: false });