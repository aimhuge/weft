"use client";

import { useCrons } from "./use-crons";
import { useWebhooks } from "./use-webhooks";

// What the rail's ⏰ and 🪝 show (components/LibraryRail.tsx). On one of this Mac's projects, or none: every cron, and
// the board's folders' webhooks. On a Weft Worker's project (its worker:// path): that worker's own, which it publishes
// (lib/worker-lists-read.ts) and the drawers change there (lib/worker-list-acts.ts).
export function useRailLists(workerProject: string | null | undefined, folders: string[], hooksOpen: boolean) {
  const worker = workerProject ?? null;
  const hookFolders = worker ? [worker] : folders;
  const webhooks = useWebhooks(hookFolders, hooksOpen);
  const all = useCrons();
  const crons = worker ? { ...all, crons: all.crons.filter((c) => c.cwd === worker) } : all;
  return { webhooks, hookFolders, hookProject: worker, crons };
}
