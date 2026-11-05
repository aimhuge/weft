// Your account's settings, from this Mac to your Weft Workers (docs/architecture/project-hosts.md#settings-on-a-worker-wp3):
// the ACCOUNT_SETTINGS fields (lib/host-settings.ts accountSettings), written to your own account_settings row whenever
// Settings saves and once a little after the server starts, signed by this Mac's device key through Electron main
// (electron/settings-sign.cjs; lib/account-settings-sig.ts says what over). Each worker reads the row with its key and
// mirrors it only when the Mac it was paired with signed it (lib/worker-settings-sync.ts). Signed out, outside the
// desktop app (nothing to sign with), or a database without the table yet, it does nothing and says nothing: the board
// works the same, and the worker keeps what it last mirrored.
import type { SupabaseClient } from "@supabase/supabase-js";
import { accountClient } from "./account";
import { onAgentsSaved } from "./agent-store";
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
    // A row the database refuses (agents over its size cap) goes again without the agents, so the rest still syncs.
    const rest = Object.fromEntries(Object.entries(settings).filter(([key]) => key !== "agents"));
    const sent = (await upsertSigned(client, uid, settings, sign)) || ("agents" in settings && (await upsertSigned(client, uid, rest, sign)));
    if (!sent) return false;
    pushed = text;
    return true;
  } catch {
    return false;
  }
}

// One signed row, at a version newer than any before it. False when it wasn't signed or the database refused it.
async function upsertSigned(client: SupabaseClient, uid: string, settings: Record<string, unknown>, sign: SettingsSigner): Promise<boolean> {
  const version = Math.max(Date.now(), lastVersion + 1);
  const { signature } = await sign({ userId: uid, version, digest: settingsDigest(settings) });
  if (typeof signature !== "string" || !signature) return false;
  const { error } = await client.from("account_settings").upsert({ user_id: uid, settings, version, signature, updated_at: new Date().toISOString() });
  if (error) return false;
  lastVersion = version;
  return true;
}

/** Forgets what was pushed (tests, and a sign-in as someone else). */
export function forgetPushedSettings() {
  pushed = null;
}

const FIRST_PUSH_MS = 20_000;

// Server start: one push once the account has had time to load, so a worker sees settings saved before this feature,
// and one whenever Settings → Agents saves (your agents travel with your settings, lib/agent-sync.ts).
export function startAccountSettingsPush(push: () => Promise<unknown> = pushAccountSettings, watch: (fn: () => void) => () => void = onAgentsSaved): () => void {
  const timer = setTimeout(() => void push(), FIRST_PUSH_MS);
  timer.unref();
  const unwatch = watch(() => void push());
  return () => {
    clearTimeout(timer);
    unwatch();
  };
}
