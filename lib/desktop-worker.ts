// The desktop as a headed worker (docs/architecture/weft-worker.md#the-desktop-as-a-headed-worker): while this Mac
// listens for the web board's commands (lib/cloud-inbox.ts), it beats into public.cloud_workers so Settings → Sync →
// Workers lists it beside the headless workers. The beat is the host core's (lib/host/beat.ts), ticked by the inbox's
// 30 s check; a Mac that sleeps, signs out or stops syncing simply stops beating and reads as offline a minute later.
import os from "node:os";
import type { SupabaseClient } from "@supabase/supabase-js";
import { syncOrgId } from "./cloud-sync";
import { deviceId } from "./device-id";
import { sessions } from "./runner-state";
import type { PermissionMode } from "./types";
import type { WorkerStatus } from "./worker-registry";

// The Mac's name as the list shows it: its host name without the .local suffix.
export const desktopName = (host = os.hostname()) => host.replace(/\.local$/i, "").slice(0, 80) || "This Mac";

// Busy while any thread runs.
export const desktopStatus = (): WorkerStatus => ([...sessions.values()].some((s) => s.busy) ? "busy" : "online");

// One beat. Never throws: a database without desktop_worker_beat yet, or a dropped network, only means this Mac
// doesn't show in the list this time.
export async function beatDesktopWorker(client: SupabaseClient, uid: string, status: WorkerStatus = desktopStatus()): Promise<void> {
  try {
    const org = await syncOrgId(client, uid);
    if (!org) return;
    const { error } = await client.rpc("desktop_worker_beat", {
      p_org: org,
      p_device: deviceId(),
      p_name: desktopName(),
      p_platform: process.platform,
      p_arch: process.arch,
      p_status: status,
    });
    if (error) console.warn(`Desktop worker: ${error.message}`);
  } catch (err) {
    console.warn(`Desktop worker: ${(err as Error).message}`);
  }
}

// The mode last published, so a Mac sends it again only when it changes (a restart sends it once more).
let publishedMode: string | null = null;

// Publishes the mode a thread started from weft.zip with no mode named starts in on this Mac (lib/cloud-inbox-cards.ts
// webStartMode), into its desktop-worker row's capabilities, so the New thread dialog opens on it
// (docs/architecture/new-card-parity.md). Never throws: a database without desktop_worker_start_mode yet, or a dropped
// network, only means the dialog keeps its own guess, and the next beat tries again.
export async function publishStartMode(client: SupabaseClient, mode: PermissionMode): Promise<void> {
  if (mode === publishedMode) return;
  try {
    const { error } = await client.rpc("desktop_worker_start_mode", { p_device: deviceId(), p_mode: mode });
    if (error) console.warn(`Desktop worker start mode: ${error.message}`);
    else publishedMode = mode;
  } catch (err) {
    console.warn(`Desktop worker start mode: ${(err as Error).message}`);
  }
}

// For tests: forget what was published.
export const forgetPublishedMode = () => {
  publishedMode = null;
};
