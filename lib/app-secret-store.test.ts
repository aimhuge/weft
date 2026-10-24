// lib/app-secret-store.ts: splits names by `from: "author"` vs `from: "viewer"`, reads only the rows the caller
// asked for, decrypts and returns a plain { NAME: value } map. setValue / removeValue / hasValue are the
// single-row pair for the author and viewer upload routes. The fake Supabase client is a chain builder
// mirroring the helpers in lib/app-share-access.test-helpers.ts.
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isConfigured, open, seal } from "./app-secrets";
import { createAppSecretStore, splitByManifest } from "./app-secret-store";

const KEY = randomBytes(32).toString("base64");
const ENV = { WEFT_MINIAPP_KEY: KEY };

beforeEach(() => {
  process.env.WEFT_MINIAPP_KEY = KEY;
});

afterEach(() => {
  delete process.env.WEFT_MINIAPP_KEY;
});

// A row that lives in the fake's `rows` array. Supabase JS sends ciphertext as a string column.
interface FakeRow {
  share_id: string;
  name: string;
  viewer_id: string | null;
  ciphertext: string;
}

// A client for setValue: each update answers the next entry of `updated` (whether it matched a row); the insert
// answers insertError. Records every call so a test can check the filters and the sealed row.
function scriptedClient({ updated, updateError, insertError }: { updated: boolean[]; updateError?: { message: string }; insertError?: { code: string; message: string } }) {
  const calls: { method: string; args: unknown[] }[] = [];
  let updates = 0;
  const filter = (): Record<string, unknown> => {
    const b: Record<string, unknown> = {};
    for (const m of ["eq", "is"]) b[m] = (...args: unknown[]) => (calls.push({ method: m, args }), b);
    b.select = () => {
      const hit = updated[updates++] ?? false;
      return Promise.resolve({ data: hit ? [{ name: "x" }] : [], error: updateError ?? null });
    };
    return b;
  };
  const table = {
    update: (...args: unknown[]) => (calls.push({ method: "update", args }), filter()),
    insert: (...args: unknown[]) => (calls.push({ method: "insert", args }), Promise.resolve({ error: insertError ?? null })),
  };
  return { service: { from: () => table }, calls };
}

function makeClient(rows: FakeRow[]) {
  const calls: { method: string; args: unknown[] }[] = [];
  const make = (): Record<string, unknown> => {
    const builder: Record<string, unknown> = {};
    for (const m of ["select", "order", "limit", "upsert", "insert", "delete", "update"]) {
      builder[m] = vi.fn((...args: unknown[]) => {
        calls.push({ method: m, args });
        return builder;
      });
    }
    builder.eq = vi.fn((col: string, val: unknown) => {
      calls.push({ method: "eq", args: [col, val] });
      const prev = (builder as { __filter?: (r: FakeRow) => boolean }).__filter ?? (() => true);
      (builder as { __filter?: (r: FakeRow) => boolean }).__filter = (r) => prev(r) && r[col as keyof FakeRow] === val;
      return builder;
    });
    builder.is = vi.fn((col: string, val: unknown) => {
      calls.push({ method: "is", args: [col, val] });
      const prev = (builder as { __filter?: (r: FakeRow) => boolean }).__filter ?? (() => true);
      (builder as { __filter?: (r: FakeRow) => boolean }).__filter = (r) => {
        if (!prev(r)) return false;
        const cell = r[col as keyof FakeRow];
        return val === null ? cell === null : cell === val;
      };
      return builder;
    });
    builder.limit = vi.fn((n: number) => {
      calls.push({ method: "limit", args: [n] });
      const prev = (builder as { __filtered?: FakeRow[] }).__filtered;
      const filter = (builder as { __filter?: (r: FakeRow) => boolean }).__filter;
      if (prev === undefined && filter) {
        // No prior .or: rows come from the table itself. The test passes them in via the closure above.
        (builder as { __filtered?: FakeRow[] }).__filtered = rows.filter(filter).slice(0, n);
      } else if (prev) {
        (builder as { __filtered?: FakeRow[] }).__filtered = prev.slice(0, n);
      }
      return builder;
    });
    builder.or = vi.fn((filter: string) => {
      calls.push({ method: "or", args: [filter] });
      // Apply the filter to rows to mirror what Supabase would do for an `or` clause.
      const { viewerFilter, nameFilter } = parseOr(filter);
      const filtered = rows.filter((r) => {
        if (nameFilter && !nameFilter.has(r.name)) return false;
        if (viewerFilter === "null" && r.viewer_id !== null) return false;
        if (viewerFilter === "notnull" && r.viewer_id === null) return false;
        return true;
      });
      // Stash the filtered set so the .maybeSingle() below returns the right shape.
      (builder as { __filtered?: FakeRow[] }).__filtered = filtered;
      return builder;
    });
    builder.maybeSingle = vi.fn(() => {
      const filtered = (builder as { __filtered?: FakeRow[] }).__filtered;
      if (filtered !== undefined) return Promise.resolve({ data: filtered[0] ?? null, error: null });
      return Promise.resolve({ data: null, error: null });
    });
    // `await` on the chain must resolve to the same shape Supabase would (a thenable builder).
    builder.then = (onFulfilled: (v: { data: FakeRow[]; error: null }) => unknown, onRejected?: (err: unknown) => unknown) => {
      const filtered = (builder as { __filtered?: FakeRow[] }).__filtered;
      const value = { data: filtered ?? [], error: null };
      try {
        return Promise.resolve(onFulfilled(value));
      } catch (err) {
        return onRejected ? Promise.resolve(onRejected(err)) : Promise.reject(err instanceof Error ? err : new Error(String(err)));
      }
    };
    return builder;
  };
  const service = { from: (table: string) => { calls.push({ method: "from", args: [table] }); return make(); } };
  return { service, calls, rows };
}

// The `or` filter we build is one of:
//   and(name.in.("A","B"),viewer_id.is.null),name.in.("C","D")
// The first half needs an AND inside the group; the second half is a flat `name.in.(...)`. Parse enough to
// return the matching rows; the test doesn't pretend to be a real PostgREST parser.
function parseOr(filter: string): { nameFilter: Set<string> | null; viewerFilter: "null" | "notnull" | null } {
  const nameFilter = new Set<string>();
  let viewerFilter: "null" | "notnull" | null = null;
  // Match name.in.(...) whether it's wrapped in and(...) or not.
  const allNameIn = filter.match(/name\.in\.\(([^)]*)\)/g) ?? [];
  for (const m of allNameIn) {
    const inside = m.replace(/^name\.in\.\(/, "").replace(/\)$/, "");
    for (const item of inside.split(",")) {
      const trimmed = item.replace(/^"|"$/g, "");
      if (trimmed) nameFilter.add(trimmed);
    }
  }
  if (/viewer_id\.is\.null/.test(filter)) viewerFilter = "null";
  if (/viewer_id\.not\.is\.null/.test(filter)) viewerFilter = "notnull";
  return { nameFilter: nameFilter.size ? nameFilter : null, viewerFilter };
}

function row(shareId: string, name: string, viewerId: string | null, value: string): FakeRow {
  return { share_id: shareId, name, viewer_id: viewerId, ciphertext: seal(value, { shareId, name, viewerId }, ENV) };
}

describe("app-secret-store", () => {
  it("round-trips an author value", async () => {
    const r = row("s1", "STRIPE_KEY", null, "sk_live_x");
    const { service } = makeClient([r]);
    const store = createAppSecretStore(service as never);
    const out = await store.getValues("s1", { author: ["STRIPE_KEY"], viewer: [] }, "user-1");
    expect(out).toEqual({ STRIPE_KEY: "sk_live_x" });
  });

  it("round-trips a viewer value", async () => {
    const r = row("s1", "OPENAI_KEY", "user-1", "sk-openai");
    const { service } = makeClient([r]);
    const store = createAppSecretStore(service as never);
    const out = await store.getValues("s1", { author: [], viewer: ["OPENAI_KEY"] }, "user-1");
    expect(out).toEqual({ OPENAI_KEY: "sk-openai" });
  });

  it("refuses to confuse an author row with a viewer's value (viewer_id filter)", async () => {
    const author = row("s1", "OPENAI_KEY", null, "sk-author");
    const viewer = row("s1", "OPENAI_KEY", "user-1", "sk-viewer");
    const { service } = makeClient([author, viewer]);
    const store = createAppSecretStore(service as never);
    // Ask as viewer: gets only the viewer's row.
    const out = await store.getValues("s1", { author: [], viewer: ["OPENAI_KEY"] }, "user-1");
    expect(out).toEqual({ OPENAI_KEY: "sk-viewer" });
  });

  it("skips a row that fails to open (a tampered or rotated ciphertext)", async () => {
    const good = row("s1", "A", null, "v");
    const bad = { share_id: "s1", name: "B", viewer_id: null, ciphertext: "v1:AAAA" };
    const { service } = makeClient([good, bad]);
    const store = createAppSecretStore(service as never);
    const out = await store.getValues("s1", { author: ["A", "B"], viewer: [] }, "user-1");
    expect(out).toEqual({ A: "v" });
  });

  it("returns {} when no names are asked for", async () => {
    const { service } = makeClient([]);
    const store = createAppSecretStore(service as never);
    expect(await store.getValues("s1", { author: [], viewer: [] }, "user-1")).toEqual({});
  });

  it("setValue inserts a sealed row when the update finds none", async () => {
    const { service, calls } = scriptedClient({ updated: [false] });
    await createAppSecretStore(service as never).setValue("s1", "STRIPE_KEY", null, "sk_live_y");
    expect(calls.filter((c) => c.method === "update")).toHaveLength(1);
    expect(calls).toContainEqual({ method: "is", args: ["viewer_id", null] });
    const row = calls.find((c) => c.method === "insert")!.args[0] as { share_id: string; name: string; viewer_id: string | null; ciphertext: string };
    expect(row).toMatchObject({ share_id: "s1", name: "STRIPE_KEY", viewer_id: null });
    expect(isConfigured(ENV)).toBe(true);
    expect(open(row.ciphertext, { shareId: "s1", name: "STRIPE_KEY", viewerId: null }, ENV)).toBe("sk_live_y");
  });

  it("setValue updates an existing row without inserting", async () => {
    const { service, calls } = scriptedClient({ updated: [true] });
    await createAppSecretStore(service as never).setValue("s1", "STRIPE_KEY", null, "sk_new");
    const set = calls.find((c) => c.method === "update")!.args[0] as { ciphertext: string };
    expect(open(set.ciphertext, { shareId: "s1", name: "STRIPE_KEY", viewerId: null }, ENV)).toBe("sk_new");
    expect(calls.some((c) => c.method === "insert")).toBe(false);
  });

  it("setValue for a viewer includes their id in the row and the AAD", async () => {
    const { service, calls } = scriptedClient({ updated: [false] });
    await createAppSecretStore(service as never).setValue("s1", "OPENAI_KEY", "user-1", "sk-x");
    expect(calls).toContainEqual({ method: "eq", args: ["viewer_id", "user-1"] });
    const row = calls.find((c) => c.method === "insert")!.args[0] as { viewer_id: string | null; ciphertext: string };
    expect(row.viewer_id).toBe("user-1");
    expect(open(row.ciphertext, { shareId: "s1", name: "OPENAI_KEY", viewerId: "user-1" }, ENV)).toBe("sk-x");
  });

  it("setValue updates again when a racing writer inserted first", async () => {
    const { service, calls } = scriptedClient({ updated: [false, true], insertError: { code: "23505", message: "duplicate key" } });
    await createAppSecretStore(service as never).setValue("s1", "STRIPE_KEY", null, "v");
    expect(calls.filter((c) => c.method === "update")).toHaveLength(2);
  });

  it("setValue throws the update's or the insert's error", async () => {
    const failedUpdate = scriptedClient({ updated: [false], updateError: { message: "boom" } });
    await expect(createAppSecretStore(failedUpdate.service as never).setValue("s1", "A", null, "v")).rejects.toThrow("cloud_app_secrets update failed: boom");
    const failedInsert = scriptedClient({ updated: [false], insertError: { code: "42501", message: "denied" } });
    await expect(createAppSecretStore(failedInsert.service as never).setValue("s1", "A", null, "v")).rejects.toThrow("cloud_app_secrets insert failed: denied");
  });

  it("removeValue uses is(null) for the author and eq for a viewer", async () => {
    const { service: aService, calls: aCalls } = makeClient([]);
    const storeA = createAppSecretStore(aService as never);
    await storeA.removeValue("s1", "STRIPE_KEY", null);
    expect(aCalls.some((c) => c.method === "delete")).toBe(true);
    expect(aCalls.some((c) => c.method === "is" && c.args[0] === "viewer_id" && c.args[1] === null)).toBe(true);

    const { service: vService, calls: vCalls } = makeClient([]);
    const storeV = createAppSecretStore(vService as never);
    await storeV.removeValue("s1", "OPENAI_KEY", "user-1");
    expect(vCalls.some((c) => c.method === "delete")).toBe(true);
    const viewerEq = vCalls.find((c) => c.method === "eq" && c.args[0] === "viewer_id" && c.args[1] === "user-1");
    expect(viewerEq).toBeDefined();
  });

  it("hasValue reports whether the row exists", async () => {
    const r = row("s1", "STRIPE_KEY", null, "v");
    const { service } = makeClient([r]);
    const store = createAppSecretStore(service as never);
    expect(await store.hasValue("s1", "STRIPE_KEY", null)).toBe(true);
    expect(await store.hasValue("s1", "OTHER", null)).toBe(false);
  });
});

describe("splitByManifest", () => {
  it("splits names by `from: \"viewer\"` vs the default author", () => {
    const out = splitByManifest(
      ["A", "B", "C"],
      { A: { hosts: ["h"] }, B: { from: "viewer", hosts: ["h"] }, C: { hosts: ["h"], from: "author" } },
    );
    expect(out).toEqual({ author: ["A", "C"], viewer: ["B"] });
  });

  it("drops names that aren't in the manifest", () => {
    expect(splitByManifest(["X", "A"], { A: { hosts: ["h"] } })).toEqual({ author: ["A"], viewer: [] });
  });

  it("returns empty lists for a missing manifest", () => {
    expect(splitByManifest(["A"], null)).toEqual({ author: [], viewer: [] });
    expect(splitByManifest(["A"], undefined)).toEqual({ author: [], viewer: [] });
  });
});
