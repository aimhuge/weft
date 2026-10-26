import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseNotesDb } from "./site-notes-db";

// The site-notes tables as weft.zip's service role reads and writes them. The fake Supabase client is
// chainable: every builder method returns the builder, and awaiting it resolves to a scripted
// {data, error, count}.

type Script = { data?: unknown; error?: { message: string } | null; count?: number | null };

type Call = { table: string; method: string; args: unknown[] };

// A chainable builder. `select`/`update`/`upsert`/`insert`/`delete` all start a builder; the filter
// methods (`eq`, `in`, `or`, `gte`, `order`, `limit`, `maybeSingle`, `single`) chain on it; awaiting
// resolves the script for that table.
function fakeClient(script: Partial<Record<string, Script | Script[]>> = {}) {
  const calls: Call[] = [];
  const used: string[] = [];

  function result(table: string): Script {
    const entry = script[table];
    if (Array.isArray(entry)) return entry[used.length] ?? entry[entry.length - 1] ?? { data: null, error: null };
    return entry ?? { data: null, error: null };
  }

  function builder(table: string) {
    const b: Record<string, unknown> = {};
    const chain = (method: string) => (...args: unknown[]) => {
      calls.push({ table, method, args });
      return b;
    };
    for (const m of ["eq", "in", "or", "gte", "gt", "lt", "lte", "neq", "like", "ilike", "order", "limit", "not", "filter"]) b[m] = chain(m);
    b.select = (...args: unknown[]) => {
      calls.push({ table, method: "select", args });
      return b;
    };
    b.upsert = (...args: unknown[]) => {
      calls.push({ table, method: "upsert", args });
      return b;
    };
    b.update = (...args: unknown[]) => {
      calls.push({ table, method: "update", args });
      return b;
    };
    b.insert = (...args: unknown[]) => {
      calls.push({ table, method: "insert", args });
      return b;
    };
    b.delete = () => {
      calls.push({ table, method: "delete", args: [] });
      return b;
    };
    b.maybeSingle = () => {
      calls.push({ table, method: "maybeSingle", args: [] });
      return b;
    };
    b.single = () => {
      calls.push({ table, method: "single", args: [] });
      return b;
    };
    b.then = (ok: (v: Script) => unknown, bad: (e: unknown) => unknown) => {
      used.push(table);
      const r = result(table);
      return Promise.resolve(r).then(ok, bad);
    };
    return b;
  }

  const client = {
    from: (table: string) => builder(table),
  };
  return { client: client as unknown as SupabaseClient, calls };
}

describe("supabaseNotesDb", () => {
  describe("orgsFor", () => {
    it("maps memberships to org ids and their team-sharing flag", async () => {
      const { client, calls } = fakeClient({
        org_memberships: {
          data: [
            { org_id: "o1", orgs: { site_notes_team: true } },
            { org_id: "o2", orgs: { site_notes_team: false } },
            { org_id: "o3", orgs: null },
          ],
          error: null,
        },
      });
      const db = supabaseNotesDb(client);
      expect(await db.orgsFor("u1")).toEqual([
        { id: "o1", shareTeam: true },
        { id: "o2", shareTeam: false },
        { id: "o3", shareTeam: true },
      ]);
      expect(calls[0]).toEqual({ table: "org_memberships", method: "select", args: ["org_id, orgs(site_notes_team)"] });
      expect(calls.at(-1)).toEqual({ table: "org_memberships", method: "eq", args: ["user_id", "u1"] });
    });

    it("throws the database's error", async () => {
      const { client } = fakeClient({ org_memberships: { data: null, error: { message: "boom" } } });
      await expect(supabaseNotesDb(client).orgsFor("u1")).rejects.toThrow("boom");
    });
  });

  describe("currentOrgId", () => {
    it("reads the profile's current org", async () => {
      const { client, calls } = fakeClient({ profiles: { data: { current_org_id: "o9" }, error: null } });
      expect(await supabaseNotesDb(client).currentOrgId("u1")).toBe("o9");
      expect(calls[0]).toEqual({ table: "profiles", method: "select", args: ["current_org_id"] });
      expect(calls.at(-1)).toEqual({ table: "profiles", method: "maybeSingle", args: [] });
    });

    it("is null when the profile has no current org", async () => {
      const { client } = fakeClient({ profiles: { data: { current_org_id: null }, error: null } });
      expect(await supabaseNotesDb(client).currentOrgId("u1")).toBeNull();
    });

    it("is null when the row is missing entirely", async () => {
      const { client } = fakeClient({ profiles: { data: null, error: null } });
      expect(await supabaseNotesDb(client).currentOrgId("u1")).toBeNull();
    });
  });

  describe("notesForHost", () => {
    it("asks for public notes plus the given orgs' team notes", async () => {
      const { client, calls } = fakeClient({ site_notes: { data: [], error: null } });
      await supabaseNotesDb(client).notesForHost("example.com", ["o1", "o2"]);
      const or = calls.find((c) => c.method === "or");
      expect(or?.args).toEqual(["scope.eq.public,org_id.in.(o1,o2)"]);
    });

    it("asks only for public notes when there are no orgs", async () => {
      const { client, calls } = fakeClient({ site_notes: { data: [], error: null } });
      await supabaseNotesDb(client).notesForHost("example.com", []);
      expect(calls.find((c) => c.method === "or")?.args).toEqual(["scope.eq.public"]);
    });
  });

  describe("versionsFor", () => {
    it("is empty without note ids and never asks the database", async () => {
      const { client, calls } = fakeClient();
      expect(await supabaseNotesDb(client).versionsFor([])).toEqual([]);
      expect(calls).toEqual([]);
    });

    it("orders by creation, newest first, and caps the batch", async () => {
      const { client, calls } = fakeClient({ site_note_versions: { data: [{ id: "v1" }], error: null } });
      const rows = await supabaseNotesDb(client).versionsFor(["n1"]);
      expect(rows).toEqual([{ id: "v1" }]);
      expect(calls.find((c) => c.method === "in")?.args).toEqual(["note_id", ["n1"]]);
      expect(calls.find((c) => c.method === "order")?.args).toEqual(["created_at", { ascending: false }]);
      expect(calls.find((c) => c.method === "limit")?.args).toEqual([200]);
    });
  });

  describe("reportsFor", () => {
    it("is empty without version ids and never asks the database", async () => {
      const { client, calls } = fakeClient();
      expect(await supabaseNotesDb(client).reportsFor([])).toEqual([]);
      expect(calls).toEqual([]);
    });

    it("reads the reports of the given versions", async () => {
      const { client, calls } = fakeClient({ site_note_reports: { data: [{ version_id: "v1" }], error: null } });
      expect(await supabaseNotesDb(client).reportsFor(["v1"])).toEqual([{ version_id: "v1" }]);
      expect(calls.find((c) => c.method === "in")?.args).toEqual(["version_id", ["v1"]]);
    });
  });

  describe("uploadsSince", () => {
    it("counts the uploads with a head count", async () => {
      const { client, calls } = fakeClient({ site_note_versions: { data: null, error: null, count: 12 } });
      expect(await supabaseNotesDb(client).uploadsSince("u1", "2026-01-01T00:00:00.000Z")).toBe(12);
      expect(calls.find((c) => c.method === "select")?.args).toEqual(["id", { count: "exact", head: true }]);
      expect(calls.find((c) => c.method === "gte")?.args).toEqual(["created_at", "2026-01-01T00:00:00.000Z"]);
    });

    it("counts zero when the count is null", async () => {
      const { client } = fakeClient({ site_note_versions: { data: null, error: null, count: null } });
      expect(await supabaseNotesDb(client).uploadsSince("u1", "since")).toBe(0);
    });

    it("throws the database's error", async () => {
      const { client } = fakeClient({ site_note_versions: { data: null, error: { message: "denied" } } });
      await expect(supabaseNotesDb(client).uploadsSince("u1", "since")).rejects.toThrow("denied");
    });
  });

  describe("upsertNote", () => {
    it("upserts on host, path, scope and org, and returns the id", async () => {
      const { client, calls } = fakeClient({ site_notes: { data: { id: "n1" }, error: null } });
      const row = { host: "example.com", path: "/a", scope: "public" as const, org_id: null };
      expect(await supabaseNotesDb(client).upsertNote(row)).toBe("n1");
      const upsert = calls.find((c) => c.method === "upsert");
      expect(upsert?.args).toEqual([row, { onConflict: "host,path,scope,org_id" }]);
      expect(calls.find((c) => c.method === "single")?.args).toEqual([]);
    });

    it("throws the database's error", async () => {
      const { client } = fakeClient({ site_notes: { data: null, error: { message: "conflict" } } });
      await expect(supabaseNotesDb(client).upsertNote({ host: "example.com", path: "/a", scope: "public", org_id: null })).rejects.toThrow("conflict");
    });
  });

  describe("insertVersion", () => {
    it("returns the id of the version it made", async () => {
      const { client, calls } = fakeClient({ site_note_versions: { data: [{ id: "v9" }], error: null } });
      const row = { note_id: "n1", body: "b", body_hash: "h", author_id: "u1" };
      expect(await supabaseNotesDb(client).insertVersion(row)).toBe("v9");
      const upsert = calls.find((c) => c.method === "upsert");
      expect(upsert?.args).toEqual([row, { onConflict: "note_id,body_hash", ignoreDuplicates: true }]);
    });

    it("finds the existing version when the body was uploaded before", async () => {
      const { client, calls } = fakeClient({
        site_note_versions: [{ data: [], error: null }, { data: { id: "v-old" }, error: null }],
      });
      const row = { note_id: "n1", body: "b", body_hash: "h", author_id: "u1" };
      expect(await supabaseNotesDb(client).insertVersion(row)).toBe("v-old");
      const selects = calls.filter((c) => c.method === "select");
      expect(selects.at(-1)?.args).toEqual(["id"]);
      expect(calls.at(-1)).toEqual({ table: "site_note_versions", method: "single", args: [] });
    });

    it("throws the database's error", async () => {
      const { client } = fakeClient({ site_note_versions: { data: null, error: { message: "bad" } } });
      await expect(supabaseNotesDb(client).insertVersion({ note_id: "n", body: "b", body_hash: "h", author_id: "u" })).rejects.toThrow("bad");
    });

    it("throws when the fallback lookup finds nothing", async () => {
      const { client } = fakeClient({
        site_note_versions: [{ data: [], error: null }, { data: null, error: { message: "gone" } }],
      });
      await expect(supabaseNotesDb(client).insertVersion({ note_id: "n", body: "b", body_hash: "h", author_id: "u" })).rejects.toThrow("gone");
    });
  });

  describe("noteOfVersion", () => {
    it("reads the note a version belongs to", async () => {
      const { client, calls } = fakeClient({ site_note_versions: { data: { site_notes: { id: "n1" } }, error: null } });
      expect(await supabaseNotesDb(client).noteOfVersion("v1")).toEqual({ id: "n1" });
      expect(calls.find((c) => c.method === "select")?.args).toEqual(["site_notes(id, host, path, scope, org_id)"]);
    });

    it("is null when the version has no note", async () => {
      const { client } = fakeClient({ site_note_versions: { data: { site_notes: null }, error: null } });
      expect(await supabaseNotesDb(client).noteOfVersion("v1")).toBeNull();
    });

    it("is null when there is no row at all", async () => {
      const { client } = fakeClient({ site_note_versions: { data: null, error: null } });
      expect(await supabaseNotesDb(client).noteOfVersion("v1")).toBeNull();
    });
  });

  describe("upsertReport", () => {
    it("upserts on version and user, stamping the time", async () => {
      const { client, calls } = fakeClient({ site_note_reports: { data: null, error: null } });
      const row = { version_id: "v1", user_id: "u1", outcome: "success" as const, step: null };
      await supabaseNotesDb(client).upsertReport(row);
      const upsert = calls.find((c) => c.method === "upsert");
      expect(upsert?.args[0]).toMatchObject({ version_id: "v1", user_id: "u1", outcome: "success", step: null });
      expect((upsert?.args[0] as { updated_at: string }).updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(upsert?.args[1]).toEqual({ onConflict: "version_id,user_id" });
    });

    it("throws the database's error", async () => {
      const { client } = fakeClient({ site_note_reports: { data: null, error: { message: "nope" } } });
      await expect(supabaseNotesDb(client).upsertReport({ version_id: "v", user_id: "u", outcome: "failure", step: null })).rejects.toThrow("nope");
    });
  });
});
