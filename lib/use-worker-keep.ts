"use client";

// What this Mac kept on a paired worker (docs/architecture/secrets.md#kept-on-a-worker), reached through
// window.weft.workerKeep in Electron main (electron/worker-keep.cjs). Kept secrets are off by default and have no
// button since 2026-11-11 ("i dont know what those things mean"): each secret use on a worker asks this Mac. What's left
// here is the wipe Forget and Revoke send first, for a worker that kept a set before then (lib/use-devices.ts revokeNow).

export interface WorkerKeepBridge {
  wipe(worker: string): Promise<{ sent: boolean; name: string }>;
}

export const workerKeepBridge = (): WorkerKeepBridge | undefined =>
  typeof window === "undefined" ? undefined : (window as unknown as { weft?: { workerKeep?: WorkerKeepBridge } }).weft?.workerKeep;
