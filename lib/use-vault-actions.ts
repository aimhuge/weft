"use client";

// The 🔐 drawer's secret-level actions (components/VaultDrawer.tsx): reveal, copy, change, remove,
// import, and the right-click menu. Extracted so the drawer can stay focused on its layout and
// per-vault rendering, and so the action logic is testable on its own.
//
// It also holds the conflicts (docs/architecture/teams-vault.md, "Push on change"): a write that lost
// against a teammate's leaves a banner on that secret's row, with the two ways out. The banner is
// transient — it goes away on the re-render that follows the next reload.

import { useCallback, useState } from "react";
import {
  copiedText,
  defaultPicks,
  manageOffer,
  picksOf,
  secretKey,
  secretMenu,
  takeOver,
  type ImportScan,
  type SecretAction,
  type VaultBridge,
  type VaultConflict,
  type VaultSecret,
  type VaultSummary,
} from "@/lib/vault-view";
import { useVaultConflicts } from "@/lib/use-vault-conflicts";
import type { Editing, RowAction } from "@/lib/vault-row-types";

// The drawer state and the actions the layout buttons trigger, returned by useVaultActions.
export interface VaultActions {
  // Revealed secrets: key `${vault.id}\n${name}\n${environment}` -> value.
  revealed: Map<string, string>;
  // The form's editing state (Add / Change).
  editing: Editing | null;
  setEditing: (e: Editing | null) => void;
  // The dialog asking which environments to remove.
  removing: { v: VaultSummary; s: VaultSecret } | null;
  setRemoving: (r: { v: VaultSummary; s: VaultSecret } | null) => void;
  // The .env import preview, or null when no import is open.
  importing: { folder: string; scan: ImportScan; picked: Set<string>; manage: boolean | null } | null;
  setImporting: (i: { folder: string; scan: ImportScan; picked: Set<string>; manage: boolean | null } | null) => void;
  // Whether the vault is currently unlocked (a Touch ID has approved a reveal or copy).
  unlocked: boolean;
  // Wrap any change in busy + reload + error toast.
  busy: boolean;
  // Run a secret action (reveal, copy, remove, change, copy-to, choose-remove).
  act: (v: VaultSummary, s: VaultSecret, action: SecretAction | RowAction) => Promise<void>;
  // Right-click on a secret's row: pop the menu, then run the picked action.
  menu: (v: VaultSummary, s: VaultSecret, e: React.MouseEvent) => Promise<void>;
  // Open the .env import preview.
  startImport: (v: VaultSummary) => Promise<void>;
  // Toggle a row in the import preview.
  toggleImport: (key: string) => void;
  // Finish the import, with the take-over offer ticked.
  finishImport: () => Promise<void>;
  // The Add / Change save handler.
  save: (e: Editing) => Promise<void>;
  // The conflicts of the writes that lost against a teammate's, by secret: key
  // `${vault.id}\n${environment}\n${name}`. A secret's row shows the banner while it has one.
  conflicts: Map<string, VaultConflict>;
  // The two ways out of a conflict: re-apply the user's own edit against the server's current row,
  // or take the server's row and drop the edit.
  keepMine: (key: string) => Promise<void>;
  keepTheirs: (key: string) => Promise<void>;
  // The dialog's remove button: delete from each ticked environment.
  removeFromVault: (vaultId: string, name: string, environments: string[]) => Promise<void>;
  // Lock the vault and clear revealed values.
  lock: () => void;
}

// The 🔐 drawer's actions and the small bit of state they need.
export function useVaultActions(bridge: VaultBridge | null, overview: { vaults: VaultSummary[] } | null, reload: () => Promise<void>, notify: (err: unknown) => void): VaultActions {
  const [importing, setImporting] = useState<{ folder: string; scan: ImportScan; picked: Set<string>; manage: boolean | null } | null>(null);
  const [revealed, setRevealed] = useState<Map<string, string>>(new Map());
  const [unlocked, setUnlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [removing, setRemoving] = useState<{ v: VaultSummary; s: VaultSecret } | null>(null);
  // The conflicts of the writes that lost against a teammate's, and the edits behind them: the
  // value the user typed stays out of the page, so "Keep your edit" can put it back.
  const { conflicts, record, keepMine: keepMineConflict, keepTheirs: keepTheirsConflict } = useVaultConflicts(bridge, overview);

  const lock = useCallback(() => {
    setRevealed(new Map());
    setUnlocked(false);
    setEditing(null);
    void bridge?.lock();
  }, [bridge]);

  // Runs a change against the vault, then shows the vaults again; errors become a toast.
  const change = useCallback(async (run: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await run();
      await reload();
    } catch (err) {
      notify(err);
    } finally {
      setBusy(false);
    }
  }, [reload, notify]);

  const startImport = useCallback(async (v: VaultSummary) => {
    if (!bridge) return;
    try {
      const scan = await bridge.scan(v.folder);
      setImporting({ folder: v.folder, scan, picked: defaultPicks(scan), manage: manageOffer(bridge, scan, v.managed) });
    } catch (err) {
      notify(err);
    }
  }, [bridge, notify]);

  const act = useCallback(async (v: VaultSummary, s: VaultSecret, action: SecretAction | RowAction) => {
    if (!bridge) return;
    const key = `${v.id}\n${secretKey(s)}`;
    if (action === "choose-remove") {
      setRemoving({ v, s });
      return;
    }
    if (action === "edit") {
      setEditing({ vault: v.id, folder: v.folder, name: s.name, environments: [s.environment], value: "", fixed: true, from: s.environment, blank: s.missing });
      return;
    }
    if (action.startsWith("copy-to:"))
      return change(async () => {
        const result = await bridge.copyTo(v.id, s.name, s.environment, action.slice("copy-to:".length));
        if ("copied" in result) notify(copiedText(s.name, result));
      });
    if (action === "remove") return change(() => bridge.remove(v.id, s.name, s.environment));
    if (action === "reveal" && revealed.has(key)) {
      const next = new Map(revealed);
      next.delete(key);
      setRevealed(next);
      return;
    }
    try {
      const result = action === "reveal" ? await bridge.reveal(v.id, s.name, s.environment) : await bridge.copy(v.id, s.name, s.environment);
      if ("denied" in result) return;
      setUnlocked(true);
      if ("value" in result) setRevealed(new Map(revealed).set(key, result.value));
    } catch (err) {
      notify(err);
    }
  }, [bridge, revealed, change, notify]);

  const menu = useCallback(async (v: VaultSummary, s: VaultSecret, e: React.MouseEvent) => {
    const shell = window.weft;
    if (!shell?.popupMenu) return;
    e.preventDefault();
    const others = (overview?.vaults ?? []).filter((o) => o.id !== v.id);
    const picked = (await shell.popupMenu(secretMenu(s, others))) as SecretAction | null;
    // The menu's Remove from Vault… asks which environments, the same as 🗑 on a name in several.
    if (picked) await act(v, s, picked === "remove" ? "choose-remove" : picked);
  }, [overview, act]);

  const toggleImport = useCallback((key: string) => {
    setImporting((cur) => {
      if (!cur) return cur;
      const next = new Set(cur.picked);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { ...cur, picked: next };
    });
  }, []);

  const finishImport = useCallback(async () => {
    if (!bridge || !importing) return;
    await change(async () => {
      await bridge.import(importing.folder, picksOf(importing.scan, importing.picked));
      const took = await takeOver(bridge, importing.folder, importing.manage);
      if (took) notify(took);
      setImporting(null);
    });
  }, [bridge, importing, change, notify]);

  const save = useCallback(async (e: Editing) => {
    if (!bridge) return;
    await change(async () => {
      const name = e.name.trim();
      // No value: a blank in each ticked environment, filled in later from 🔐. Unticking its own moves it out.
      for (const env of e.environments) {
        const result =
          e.value === "" && bridge.addBlank ? await bridge.addBlank(e.folder, name, env) : await bridge.set(e.folder, name, env, e.value);
        // A write that lost against a teammate's isn't saved: the row shows the banner, and the edit
        // waits here for the user to pick a way out.
        if ("saved" in result && !result.saved) record(e.vault, name, env, result.conflict, e);
      }
      if (e.fixed && e.from && !e.environments.includes(e.from)) await bridge.remove(e.vault, name, e.from);
      setEditing(null);
    });
  }, [bridge, change, record]);

  const removeFromVault = useCallback(async (vaultId: string, name: string, environments: string[]) => {
    if (!bridge) return;
    await change(async () => {
      for (const env of environments) await bridge.remove(vaultId, name, env);
      setRemoving(null);
    });
  }, [bridge, change]);

  // "Keep your edit": the same value, written again against the row's current version, which the
  // server's conflict already recorded — so the write goes through instead of losing again.
  const keepMine = useCallback(
    async (key: string) => {
      await change(() => keepMineConflict(key));
    },
    [change, keepMineConflict],
  );

  // "Keep theirs": the server's row is already in the shadow, so there is nothing to write — the
  // edit is dropped and the list shows what the vault holds.
  const keepTheirs = useCallback(
    async (key: string) => {
      keepTheirsConflict(key);
      await change(() => Promise.resolve());
    },
    [change, keepTheirsConflict],
  );

  return {
    revealed,
    editing,
    setEditing,
    removing,
    setRemoving,
    importing,
    setImporting,
    unlocked,
    busy,
    act,
    menu,
    startImport,
    toggleImport,
    finishImport,
    save,
    removeFromVault,
    lock,
    conflicts,
    keepMine,
    keepTheirs,
  };
}
