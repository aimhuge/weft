import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The changelog's Supabase mirror (lib/changelog-sync.ts) against a fake client, the store in a temp dir.

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-changelog-sync-"));
vi.mock("./store", () => ({ DATA_DIR: dir }));
vi.mock("./signed-in-client", () => ({ safeClient: () => null }));

const { addEntry, changelogFile, releaseProject, removeEntry, stampCard } = await import("./changelog");
const { cursorFile, pendingRows, rowFor, syncChangelog, watchChangelog } = await import("./changelog-sync");
const { readEvents } = await import("./changelog");

function fake({ user = "u1", error = null }: { user?: string | null; error?: { code?: string; message: string } | null } = {}) {
  const upserts: { rows: Record<string, unknown>[]; opts: unknown }[] = [];
  const client = {
    auth: { getSession: () => Promise.resolve({ data: { session: user ? { user: { id: user } } : null } }) },
    from: (table: string) => ({
      upsert: (rows: Record<string, unknown>[], opts: unknown) => {
        expect(table).toBe("changelog_entries");
        upserts.push({ rows, opts });
        return Promise.resolve({ error });
      },
    }),
  };
  return { client: () => client as unknown as SupabaseClient, upserts };
}

beforeEach(() => {
  fs.rmSync(changelogFile(), { force: true });
  fs.rmSync(cursorFile(), { force: true });
});

describe("changelog sync", () => {
  it("maps an entry to its row", () => {
    const row = rowFor({ id: "e", project: "/a/weft", kind: "fixed", text: "t", at: 0, cardId: "c", cardTitle: "C", sha: "abcdef0", committedAt: 1000, version: "1.0.0", releasedAt: 2000 });
    expect(row).toMatchObject({ id: "e", project: "/a/weft", project_name: "weft", card_id: "c", card_title: "C", sha: "abcdef0", committed_at: "1970-01-01T00:00:01.000Z", version: "1.0.0", released_at: "1970-01-01T00:00:02.000Z", created_at: "1970-01-01T00:00:00.000Z", deleted: false });
    expect(rowFor({ id: "e", project: "/", kind: "added", text: "t", at: 0 })).toMatchObject({ project_name: "/", card_id: null, sha: null, committed_at: null, version: null, released_at: null });
  });

  it("does nothing without a client or a session, or with nothing to send", async () => {
    expect(await syncChangelog()).toBe(0);
    addEntry({ project: "/r", kind: "added", text: "x" });
    expect(await syncChangelog(fake({ user: null }))).toBe(0);
    const f = fake();
    fs.rmSync(changelogFile());
    expect(await syncChangelog(f)).toBe(0);
    expect(f.upserts).toEqual([]);
    expect(fs.existsSync(cursorFile())).toBe(false);
  });

  it("uploads what changed since the cursor, once, and starts over for another account", async () => {
    const a = addEntry({ project: "/r", kind: "added", text: "a", cardId: "c1" });
    const f = fake();
    expect(await syncChangelog(f)).toBe(1);
    expect(f.upserts[0]?.opts).toEqual({ onConflict: "user_id,id" });
    expect(await syncChangelog(f)).toBe(0);
    stampCard("c1", "/r", "abcdef1");
    const b = addEntry({ project: "/r", kind: "fixed", text: "b" });
    expect(await syncChangelog(f)).toBe(2);
    expect(f.upserts[1]!.rows.map((r) => [r.id, r.sha])).toEqual([[a.id, "abcdef1"], [b.id, null]]);
    expect(await syncChangelog(fake({ user: "u2" }))).toBe(2);
  });

  it("sends a removed entry as deleted, and skips ids it never saw added", () => {
    const a = addEntry({ project: "/r", kind: "added", text: "a" });
    const from = readEvents().length;
    removeEntry(a.id);
    releaseProject("/r", "1.0.0");
    expect(pendingRows(readEvents(), from)).toEqual([expect.objectContaining({ id: a.id, deleted: true })]);
    expect(pendingRows([{ t: "remove", id: "ghost", at: 1 }], 0)).toEqual([]);
    expect(pendingRows(readEvents(), readEvents().length)).toEqual([]);
  });

  it("waits quietly while the table isn't there, and throws other errors", async () => {
    addEntry({ project: "/r", kind: "added", text: "a" });
    expect(await syncChangelog(fake({ error: { code: "PGRST205", message: "no table" } }))).toBe(0);
    expect(fs.existsSync(cursorFile())).toBe(false);
    await expect(syncChangelog(fake({ error: { message: "boom" } }))).rejects.toThrow("boom");
  });

  it("ignores an unreadable cursor", async () => {
    addEntry({ project: "/r", kind: "added", text: "a" });
    fs.writeFileSync(cursorFile(), "{bad");
    expect(await syncChangelog(fake())).toBe(1);
    fs.writeFileSync(cursorFile(), JSON.stringify({ user: 1 }));
    expect(await syncChangelog(fake())).toBe(1);
  });
});

describe("watchChangelog", () => {
  afterEach(() => vi.useRealTimers());

  it("syncs a few seconds after a burst of changes, once per server, until stopped", async () => {
    vi.useFakeTimers();
    const f = fake();
    const stop = watchChangelog(f);
    expect(watchChangelog(f)).toBeInstanceOf(Function);
    addEntry({ project: "/r", kind: "added", text: "a" });
    addEntry({ project: "/r", kind: "added", text: "b" });
    await vi.advanceTimersByTimeAsync(3000);
    expect(f.upserts).toHaveLength(1);
    expect(f.upserts[0]?.rows).toHaveLength(2);
    addEntry({ project: "/r", kind: "added", text: "c" });
    stop();
    await vi.advanceTimersByTimeAsync(3000);
    expect(f.upserts).toHaveLength(1);
  });

  it("logs a failed sync instead of throwing", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const stop = watchChangelog(fake({ error: { message: "boom" } }));
    addEntry({ project: "/r", kind: "added", text: "a" });
    await vi.advanceTimersByTimeAsync(3000);
    expect(warn).toHaveBeenCalledWith("[weft] changelog sync failed:", expect.any(Error));
    stop();
    warn.mockRestore();
  });
});
