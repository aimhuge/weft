"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "./api-client";

// The New thread dialog's Isolated switch (docs/architecture/worktrees.md): off by default, so a shared card's start
// path never touches git. On, it warms the folder's worktree pool so Start takes a ready one. It's suggested when other
// cards are busy in the folder (passed in) or the prompt is long enough to be a big change.

export const BIG_PROMPT = 1500;

export function suggestIsolate(busyHere: number, promptLength: number): boolean {
  return busyHere > 0 || promptLength > BIG_PROMPT;
}

function warm(cwd: string) {
  void apiFetch("/api/worktrees", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cwd }) }).catch(() => {});
}

export function useIsolate(cwd: string) {
  const [isolated, setIsolated] = useState(false);
  const [promptLength, setPromptLength] = useState(0);
  // Warmed when it goes on, and again when the folder changes while it's on.
  useEffect(() => {
    if (isolated && cwd) warm(cwd);
  }, [isolated, cwd]);
  const toggleIsolated = useCallback(() => setIsolated((v) => !v), []);
  const notePrompt = useCallback((markdown: string) => setPromptLength(markdown.length), []);
  return { isolated, toggleIsolated, promptLength, notePrompt };
}
