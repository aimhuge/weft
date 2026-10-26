"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "./api-client";

// The New thread dialog's isolate menu (components/IsolateMenu.tsx, docs/architecture/worktrees.md): shared by
// default, so a shared card's start path never touches git. A worktree warms the folder's pool so Start takes a ready
// one, on its own weft/* branch or one you picked or named (`branch`, "" for its own). It's suggested when other cards
// are busy in the folder (passed in) or the prompt is long enough to be a big change.

export const BIG_PROMPT = 1500;

export function suggestIsolate(busyHere: number, promptLength: number): boolean {
  return busyHere > 0 || promptLength > BIG_PROMPT;
}

function warm(cwd: string) {
  void apiFetch("/api/worktrees", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cwd }) }).catch(() => {});
}

export function useIsolate(cwd: string) {
  const [isolated, setIsolated] = useState(false);
  // A branch belongs to its repo: picked for one folder, another folder starts back on the card's own.
  const [picked, setPicked] = useState({ cwd, name: "" });
  const branch = picked.cwd === cwd ? picked.name : "";
  const [promptLength, setPromptLength] = useState(0);
  // Warmed when it goes on, and again when the folder changes while it's on.
  useEffect(() => {
    if (isolated && cwd) warm(cwd);
  }, [isolated, cwd]);
  const toggleIsolated = useCallback(() => setIsolated((v) => !v), []);
  // Picking a branch picks a worktree too: a branch is only for one.
  const pickBranch = useCallback(
    (name: string) => {
      setPicked({ cwd, name });
      setIsolated(true);
    },
    [cwd],
  );
  const notePrompt = useCallback((markdown: string) => setPromptLength(markdown.length), []);
  return { isolated, setIsolated, toggleIsolated, branch, pickBranch, promptLength, notePrompt };
}
