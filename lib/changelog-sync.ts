import fs from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { changelogFile, entryOf, fold, onChangelogEvent, readEvents, type ChangelogEntry, type ChangelogEvent } from "./changelog";
import { globalSingleton } from "./global-singleton";
import { safeClient } from "./signed-in-client";
import { DATA_DIR } from "./store";

// Mirrors ~/.weft/changelog.jsonl (lib/changelog.ts) into public.changelog_entries while you're signed in. The log is
// its own outbox: a cursor counts the events already uploaded, and each sync upserts the entries the newer events
// touched (a removed one goes up as deleted). The cursor belongs to the account it uploaded as, so signing in as
// someone else starts over. Runs a few seconds after each change and on the league timer (lib/league-sync.ts).

export const cursorFile = () => path.join(DATA_DIR, "changelog-sync.json");
interface Cursor {
  user: string;
  events: number;
}

function readCursor(): Cursor | null {
  try {
    const c = JSON.parse(fs.readFileSync(cursorFile(), "utf8")) as Partial<Cursor>;
    return typeof c.user === "string" && typeof c.events === "number" ? { user: c.user, events: c.events } : null;
  } catch {
    return null;
  }
}

const touched = (event: ChangelogEvent) => ("ids" in event ? event.ids : [event.id]);
const iso = (ms?: number) => (ms ? new Date(ms).toISOString() : null);

export function rowFor(entry: ChangelogEntry) {
  return {
    id: entry.id,
    project: entry.project,
    project_name: path.basename(entry.project) || entry.project,
    kind: entry.kind,
    text: entry.text,
    card_id: entry.cardId ?? null,
    card_title: entry.cardTitle ?? null,
    sha: entry.sha ?? null,
    committed_at: iso(entry.committedAt),
    version: entry.version ?? null,
    released_at: iso(entry.releasedAt),
    created_at: new Date(entry.at).toISOString(),
    deleted: false,
    updated_at: new Date().toISOString(),
  };
}

// The rows for every entry the events after `from` touched. A removed entry is gone from the fold, so its last
// known shape goes up as deleted.
export function pendingRows(events: ChangelogEvent[], from: number) {
  const ids = new Set(events.slice(from).flatMap(touched));
  if (!ids.size) return [];
  const live = new Map(fold(events).map((e) => [e.id, e]));
  const everAdded = new Map(events.filter((e): e is Extract<ChangelogEvent, { t: "add" }> => e.t === "add").map((e) => [e.id, e]));
  return [...ids].flatMap((id) => {
    const entry = live.get(id);
    if (entry) return [rowFor(entry)];
    const added = everAdded.get(id);
    return added ? [{ ...rowFor(entryOf(added)), deleted: true }] : [];
  });
}

export interface ChangelogSyncDeps {
  client?: () => SupabaseClient | null;
}

function saveCursor(cursor: Cursor) {
  fs.mkdirSync(path.dirname(cursorFile()), { recursive: true });
  fs.writeFileSync(cursorFile(), JSON.stringify(cursor));
}

// Upserts the rows; false when the table isn't on this Supabase yet.
async function upload(c: SupabaseClient, rows: ReturnType<typeof rowFor>[]): Promise<boolean> {
  if (!rows.length) return true;
  const { error } = await c.from("changelog_entries").upsert(rows, { onConflict: "user_id,id" });
  if (error?.code === "42P01" || error?.code === "PGRST205") return false;
  if (error) throw new Error(error.message);
  return true;
}

// The number of rows uploaded; 0 when signed out, nothing changed, or the table isn't on this Supabase yet.
export async function syncChangelog({ client = safeClient }: ChangelogSyncDeps = {}): Promise<number> {
  const c = client();
  const user = c ? (await c.auth.getSession()).data.session?.user.id : undefined;
  if (!c || !user) return 0;
  const events = readEvents(changelogFile());
  const cursor = readCursor();
  const from = cursor?.user === user ? Math.min(cursor.events, events.length) : 0;
  const rows = pendingRows(events, from);
  if (!(await upload(c, rows))) return 0;
  if (events.length && (from !== events.length || cursor?.user !== user)) saveCursor({ user, events: events.length });
  return rows.length;
}

const DEBOUNCE_MS = 3000;

// Once per server: a change syncs a few seconds later, so a burst of entries goes up as one upsert.
export function watchChangelog(deps: ChangelogSyncDeps = {}): () => void {
  const state = globalSingleton("__weftChangelogSync", () => ({ off: null as null | (() => void), timer: null as null | ReturnType<typeof setTimeout> }));
  if (state.off) return () => {};
  const run = () => void syncChangelog(deps).catch((err: unknown) => console.warn("[weft] changelog sync failed:", err));
  const off = onChangelogEvent(() => {
    if (state.timer) clearTimeout(state.timer);
    state.timer = setTimeout(run, DEBOUNCE_MS);
  });
  state.off = () => {
    off();
    if (state.timer) clearTimeout(state.timer);
  };
  return () => {
    state.off?.();
    state.off = null;
    state.timer = null;
  };
}
