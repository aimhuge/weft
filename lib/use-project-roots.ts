"use client";

import { useCallback, useRef, useState } from "react";
import { api } from "./client";
import { worktreeParent } from "./format";

// Worktree folder -> its main repo, from the server, so the project bar shows each worktree's cards under that repo
// (components/Board.tsx). `rootOf` reads it; `resolveFolders` asks the server again for a folder it hasn't seen yet,
// in case it's a worktree, once per folder.
export function useProjectRoots() {
  const [roots, setRoots] = useState<Record<string, string>>({});
  // Folders the server has already resolved into roots.
  const resolvedFolders = useRef(new Set<string>());
  const rootOf = useCallback((cwd: string) => roots[cwd] ?? worktreeParent(cwd) ?? cwd, [roots]);
  const resolveFolders = useCallback((folders: string[]) => {
    const fresh = folders.filter((f) => !resolvedFolders.current.has(f) && !worktreeParent(f));
    if (!fresh.length) return;
    for (const f of fresh) resolvedFolders.current.add(f);
    api
      .list()
      .then((data) => setRoots(data.roots))
      .catch(() => {});
  }, []);
  return { setRoots, resolvedFolders, rootOf, resolveFolders };
}
