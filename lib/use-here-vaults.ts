"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "./client";
import { repoOf } from "./vault-shared";
import { vaultBridge, type VaultBridge, type VaultSummary } from "./vault-view";

// This Mac's own vaults for the board's projects, by repo, for the team page's project rows: whether this Mac holds
// the secrets (so its Share secrets can run here) and the shared vault's waiting asks (so Approve can). The same
// overview the 🔐 drawer reads, from Electron main; metadata only. Null in a plain browser (weft.zip), where there's
// no main to ask.
export function useHereVaults(active: boolean): { bridge: VaultBridge | null; byRepo: Map<string, VaultSummary>; reload: () => void } {
  const bridge = vaultBridge();
  const [byRepo, setByRepo] = useState<Map<string, VaultSummary>>(new Map());
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  useEffect(() => {
    if (!active || !bridge) return;
    const live = { on: true };
    void (async () => {
      try {
        const settings = await api.settings();
        const overview = await bridge.overview(settings.projects.map((p) => p.path));
        const map = new Map<string, VaultSummary>();
        for (const v of overview.vaults) if (repoOf(v.id) && !map.has(repoOf(v.id))) map.set(repoOf(v.id), v);
        if (live.on) setByRepo(map);
      } catch {
        if (live.on) setByRepo(new Map());
      }
    })();
    return () => {
      live.on = false;
    };
  }, [active, bridge, tick]);
  return { bridge, byRepo, reload };
}
