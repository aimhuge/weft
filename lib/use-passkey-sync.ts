"use client";

// Keeps every worker's trusted passkeys in step with this Mac from the board itself, not only while Settings → Devices
// is open (lib/passkey-sync.ts): one timer for the window however many places watch, and one list of the workers that
// haven't confirmed yet, which the header's Settings button marks and Settings → Devices names per worker.
import { useEffect, useSyncExternalStore } from "react";
import { syncPasskeys } from "./passkey-sync";
import { canSignWiden } from "./widen-signer";

export const SYNC_EVERY_MS = 30_000;

let untaken: string[] = [];
let running: Promise<string[]> | null = null;
let watchers = 0;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function publish(next: string[]) {
  if (next.length === untaken.length && next.every((w, i) => w === untaken[i])) return;
  untaken = next;
  for (const listener of [...listeners]) listener();
}

// One sync at a time: a call while one runs gets that one's answer. [] without the desktop app's signer.
export function runPasskeySync(sync: () => Promise<string[]> = syncPasskeys): Promise<string[]> {
  if (!canSignWiden()) return Promise.resolve([]);
  running ??= sync()
    .then((left) => {
      publish(left);
      return left;
    })
    .catch(() => untaken)
    .finally(() => {
      running = null;
    });
  return running;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

// The workers that don't hold this Mac's latest passkey set yet; while `on`, keeps syncing every SYNC_EVERY_MS.
export function usePasskeySync(on = true): string[] {
  useEffect(() => {
    if (!on) return;
    watchers += 1;
    if (watchers === 1) {
      void runPasskeySync();
      timer = setInterval(() => void runPasskeySync(), SYNC_EVERY_MS);
    }
    return () => {
      watchers -= 1;
      if (watchers === 0 && timer) {
        clearInterval(timer);
        timer = null;
      }
    };
  }, [on]);
  return useSyncExternalStore(subscribe, () => untaken, () => untaken);
}
