"use client";

// The 🔐 drawer's conflicts: the writes that lost against a teammate's, and the two ways out of
// one (docs/architecture/teams-vault.md, "Push on change" and "What the 🔐 drawer shows").
//
// A conflict is per-secret and transient: the banner sits on that secret's row, survives the reload
// the conflicted write itself caused, and goes away on the re-render that follows the next reload.
//
// The value the user typed never reaches the page: it waits here, so "Keep your edit" can write it
// again without the banner ever holding it.

import { useCallback, useEffect, useRef, useState } from "react";
import type { VaultBridge, VaultConflict } from "@/lib/vault-view";
import type { Editing } from "@/lib/vault-row-types";

// A conflict and the edit that lost against it.
export interface ConflictState {
  conflict: VaultConflict;
  // The project folder the write went to, for the re-push.
  folder: string;
  // The value the user typed, for "Keep your edit".
  value: string;
}

// The conflicts the drawer holds, and the two ways out of one.
export interface VaultConflicts {
  // The conflicts by secret: key `${vault.id}\n${environment}\n${name}`.
  conflicts: Map<string, VaultConflict>;
  // Remember a write that lost, so the row shows the banner.
  record: (vaultId: string, name: string, environment: string, conflict: VaultConflict, edit: Editing) => void;
  // "Keep your edit": write the same value again, against the row's current version. Answers
  // "conflict" when it lost again (the banner stays), "saved" when it went through.
  keepMine: (key: string) => Promise<"saved" | "conflict" | "none">;
  // "Keep theirs": take the server's row, which is already in the shadow, and write nothing.
  keepTheirs: (key: string) => void;
}

// A secret's conflict key: the vault, the environment and the name.
export function conflictKey(vaultId: string, name: string, environment: string) {
  return `${vaultId}\n${environment}\n${name}`;
}

// The conflicts of the writes that lost against a teammate's, and the edits behind them.
//
// `overview` is the vaults the drawer shows: a new one means the vaults were reloaded. The banner
// survives the reload the conflicted write caused, and the re-render after the next reload takes it
// away (docs/architecture/teams-vault.md, "What the 🔐 drawer shows").
export function useVaultConflicts(bridge: VaultBridge | null, overview: object | null): VaultConflicts {
  const [conflicts, setConflicts] = useState<Map<string, ConflictState>>(new Map());
  // The conflicts as the last render left them: "Keep your edit" reads the pending edit from
  // here, so its callback doesn't change on every render.
  const current = useRef(conflicts);
  // How many re-renders the banner still survives: the reload the conflicted write caused.
  const survives = useRef(0);
  // The overview the last re-render saw, so a re-render with the same one changes nothing.
  const seen = useRef<object | null>(null);

  useEffect(() => {
    current.current = conflicts;
  }, [conflicts]);

  useEffect(() => {
    if (overview === seen.current) return;
    seen.current = overview;
    if (survives.current > 0) {
      survives.current -= 1;
      return;
    }
    // The banner goes away with the reload. Nothing to take away is no state change, so no
    // extra render — and no loop, when the drawer is handed a fresh overview every render.
    setConflicts((cur) => (cur.size ? new Map() : cur));
  }, [overview]);

  const record = useCallback((vaultId: string, name: string, environment: string, conflict: VaultConflict, edit: Editing) => {
    setConflicts((cur) => new Map(cur).set(conflictKey(vaultId, name, environment), { conflict, folder: edit.folder, value: edit.value }));
    // The reload that follows this write keeps the banner; the next one takes it away.
    survives.current = 1;
  }, []);

  // "Keep your edit": the same value, written again against the row's current version, which the
  // server's conflict already recorded — so the write goes through instead of losing again.
  const keepMine = useCallback(
    async (key: string) => {
      const state = current.current.get(key);
      if (!bridge || !state) return "none";
      const result = await bridge.set(state.folder, state.conflict.name, state.conflict.environment, state.value);
      // It lost again (someone wrote in between): the banner stays, with the newer row.
      if ("saved" in result && !result.saved) {
        setConflicts((cur) => new Map(cur).set(key, { ...state, conflict: result.conflict }));
        survives.current = 1;
        return "conflict";
      }
      setConflicts((cur) => dropKey(cur, key));
      return "saved";
    },
    [bridge],
  );

  // "Keep theirs": the server's row is already in the shadow, so there is nothing to write — the
  // edit is dropped and the list shows what the vault holds.
  const keepTheirs = useCallback((key: string) => {
    setConflicts((cur) => dropKey(cur, key));
  }, []);

  return {
    conflicts: new Map(Array.from(conflicts, ([key, state]) => [key, state.conflict])),
    record,
    keepMine,
    keepTheirs,
  };
}

// The same map without one key.
function dropKey(map: Map<string, ConflictState>, key: string) {
  const next = new Map(map);
  next.delete(key);
  return next;
}
