// Your account's settings, from this Mac to your Weft Workers (docs/architecture/project-hosts.md#settings-on-a-worker-wp3):
// the ACCOUNT_SETTINGS fields (lib/host-settings.ts accountSettings), written to your own account_settings row whenever
// Settings saves and once a little after the server starts. Each worker reads the row with its key and mirrors it
// (lib/worker-settings-sync.ts). Signed out, or a database without the table yet, it does nothing and says nothing:
// the board works the same, and the worker keeps what it last mirrored.
import type { SupabaseClient } from "@supabase/supabase-js";
import { accountClient } from "./account";
import { accountSettings } from "./host-settings";

// What was last pushed, so a save that changed only this Mac's own settings sends nothing.
let pushed: string | null = null;

export async function pushAccountSettings(given?: SupabaseClient): Promise<boolean> {
  try {
    const client = given ?? accountClient();
    const { data } = await client.auth.getSession();
    const uid = data.session?.user.id;
    if (!uid) return false;
    const settings = accountSettings();
    const text = JSON.stringify(settings);
    if (text === pushed) return false;
    const { error } = await client.from("account_settings").upsert({ user_id: uid, settings, updated_at: new Date().toISOString() });
    if (error) return false;
    pushed = text;
    return true;
  } catch {
    return false;
  }
}

/** Forgets what was pushed (tests, and a sign-in as someone else). */
export function forgetPushedSettings() {
  pushed = null;
}

const FIRST_PUSH_MS = 20_000;

// Server start: one push once the account has had time to load, so a worker sees settings saved before this feature.
export function startAccountSettingsPush(push: () => Promise<unknown> = pushAccountSettings): () => void {
  const timer = setTimeout(() => void push(), FIRST_PUSH_MS);
  timer.unref();
  return () => clearTimeout(timer);
}
