// The Keychain audit log as your Weft account keeps it (docs/architecture/secrets.md#audit-log): the keychain_events
// rows lib/keychain-audit-sync.ts uploaded, newest first, read back as log lines for Settings → Security. The
// database is the record, not the Mac, whose file is only the outbox. Each line carries whose it is (the signed-in
// account's name, so a thread's line says whose thread it was), which Mac, and when the database got it.
import type { SupabaseClient } from "@supabase/supabase-js";
import { accountClient, toAccountUser } from "./account";
import type { AuditEntry } from "./keychain-audit-view";

// Rows read at most: what the card can show before it would page.
const LIMIT = 500;

/** A keychain_events row, as selected here. */
type Row = {
  id: string;
  device_id: string;
  seq: number;
  occurred_at: string;
  created_at: string;
  kind: AuditEntry["kind"];
  action: string;
  outcome: string;
  actor: string;
  what: string | null;
  card: string | null;
  thread: string | null;
  vault: string | null;
  names: string[] | null;
  environment: string | null;
  site: string | null;
  command: string | null;
  detail: string | null;
  via: string | null;
  repeat_count: number;
};

/** What the account has: whether you're signed in, the name lines read as, and the lines newest first. */
export type KeychainRecord = { signedIn: boolean; owner: string | null; entries: AuditEntry[] };

// A row back as a log line: nulls dropped, so it reads exactly like a line from the Mac.
export function entryOf(row: Row, owner: string | null): AuditEntry {
  const optional = {
    what: row.what,
    card: row.card,
    thread: row.thread,
    vault: row.vault,
    environment: row.environment,
    site: row.site,
    command: row.command,
    detail: row.detail,
    via: row.via,
  };
  const entry: AuditEntry = {
    id: row.id,
    seq: row.seq,
    at: row.occurred_at,
    kind: row.kind,
    action: row.action,
    outcome: row.outcome,
    by: row.actor,
    device: row.device_id,
    savedAt: row.created_at,
  };
  for (const [key, value] of Object.entries(optional)) if (value) Object.assign(entry, { [key]: value });
  if (row.names?.length) entry.names = row.names;
  if (row.repeat_count) entry.count = row.repeat_count;
  if (owner) entry.owner = owner;
  return entry;
}

/** The newest lines in your account, or signedIn false. A read that fails throws. */
export async function readKeychainRecord(client: SupabaseClient = accountClient(), limit = LIMIT): Promise<KeychainRecord> {
  const { data } = await client.auth.getSession();
  const user = data.session?.user;
  if (!user) return { signedIn: false, owner: null, entries: [] };
  const view = toAccountUser(user);
  // An account without a name reads as its email's local part; one with neither, as no one in particular.
  const owner = view.name ?? (view.email?.split("@")[0] || null);
  const { data: rows, error } = await client.from("keychain_events").select("*").order("occurred_at", { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  return { signedIn: true, owner, entries: (rows as Row[]).map((r) => entryOf(r, owner)) };
}
