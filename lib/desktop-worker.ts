// The desktop as a headed worker (docs/architecture/weft-worker.md#the-desktop-as-a-headed-worker): while this Mac
// listens for the web board's commands (lib/cloud-inbox.ts), it beats into public.cloud_workers so Settings → Sync →
// Workers lists it beside the headless workers. The beat rides the inbox's 30 s check; a Mac that sleeps, signs out or
// stops syncing simply stops beating and reads as offline a minute later.
import os from "node:os";
import type { SupabaseClient } from "@supabase/supabase-js";
import { syncOrgId } from "./cloud-sync";
import { deviceId } from "./device-id";
import { sessions } from "./runner-state";

// The Mac's name as the list shows it: its host name without the .local suffix.
export const desktopName = (host = os.hostname()) => host.replace(/\.local$/i, "").slice(0, 80) || "This Mac";

const busy = () => [...sessions.values()].some((s) => s.busy);

// One beat. Never throws: a database without desktop_worker_beat yet, or a dropped network, only means this Mac
// doesn't show in the list this time.
export async function beatDesktopWorker(client: SupabaseClient, uid: string): Promise<void> {
  try {
    const org = await syncOrgId(client, uid);
    if (!org) return;
    const { error } = await client.rpc("desktop_worker_beat", {
      p_org: org,
      p_device: deviceId(),
      p_name: desktopName(),
      p_platform: process.platform,
      p_arch: process.arch,
      p_status: busy() ? "busy" : "online",
    });
    if (error) console.warn(`Desktop worker: ${error.message}`);
  } catch (err) {
    console.warn(`Desktop worker: ${(err as Error).message}`);
  }
}
