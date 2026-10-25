"use client";

import { useEffect, useState } from "react";
import type { VercelDrift } from "./vercel-drift";
import { vercelBridge } from "./vercel-view";

// The board folders' vault ⇄ Vercel drift for the 🔐 and ▲ rail badges (lib/vercel-drift.ts). Main answers from its
// cached lists at once and fetches a missing or stale one behind (electron/vercel-env-cache.cjs), so asking when a
// project lands on the board costs no Vercel call here. Asks again when the folders or the vault change (changed),
// on window focus, and when main says a background fetch landed.
export function useVercelDrift(folders: string[], changed: string) {
  const bridge = vercelBridge();
  const [drifts, setDrifts] = useState<VercelDrift[]>([]);
  const key = folders.join("\n");

  useEffect(() => {
    const ask = bridge?.envDrift;
    if (!ask || !key) return;
    let live = true;
    const load = () =>
      void ask(key.split("\n")).then(
        (d) => live && setDrifts(d),
        () => live && setDrifts([]),
      );
    load();
    window.addEventListener("focus", load);
    const stop = bridge.onDrift?.(load);
    return () => {
      live = false;
      window.removeEventListener("focus", load);
      stop?.();
    };
  }, [bridge, key, changed]);

  return drifts;
}
