// Uploads the Keychain audit log to your Weft account, where it's kept (docs/architecture/secrets.md#audit-log):
// Electron main writes every Keychain open and vault use to an outbox, ~/.weft/vault/audit.jsonl
// (electron/keychain-audit.cjs); while you're signed in, this takes those lines every few seconds, inserts them in
// keychain_events (supabase/migrations/*_keychain_events*.sql: append-only, the server's clock, a seq per Mac) and
// has main delete them. Signed out, the lines wait on the Mac and go up after the next sign-in. Names and events
// only, never a value.
import type { SupabaseClient } from "@supabase/supabase-js";
import { accountClient } from "./account";
import { shell } from "./browser-tools";
import { deviceId } from "./device-id";
import type { AuditEntry } from "./keychain-audit-types";

// Often, so a line sits on the Mac, where it could be edited, for seconds; the outbox is a small file, usually empty.
const CHECK_MS = 5_000;
// Batches per run at most, so a long signed-out stretch goes up over a few runs, not one burst.
const MAX_BATCHES = 5;

/** A log line as a keychain_events row. */
export function rowOf(e: AuditEntry, device: string, user: string) {
  return {
    id: e.id,
    user_id: user,
    device_id: device,
    seq: e.seq,
    occurred_at: e.at,
    kind: e.kind,
    action: e.action,
    outcome: e.outcome,
    actor: e.by,
    what: e.what ?? null,
    card: e.card ?? null,
    thread: e.thread ?? null,
    vault: e.vault ?? null,
    names: e.names ?? [],
    environment: e.environment ?? null,
    site: e.site ?? null,
    command: e.command ?? null,
    detail: e.detail ?? null,
    via: e.via ?? null,
    repeat_count: e.count ?? 0,
  };
}

// A line without an id and a number (written before them, or by hand) can't be a row; it's skipped, and deleted
// from the outbox with the rest.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One run: the outbox up in batches while you're signed in. Returns how many lines went up. */
export async function syncKeychainAudit(client: SupabaseClient = accountClient(), device: () => string = deviceId): Promise<number> {
  const { data } = await client.auth.getSession();
  const user = data.session?.user.id;
  if (!user) return 0;
  let sent = 0;
  for (let i = 0; i < MAX_BATCHES; i++) {
    const { entries } = (await shell("/secrets/audit-outbox", {})) as { entries?: AuditEntry[] };
    if (!entries?.length) break;
    const rows = entries.filter((e) => UUID.test(e.id) && Number.isInteger(e.seq) && Number(e.seq) > 0).map((e) => rowOf(e, device(), user));
    if (rows.length) {
      const { error } = await client.from("keychain_events").upsert(rows, { onConflict: "id", ignoreDuplicates: true });
      if (error) throw new Error(error.message);
    }
    await shell("/secrets/audit-synced", { id: entries[entries.length - 1]?.id });
    sent += rows.length;
  }
  return sent;
}

const g = globalThis as { __weftKeychainAudit?: { stop: () => void } };

// Once per server process (from prewarm, lib/copilot.ts): on sign-in, then every CHECK_MS. Outside the desktop app
// there's no main to ask, so nothing runs. A failure (offline, the table not there yet) logs and waits.
export function startKeychainAuditSync(): () => void {
  if (g.__weftKeychainAudit) return g.__weftKeychainAudit.stop;
  if (!process.env.WEFT_SHELL_URL) return () => {};
  const run = () => void syncKeychainAudit().catch((err: unknown) => console.warn(`Keychain audit upload: ${(err as Error).message}`));
  let unsubscribe: () => void;
  try {
    // supabase-js warns against awaiting its calls inside this callback, so the upload runs after it.
    const { data } = accountClient().auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") setTimeout(run, 0);
    });
    unsubscribe = () => data.subscription.unsubscribe();
  } catch {
    // Accounts aren't set up in this build: the log stays on the Mac.
    return () => {};
  }
  const timer = setInterval(run, CHECK_MS);
  timer.unref();
  run();
  const stop = () => {
    unsubscribe();
    clearInterval(timer);
    g.__weftKeychainAudit = undefined;
  };
  g.__weftKeychainAudit = { stop };
  return stop;
}
