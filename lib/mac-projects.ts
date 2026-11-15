// This Mac's projects, published for the threads on the user's Weft Workers (docs/architecture/project-hosts.md#board-tools-on-a-worker).
// A worker thread's create_card found a Mac project only by the folders of its synced cards, so a project just added on
// the Mac (no cards yet) was "No project" there. The Mac now publishes the folders it would take a card for (the ones
// Sync is on for: lib/cloud-inbox-cards.ts syncFolderFor refuses the rest) and its home folder, so `~/dev/app` from a
// worker means this Mac's ~. Never the projects Sync is off for: their paths stay on this Mac. Written to
// cloud_mac_projects with the account's own session (owner-only); worker_mac_projects hands them to the owner's workers.
import os from "node:os";
import type { SupabaseClient } from "@supabase/supabase-js";
import { accountClient } from "./account";
import { deviceId } from "./device-id";
import { createMacPublisher, REPUBLISH_MS, startMacPublish } from "./mac-publish";
import { syncFolders } from "./settings";

export const MAC_PROJECT_CAP = 200;
// The Sync switch fires no bus event, so the list is read this often and sent when it changed (or every REPUBLISH_MS).
export const CHECK_MS = 60_000;

export interface MacProjects {
  home: string;
  folders: string[];
}

export const macProjects = (folders: string[] = syncFolders(), home = os.homedir()): MacProjects => ({ home, folders: folders.slice(0, MAC_PROJECT_CAP) });

// Upserts this Mac's row; false when there's no session to write it with.
export async function putMacProjects(value: MacProjects, client: SupabaseClient = accountClient(), device = deviceId()): Promise<boolean> {
  const { data } = await client.auth.getSession();
  const uid = data.session?.user.id;
  if (!uid) return false;
  const row = { owner_user: uid, device, home: value.home, folders: value.folders, updated_at: new Date().toISOString() };
  const { error } = await client.from("cloud_mac_projects").upsert(row, { onConflict: "owner_user,device" });
  if (error) throw new Error(error.message);
  return true;
}

// put, skipped when the value is what went last and went less than REPUBLISH_MS ago.
export function changedOnly(put: (value: MacProjects) => Promise<unknown>, now: () => number = Date.now) {
  let last: { key: string; at: number } | null = null;
  return async (value: MacProjects) => {
    const key = JSON.stringify(value);
    if (last?.key === key && now() - last.at < REPUBLISH_MS) return;
    await put(value);
    last = { key, at: now() };
  };
}

export interface MacProjectsDeps {
  read: () => MacProjects;
  put: (value: MacProjects) => Promise<unknown>;
  log?: (msg: string) => void;
  delayMs?: number;
}

// Once per server process, from the board's prewarm (lib/copilot.ts). Answers the way to stop it.
export function startMacProjectsPublish(deps: Partial<MacProjectsDeps> = {}, every = CHECK_MS): () => void {
  const { put = (value: MacProjects) => putMacProjects(value), ...rest } = deps;
  const publisher = createMacPublisher({ what: "projects", read: () => macProjects(), ...rest, put: changedOnly(put) });
  return startMacPublish(publisher, (event) => event.type === "projects", every);
}
