// Your account's settings, from this Mac to your Weft Workers (docs/architecture/project-hosts.md#settings-on-a-worker-wp3):
// the ACCOUNT_SETTINGS fields (lib/host-settings.ts accountSettings), written to your own account_settings row whenever
// Settings saves and once a little after the server starts, signed by this Mac's device key through Electron main
// (electron/settings-sign.cjs; lib/account-settings-sig.ts says what over). Each worker reads the row with its key and
// mirrors it only when the Mac it was paired with signed it (lib/worker-settings-sync.ts). Signed out, outside the
// desktop app (nothing to sign with), or a database without the table yet, it does nothing and says nothing: the board
// works the same, and the worker keeps what it last mirrored.
import type { SupabaseClient } from "@supabase/supabase-js";
import { accountClient } from "./account";
import { settingsDigest } from "./account-settings-sig";
import { shell } from "./browser-shell";
import { accountSettings } from "./host-settings";

export type SettingsSigner = (body: { userId: string; version: number; digest: string }) => Promise<{ signature?: unknown }>;

const mainSigns: SettingsSigner = (body) => shell("/account-settings/sign", body);

// What was last pushed and for whom, so a save that changed only this Mac's own settings sends nothing, and a sign-in
// as someone else still writes their row.
let pushed: string | null = null;
// The version only grows, even if the clock steps back, so a worker never sees this Mac's newer settings as older.
let lastVersion = 0;

export async function pushAccountSettings(given?: SupabaseClient, sign: SettingsSigner = mainSigns): Promise<boolean> {
  try {
    const client = given ?? accountClient();
    const { data } = await client.auth.getSession();
    const uid = data.session?.user.id;
    if (!uid) return false;
    // As it'll come back from jsonb: what JSON drops (an undefined) isn't signed either.
    const settings = JSON.parse(JSON.stringify(accountSettings())) as Record<string, unknown>;
    const text = `${uid}:${JSON.stringify(settings)}`;
    if (text === pushed) return false;
    const version = Math.max(Date.now(), lastVersion + 1);
    const { signature } = await sign({ userId: uid, version, digest: settingsDigest(settings) });
    if (typeof signature !== "string" || !signature) return false;
    const { error } = await client.from("account_settings").upsert({ user_id: uid, settings, version, signature, updated_at: new Date().toISOString() });
    if (error) return false;
    pushed = text;
    lastVersion = version;
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
