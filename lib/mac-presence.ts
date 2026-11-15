// This Mac's presence for phone push (docs/architecture/mobile.md#push). Every minute, while cloud sync is on and an
// account is signed in, upserts public.device_presence (supabase/migrations/20261115052031_push_presence.sql) with
// how long the keyboard and mouse have been idle, read from Electron main's powerMonitor over the control server
// (POST /system/idle, electron/pane-routes.cjs). The push-card Edge Function holds a push while a Mac is in use
// (supabase/functions/push-card/away.ts). Anything missing (sync off, signed out, offline, no desktop shell) skips
// the beat quietly: no row is "away", so a push is never lost to it.
import type { SupabaseClient } from "@supabase/supabase-js";
import { accountClient } from "./account";
import { shell } from "./browser-shell";
import { deviceId } from "./device-id";
import { syncFolders } from "./settings";

export const PRESENCE_EVERY_MS = 60_000;
const TABLE = "device_presence";

export interface PresenceDeps {
  client: () => SupabaseClient | null;
  idleSeconds: () => Promise<number | null>;
  syncOn: () => boolean;
  deviceId: () => string;
}

function safeClient(): SupabaseClient | null {
  try {
    return accountClient();
  } catch {
    return null;
  }
}

async function shellIdle(): Promise<number | null> {
  if (!process.env.WEFT_SHELL_URL) return null;
  const { idleSeconds } = await shell("/system/idle");
  return typeof idleSeconds === "number" && Number.isFinite(idleSeconds) ? Math.max(0, Math.round(idleSeconds)) : null;
}

const DEFAULTS: PresenceDeps = { client: safeClient, idleSeconds: shellIdle, syncOn: () => syncFolders().length > 0, deviceId };

// One beat. Resolves whether a row went up; never rejects.
export async function beatPresence(deps: PresenceDeps = DEFAULTS): Promise<boolean> {
  try {
    if (!deps.syncOn()) return false;
    const client = deps.client();
    if (!client) return false;
    const { data } = await client.auth.getSession();
    const user = data.session?.user.id;
    if (!user) return false;
    const idle = await deps.idleSeconds();
    if (idle === null) return false;
    // updated_at is stamped by the database (device_presence_stamp), so this Mac's clock doesn't matter.
    const { error } = await client.from(TABLE).upsert({ user_id: user, device_id: deps.deviceId(), idle_seconds: idle }, { onConflict: "user_id,device_id" });
    return !error;
  } catch {
    return false;
  }
}

// From startAccountCloudSync (lib/cloud-sync-start.ts).
export function startMacPresence(deps: PresenceDeps = DEFAULTS): () => void {
  void beatPresence(deps);
  const tick = setInterval(() => void beatPresence(deps), PRESENCE_EVERY_MS);
  tick.unref();
  return () => clearInterval(tick);
}
