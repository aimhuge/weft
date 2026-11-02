// A host's own settings, for Settings → Threads on a chosen worker (docs/architecture/project-hosts.md#settings-on-a-worker-wp3):
// settings.get reads them, settings.put saves a patch of them. Both are elevated and name no card. Only HOST_SETTINGS
// (@weft/client) pass; allowed folders, modes and guards are never among them (lib/host-settings.ts).
import { applyHostSettings, hostSettings } from "../host-settings";
import type { HostSettings } from "@weft/client";
import { settle } from "./types";

export type SettingsReply = { settings: HostSettings };

export function settingsGetVerb(): Promise<SettingsReply> {
  return settle(() => ({ settings: hostSettings() }));
}

export async function settingsPutVerb({ patch }: { patch?: unknown }): Promise<SettingsReply> {
  const before = hostSettings().maxThreads;
  const settings = applyHostSettings(patch);
  // A higher cap lets the threads waiting for a slot go now, as the settings route does.
  if (settings.maxThreads !== before) (await import("../runner")).freeSlots();
  return { settings };
}
