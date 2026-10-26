"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "./api-client";
import { validBranch } from "./branch-name";

// The New thread dialog's branch picker (components/IsolateMenu.tsx): the folder's repo's local branches from
// GET /api/worktrees, read when the menu opens (and again for a new folder while it's open), plus what to show for
// a typed search. docs/architecture/worktrees.md.

export interface Branch {
  name: string;
  // Unix seconds of its last commit.
  at: number;
  // Where it's checked out, when it is: git won't check it out in a second worktree.
  worktree?: string;
}

export function useBranches(cwd: string, open: boolean): Branch[] | null {
  const [branches, setBranches] = useState<Branch[] | null>(null);
  useEffect(() => {
    if (!open || !cwd) return;
    let live = true;
    apiFetch(`/api/worktrees?cwd=${encodeURIComponent(cwd)}`)
      .then((r) => r.json() as Promise<{ branches?: Branch[] }>)
      .then((j) => live && setBranches(j.branches ?? []))
      .catch(() => live && setBranches([]));
    return () => {
      live = false;
    };
  }, [cwd, open]);
  return branches;
}

// The branches a search matches (all of them for none), and the new name it offers to create: a valid name no branch has.
export function matchBranches(branches: Branch[], query: string): { matches: Branch[]; create: string | null } {
  const q = query.trim();
  const matches = q ? branches.filter((b) => b.name.toLowerCase().includes(q.toLowerCase())) : branches;
  const create = q && validBranch(q) && !branches.some((b) => b.name === q) ? q : null;
  return { matches, create };
}
