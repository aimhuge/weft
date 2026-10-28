"use client";

import {
  ENVIRONMENTS,
  filterOptions,
  importGroups,
  importLabel,
  pickKey,
  saveLabel,
  STATUS_LABEL,
  toggleEnvironment,
  trackedWarning,
  validName,
  type ImportScan,
  type VaultEnvironment,
  type VaultSummary,
} from "@/lib/vault-view";
import type { Editing } from "@/lib/vault-row-types";
import Icon from "./Icon";
import { SecretValueField } from "./SecretValueField";

// The pieces of the 🔐 drawer (components/VaultDrawer.tsx): the form that types a secret in, the project
// filter, and the .env import's preview. A secret's row is components/SecretRow.tsx.

export type { Editing };

// The three environments as toggles, in any combination. only limits which can be ticked: removing a
// secret offers just the environments it's in (components/RemoveSecretDialog.tsx).
export function EnvironmentPicker({
  value,
  onChange,
  only,
  disabled = false,
}: {
  value: VaultEnvironment[];
  onChange: (next: VaultEnvironment[]) => void;
  only?: VaultEnvironment[];
  disabled?: boolean;
}) {
  return (
    <div role="group" aria-label="Environments" className="flex gap-1">
      {ENVIRONMENTS.map((env) => {
        const on = value.includes(env.id);
        return (
          <button
            key={env.id}
            type="button"
            aria-pressed={on}
            disabled={disabled || (only !== undefined && !only.includes(env.id))}
            onClick={() => onChange(toggleEnvironment(value, env.id))}
            className={`flex-1 rounded-md border px-1 py-0.5 text-[11px] disabled:opacity-40 ${on ? "border-accent bg-accent/15 text-ink" : "border-line-strong text-muted hover:text-ink"}`}
          >
            {env.label}
          </button>
        );
      })}
    </div>
  );
}

// A blank needs only a name; the form will save an empty value as a blank. canBlank keeps older shells
// (without addBlank) from offering the path. A blank being changed can go blank too, once its
// environments change (moving it needs no value).
function isBlank(editing: Editing, name: string, badName: boolean, canBlank: boolean): boolean {
  const moved = editing.environments.length !== 1 || editing.environments[0] !== editing.from;
  return canBlank && (!editing.fixed || (Boolean(editing.blank) && moved)) && editing.value === "" && name !== "" && !badName;
}

// The form is ready when the name is valid, at least one env is ticked, and either the value is typed
// in or the blank path is open. Not while a save is in flight.
function isReady(name: string, editing: Editing, blank: boolean, busy: boolean): boolean {
  return validName(name) && editing.environments.length > 0 && (editing.value !== "" || blank) && !busy;
}

// Typing a secret in: its name, the environments it goes into (as many as you tick, also when changing
// one), and the value, hidden unless you show it. A name already filled in (a thread asked for it) puts the
// cursor in the value. Enter saves, Escape cancels (the drawer listens for it). canBlank turns the Add
// button into Add blank / Add N blanks when the value is empty (the shell's addBlanks puts it in with
// no value yet, for the user to fill in later from 🔐).
export function SecretForm({
  editing,
  busy,
  canBlank,
  onChange,
  onSave,
  onCancel,
}: {
  editing: Editing;
  busy: boolean;
  canBlank: boolean;
  onChange: (next: Editing) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const name = editing.name.trim();
  const badName = name !== "" && !validName(name);
  // A blank needs only a name; a real value still needs the value typed in. The button label
  // (saveLabel, lib/vault-view.ts) names whichever path is open; the form goes ahead either way.
  const blank = isBlank(editing, name, badName, canBlank);
  const ready = isReady(name, editing, blank, busy);
  const field = "w-full rounded-md border border-line-strong bg-card px-2 py-1 text-[12px] text-ink outline-none focus:border-accent disabled:opacity-60";
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) onSave();
      }}
      className="mx-1 mt-1.5 flex flex-col gap-2 rounded-md border border-line bg-sunken p-2.5"
    >
      <input
        value={editing.name}
        onChange={(e) => onChange({ ...editing, name: e.target.value })}
        disabled={editing.fixed}
        autoFocus={!editing.fixed && editing.name === ""}
        placeholder="NAME"
        aria-label="Name"
        title={editing.name}
        spellCheck={false}
        autoComplete="off"
        className={`${field} font-mono ${badName ? "border-warn" : ""}`}
      />
      {badName && <p className="-mt-1 text-[10.5px] leading-snug text-warn">Letters, digits and _, not starting with a digit.</p>}
      <EnvironmentPicker value={editing.environments} onChange={(environments) => onChange({ ...editing, environments })} />
      <SecretValueField
        value={editing.value}
        fixed={editing.fixed}
        autoFocus={editing.fixed || editing.name !== ""}
        className={field}
        onChange={(value) => onChange({ ...editing, value })}
      />
      <div className="flex gap-1.5">
        <button type="submit" disabled={!ready} className={`flex-1 rounded-md px-2 py-1 text-[12px] font-medium text-on-accent disabled:opacity-50 ${blank ? "bg-warn" : "bg-accent"}`}>
          {saveLabel(editing, canBlank)}
        </button>
        <button type="button" onClick={onCancel} className="rounded-md px-2 py-1 text-[12px] text-muted hover:bg-card hover:text-ink">
          Cancel
        </button>
      </div>
    </form>
  );
}

// The import's preview: every name in the project's .env files, ticked by default where it's new or changed.
export function ImportPreview({
  scan,
  picked,
  busy,
  onToggle,
  onImport,
  onClose,
  manage,
  onManage,
}: {
  scan: ImportScan;
  picked: Set<string>;
  busy: boolean;
  onToggle: (key: string) => void;
  onImport: () => void;
  onClose: () => void;
  // Offered (true or false) when the project has a .env.local Weft doesn't write yet: on, Weft takes it over
  // after the import. null hides it.
  manage?: boolean | null;
  onManage?: (on: boolean) => void;
}) {
  const warning = trackedWarning(scan);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 px-3 pt-2 text-[12px]">
        <button onClick={onClose} aria-label="Back" className="rounded p-0.5 text-muted hover:bg-sunken hover:text-ink">
          <Icon name="back" size={13} />
        </button>
        <span className="min-w-0 flex-1 truncate font-medium text-ink">Import into {scan.label}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {warning && <p className="mx-1 mt-2 rounded-md border border-warn/40 bg-warn-soft px-2 py-1.5 text-[11px] leading-snug text-warn">{warning}</p>}
        {scan.rows.length === 0 && <Note>No .env files here (looked in the folder, apps/* and packages/*).</Note>}
        {importGroups(scan).map((group) => (
          <section key={group.file}>
            <h3 className="px-1.5 pb-1 pt-2.5 text-[10.5px] font-semibold uppercase tracking-wider text-faint">
              {group.file} · {group.namesOnly ? "names only" : group.environment}
            </h3>
            {group.rows.map((row) => (
              <label
                key={pickKey(row)}
                className={`flex items-center gap-1.5 rounded px-1.5 py-1 text-[11.5px] hover:bg-sunken ${row.skipped ? "opacity-50" : ""}`}
              >
                <input type="checkbox" checked={picked.has(pickKey(row))} onChange={() => onToggle(pickKey(row))} className="accent-[var(--color-accent)]" />
                <span className="min-w-0 flex-1 truncate font-mono text-ink" title={row.name}>
                  {row.name}
                </span>
                {row.public && <Tag>public</Tag>}
                {row.tail && <span className="font-mono text-[10.5px] text-faint">••••{row.tail}</span>}
                <Tag tone={row.status === "differs" || row.status === "missing" ? "warn" : row.status === "new" ? "accent" : undefined}>
                  {row.skipped ? "short-lived" : STATUS_LABEL[row.status]}
                </Tag>
              </label>
            ))}
          </section>
        ))}
      </div>
      {typeof manage === "boolean" && (
        <label
          className="flex items-start gap-1.5 border-t border-line px-3 pt-2 text-[11px] leading-snug text-muted"
          title="Weft rewrites .env.local from the vault (gitignored, readable only by you) and offers to import your hand edits."
        >
          <input type="checkbox" checked={manage} onChange={(e) => onManage?.(e.target.checked)} className="mt-0.5 accent-[var(--color-accent)]" />
          Then let Weft write .env.local from the vault
        </label>
      )}
      <div className={`flex gap-1.5 px-3 py-2 ${typeof manage === "boolean" ? "" : "border-t border-line"}`}>
        <button
          onClick={onImport}
          disabled={busy || picked.size === 0}
          className="flex-1 rounded-md bg-accent px-2 py-1 text-[12px] font-medium text-on-accent disabled:opacity-50"
        >
          {importLabel(picked.size)}
        </button>
        <button onClick={onClose} className="rounded-md px-2 py-1 text-[12px] text-muted hover:bg-sunken hover:text-ink">
          Cancel
        </button>
      </div>
    </div>
  );
}

export function Note({ children }: { children: React.ReactNode }) {
  return <p className="px-2 py-4 text-center text-[11.5px] leading-snug text-faint">{children}</p>;
}

export function Tag({ children, tone }: { children: React.ReactNode; tone?: "warn" | "accent" }) {
  const color = tone === "warn" ? "bg-warn-soft text-warn" : tone === "accent" ? "bg-accent-soft text-accent" : "bg-sunken text-muted";
  return <span className={`shrink-0 rounded px-1 text-[10px] leading-[15px] ${color}`}>{children}</span>;
}

// The drawer's "Filter by project": follows the top bar's project until you pick here (picked). Hidden
// with only one project on the board.
export function ProjectFilter({
  vaults,
  value,
  picked,
  onPick,
}: {
  vaults: VaultSummary[];
  value: string;
  picked: boolean;
  onPick: (folder: string | null) => void;
}) {
  if (vaults.length < 2) return null;
  return (
    <label className="mx-3 mt-2 flex items-center gap-1.5 text-[11px] text-muted">
      <span className="shrink-0">Project</span>
      <select
        value={value}
        onChange={(e) => onPick(e.target.value || null)}
        aria-label="Filter by project"
        title={picked ? "Picked here; choosing a project in the top bar sets it again" : "Follows the project picked in the top bar"}
        className="min-w-0 flex-1 rounded-md border border-line-strong bg-card px-1.5 py-0.5 text-[11.5px] text-ink"
      >
        {filterOptions(vaults).map((o) => (
          <option key={o.folder} value={o.folder}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

// The shared vault's pieces live in their own module (components/VaultShared.tsx) to keep this file
// under the line cap; they're re-exported here so the drawer imports them from one place.
export { ShareOffer, SharedBadge } from "./VaultShared";
