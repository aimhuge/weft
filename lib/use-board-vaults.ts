"use client";

import { useEffect, useState } from "react";
import { api } from "./client";
import { useVault } from "./use-vault";

// Every board project's vault, for Settings → Secrets: the board's folders (GET /api/settings), then the same overview
// the 🔐 drawer reads from Electron main (lib/use-vault.ts). Metadata only.
export function useBoardVaults() {
  const [folders, setFolders] = useState<string[]>([]);
  useEffect(() => {
    const live = { on: true };
    api.settings().then(
      (s) => live.on && setFolders(s.projects.map((p) => p.path)),
      () => live.on && setFolders([]),
    );
    return () => {
      live.on = false;
    };
  }, []);
  return useVault(folders);
}
