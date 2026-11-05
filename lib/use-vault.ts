"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { IDLE_LOCK_MS, vaultBridge, type VaultOverview } from "./vault-view";

// The vaults of the board's folders, from Electron main. Loads again when the folders change and when
// the window comes back into focus, so the rail's nudge notices a .env.local edited in another app.
export function useVault(folders: string[]) {
  const bridge = vaultBridge();
  const [overview, setOverview] = useState<VaultOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = folders.join("\n");

  const reload = useCallback(() => (bridge && key ? show(bridge.overview(key.split("\n")), setOverview, setError) : Promise.resolve()), [bridge, key]);

  useEffect(() => {
    if (!bridge || !key) return;
    const load = () => void show(bridge.overview(key.split("\n")), setOverview, setError);
    load();
    window.addEventListener("focus", load);
    // A hand edit to a managed .env.local, from main's watcher.
    const stop = bridge.onChange?.(load);
    return () => {
      window.removeEventListener("focus", load);
      stop?.();
    };
  }, [bridge, key]);

  // A shared vault's server version: it moves when a teammate writes, and the next pull is what
  // brings that write in. When it moves, load once more so the drawer shows the new state — the
  // pull that filled the shadow may have run before the drawer was listening.
  const versions = serverVersions(overview);
  const seen = useRef(versions);
  const stamp = JSON.stringify(versions);
  useEffect(() => {
    const before = seen.current;
    seen.current = JSON.parse(stamp) as Record<string, number>;
    if (moved(before, seen.current)) void reload();
  }, [stamp, reload]);

  return { bridge, overview, error, reload };
}

// Each shared vault's server version, by vault id. A local vault isn't in it.
function serverVersions(overview: VaultOverview | null): Record<string, number> {
  const versions: Record<string, number> = {};
  for (const vault of overview?.vaults ?? []) if (vault.shared) versions[vault.id] = vault.shared.serverVersion;
  return versions;
}

// Whether any shared vault's server version moved since the last look.
function moved(before: Record<string, number>, after: Record<string, number>) {
  const ids = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const id of ids) if (before[id] !== after[id]) return true;
  return false;
}

// ⇧S and the palette's Add a secret: open the 🔐 drawer and ask it for its Add form. The drawer may not be
// open yet, or still loading its vaults, so the ask waits for a taker (onSecretAsk) that can serve it.
let secretAsked = false;
let secretTaker: (() => boolean) | null = null;

export function addSecret(openDrawer: (panel: "vault") => void) {
  openDrawer("vault");
  secretAsked = !secretTaker?.();
}

// The drawer's taker opens its Add form and says whether it could; the returned function unsubscribes.
export function onSecretAsk(take: () => boolean): () => void {
  secretTaker = take;
  if (secretAsked) secretAsked = !take();
  return () => {
    if (secretTaker === take) secretTaker = null;
  };
}

function show(load: Promise<VaultOverview>, setOverview: (o: VaultOverview) => void, setError: (e: string | null) => void) {
  return load.then(
    (overview) => {
      setOverview(overview);
      setError(null);
    },
    (err: unknown) => setError(err instanceof Error ? err.message : String(err)),
  );
}

// Calls onIdle once nothing has been clicked or typed for ms while active; any input starts the wait over.
export function useIdle(active: boolean, onIdle: () => void, ms = IDLE_LOCK_MS) {
  const latest = useRef(onIdle);
  useEffect(() => {
    latest.current = onIdle;
  });
  useEffect(() => {
    if (!active) return;
    let timer = setTimeout(() => latest.current(), ms);
    const restart = () => {
      clearTimeout(timer);
      timer = setTimeout(() => latest.current(), ms);
    };
    window.addEventListener("pointerdown", restart);
    window.addEventListener("keydown", restart);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("pointerdown", restart);
      window.removeEventListener("keydown", restart);
    };
  }, [active, ms]);
}
