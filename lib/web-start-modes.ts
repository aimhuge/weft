"use client";

// What each of your Macs starts a thread from weft.zip in when the form names no mode (docs/architecture/new-card-parity.md):
// its own default held to its web rule, which it publishes in its desktop-worker row (lib/desktop-worker.ts
// publishStartMode). The New thread dialog opens on it, so the menu shows the mode the thread will really start in,
// while sending none until you pick one.
import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PermissionMode } from "./types";

const MODES: readonly string[] = ["default", "acceptEdits", "auto"];

export interface WorkerModeRow {
  device: string | null;
  capabilities: unknown;
}

// The published mode by device, for the rows that carry a valid one.
export function startModesOf(rows: WorkerModeRow[]): Record<string, PermissionMode> {
  const modes: Record<string, PermissionMode> = {};
  for (const row of rows) {
    const mode = row.capabilities && typeof row.capabilities === "object" ? (row.capabilities as { startMode?: unknown }).startMode : undefined;
    if (row.device && typeof mode === "string" && MODES.includes(mode)) modes[row.device] = mode as PermissionMode;
  }
  return modes;
}

// Read once while the dialog is open; nothing (so the dialog keeps its own guess) until it lands, or if it can't.
export function useStartModes(client: SupabaseClient, orgId: string): Record<string, PermissionMode> {
  const [modes, setModes] = useState<Record<string, PermissionMode>>({});
  useEffect(() => {
    let live = true;
    const query = client.from("cloud_workers").select("device, capabilities").eq("org_id", orgId).eq("kind", "desktop");
    void Promise.resolve(query).then(
      ({ data }) => {
        if (live) setModes(startModesOf(data ?? []));
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [client, orgId]);
  return modes;
}
