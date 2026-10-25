"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "./client";
import type { CloudSyncStatus } from "./cloud-sync-view";
import { finishedCount, promptFolder, promptOff, shouldAsk, turnPromptOff } from "./sync-prompt";
import type { Card } from "./types";
import { loadWelcome } from "./welcome-client";

// When the "Turn on Project Sync?" dialog opens and what it answers with (lib/sync-prompt.ts has the rules).
// Once a launch: the flag lives in the module, so the badges remounting doesn't ask twice.
let askedThisLaunch = false;

export function useSyncPrompt(cwd: string | null | undefined, cards: Card[]) {
  const folder = promptFolder(cwd, cards);
  // Read again as threads finish, so first launch's dialog is noticed once it's answered.
  const finished = finishedCount(cards);
  const [sync, setSync] = useState<{ folders: string[]; status: CloudSyncStatus } | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  // Nothing is fetched until there's a project to ask about, and nothing once it's been asked or switched off.
  useEffect(() => {
    if (!folder || askedThisLaunch || promptOff()) return;
    let live = true;
    void loadWelcome()
      .then((view) => (view.welcome ? api.cloudSync() : null))
      .then((answer) => {
        if (!live || !answer) return;
        setSync(answer);
        if (!shouldAsk({ folder, synced: answer.folders, welcomed: true, off: promptOff(), asked: askedThisLaunch })) return;
        askedThisLaunch = true;
        setOpen(folder);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [folder, finished]);

  // While it's open, coming back to the window (from GitHub's sign-in, the web board) reads the status again.
  useEffect(() => {
    if (!open) return;
    const reload = () => void api.cloudSync().then(setSync).catch(() => {});
    window.addEventListener("focus", reload);
    return () => window.removeEventListener("focus", reload);
  }, [open]);

  const close = useCallback((neverAgain: boolean) => {
    if (neverAgain) turnPromptOff();
    setOpen(null);
  }, []);

  // Only called from the open dialog, which passes the folder it shows.
  const syncIt = useCallback(async (folder: string) => {
    const answer = await api.cloudSyncSetFolder(folder, true);
    setSync({ folders: answer.folders, status: answer.status });
    setOpen(null);
  }, []);

  return { folder: open, status: sync?.status ?? null, close, syncIt };
}

// Tests only: a fresh launch.
export function resetAskedForTests() {
  askedThisLaunch = false;
}
