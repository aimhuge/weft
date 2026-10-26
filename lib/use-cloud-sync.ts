"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CloudSyncStatus } from "./cloud-sync-view";
import { api } from "./client";

// The Settings → Sync page (components/SyncSettings.tsx) polls this every POLL_MS while open, and the avatar
// (components/AccountButton.tsx) every IDLE_POLL_MS for its dot, POLL_MS while its menu is open. The page
// itself is what shows the status: waiting, lastSyncAt, uploaded, the last error, and the signed-out /
// no-workspace flags. A failing fetch surfaces the server's error to the page; the empty-state shape
// is what the page shows before the first answer lands.
export const POLL_MS = 5000;
export const IDLE_POLL_MS = 30_000;
// How often the avatar asks: quickly while its menu shows the status, slowly just to keep its dot true.
export const avatarPollMs = (menuOpen: boolean) => (menuOpen ? POLL_MS : IDLE_POLL_MS);

const EMPTY: CloudSyncStatus = { waiting: 0, lastSyncAt: null, uploaded: 0, lastError: null, signedOut: false, noWorkspace: false };

export function useCloudSync(active = false, pollMs = POLL_MS) {
  const [folders, setFolders] = useState<string[]>([]);
  const [status, setStatus] = useState<CloudSyncStatus>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  // The newest fetch wins; the answer is dropped if folders have since changed (we don't filter on folders,
  // but the latest-ref pattern matches the other polling hooks in lib/).
  const latest = useRef(0);

  const reload = useCallback(async () => {
    const mine = ++latest.current;
    try {
      const answer = await api.cloudSync();
      if (mine !== latest.current) return;
      setFolders(answer.folders);
      setStatus(answer.status);
      setError(null);
    } catch (err) {
      if (mine === latest.current) setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    const load = () => void reload();
    load();
    window.addEventListener("focus", load);
    const poll = active ? setInterval(load, pollMs) : null;
    return () => {
      window.removeEventListener("focus", load);
      if (poll) clearInterval(poll);
    };
  }, [reload, active, pollMs]);

  // Turn a folder on or off: the switch flips at once, then the server's answer (the new list and the live status)
  // replaces it. A refusal (a folder that isn't on the board 400s) reloads what the server has.
  const setFolder = useCallback(
    async (folder: string, on: boolean) => {
      // A poll that left before the click would answer with the old list.
      latest.current++;
      setFolders((list) => (on ? [...list.filter((f) => f !== folder), folder] : list.filter((f) => f !== folder)));
      try {
        const answer = await api.cloudSyncSetFolder(folder, on);
        setFolders(answer.folders);
        setStatus(answer.status);
      } catch (err) {
        void reload();
        throw err;
      }
    },
    [reload],
  );

  // Ask for an immediate flush. The page shows the status from the answer; the poll will catch up.
  const syncNow = useCallback(async () => {
    const answer = await api.cloudSyncNow();
    setStatus(answer.status);
  }, []);

  return { folders, status, error, reload, setFolder, syncNow };
}
