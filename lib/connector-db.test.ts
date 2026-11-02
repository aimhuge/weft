import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { supabaseConnectorDb } from "./connector-db";

type R = { data: unknown; error: { message: string; code?: string } | null; count?: number | null };
const ok = (data: unknown, count?: number | null): R => ({ data, error: null, count });
const fail = (message: string, code?: string): R => ({ data: null, error: { message, code } });

const BUILDERS = ["select", "insert", "update", "upsert", "delete", "eq", "gte", "in", "or", "limit"];

// A supabase-js stand-in: every builder records itself and returns the chain; awaiting it (or maybeSingle/single)
// answers the next queued response.
function fakeSupabase(...responses: R[]) {
  const calls: { table: string; ops: unknown[][] }[] = [];
  const from = (table: string) => {
    const rec = { table, ops: [] as unknown[][] };
    calls.push(rec);
    const next = () => Promise.resolve(responses.shift() ?? ok(null));
    const q: Record<string, unknown> = {};
    for (const name of BUILDERS) {
      q[name] = (...args: unknown[]) => {
        rec.ops.push([name, ...args]);
        return q;
      };
    }
    q.maybeSingle = () => (rec.ops.push(["maybeSingle"]), next());
    q.single = () => (rec.ops.push(["single"]), next());
    q.then = (res: (r: R) => unknown, rej: (e: unknown) => unknown) => next().then(res, rej);
    return q;
  };
  return { db: supabaseConnectorDb({ from } as unknown as SupabaseClient), calls };
}

describe("supabaseConnectorDb: reads", () => {
  it("reads a headless worker by key hash or id", async () => {
    const { db, calls } = fakeSupabase(ok({ id: "w1" }), ok(null));
    expect(await db.workerByKeyHash("h")).toEqual({ id: "w1" });
    expect(await db.workerById("w1")).toBeNull();
    expect(calls[0]).toEqual({ table: "cloud_workers", ops: [["select", "id, org_id, owner_user, name, sign_key, revoked_at"], ["eq", "key_hash", "h"], ["eq", "kind", "headless"], ["maybeSingle"]] });
    expect(calls[1]!.ops[1]).toEqual(["eq", "id", "w1"]);
  });

  it("throws naming the step on a database error", async () => {
    const { db } = fakeSupabase(fail("permission denied"));
    await expect(db.grant("u1", "w1", "github")).rejects.toThrow("Reading the grant: permission denied");
  });

  it("reads a grant, the Allow, the pinned card and the chain", async () => {
    const { db, calls } = fakeSupabase(ok({ id: "g1" }), ok([{ id: 1 }]), ok(null), ok({ user_id: "u1", folder: "r", repo: "o/r" }), ok({ user_id: "u1" }));
    expect(await db.grant("u1", "w1", "github")).toEqual({ id: "g1" });
    expect(await db.hasAllow("g1", "card", "c1")).toBe(true);
    expect(await db.hasAllow("g1", "card", "c2")).toBe(false);
    expect(await db.pinnedCard("w1", "c1")).toEqual({ user_id: "u1", folder: "r", repo: "o/r" });
    expect(await db.tokens("u1")).toEqual({ user_id: "u1" });
    expect(calls.map((c) => c.table)).toEqual(["connector_grants", "connector_allows", "connector_allows", "connector_cards", "connector_github_tokens"]);
    expect(calls[0]!.ops.slice(1, 4)).toEqual([["eq", "user_id", "u1"], ["eq", "worker_id", "w1"], ["eq", "connector", "github"]]);
    expect(calls[1]!.ops).toContainEqual(["limit", 1]);
  });

  it("reads only owner-created start commands for the worker's card", async () => {
    const { db, calls } = fakeSupabase(ok([{ kind: "run" }]), ok(null));
    expect(await db.starts("w1", "c1", "u1")).toEqual([{ kind: "run" }]);
    expect(await db.starts("w1", "c1", "u1")).toEqual([]);
    expect(calls[0]).toEqual({
      table: "cloud_commands",
      ops: [["select", "kind, folder, payload, created_by"], ["eq", "target_device", "worker:w1"], ["eq", "card_id", "c1"], ["eq", "created_by", "u1"], ["in", "kind", ["new_card", "run", "host"]]],
    });
  });

  it("reads a card's state from the cloud board", async () => {
    const { db, calls } = fakeSupabase(ok({ deleted: false, col: "done" }), ok(null));
    expect(await db.cardState("org1", "c1")).toEqual({ deleted: false, column: "done" });
    expect(await db.cardState("org1", "c2")).toBeNull();
    expect(calls[0]!.ops[0]).toEqual(["select", "deleted, col:card->>column"]);
  });

  it("counts mints since a time, or only the user tokens minted", async () => {
    const { db, calls } = fakeSupabase(ok(null, 3), ok(null, null), fail("x"));
    expect(await db.mintsSince("w1", "t")).toBe(3);
    expect(await db.mintsSince("w1", "t", "user")).toBe(0);
    await expect(db.mintsSince("w1", "t")).rejects.toThrow("Counting mints: x");
    expect(calls[0]!.ops).toEqual([["select", "id", { count: "exact", head: true }], ["eq", "worker_id", "w1"], ["gte", "at", "t"]]);
    expect(calls[1]!.ops.slice(3)).toEqual([["eq", "token_kind", "user"], ["eq", "outcome", "minted"]]);
  });

  it("reads one live token or the live tokens by worker or user", async () => {
    const { db, calls } = fakeSupabase(ok({ id: "l1" }), ok([{ id: "l1" }]), ok([{ id: "l2" }]), ok(null));
    expect(await db.liveToken("w1", "card:c1")).toEqual({ id: "l1" });
    expect(await db.liveTokens({ workerId: "w1" })).toEqual([{ id: "l1" }]);
    expect(await db.liveTokens({ userId: "u1" })).toEqual([{ id: "l2" }]);
    expect(await db.liveTokens({})).toEqual([]);
    expect(calls[1]!.ops.slice(1)).toEqual([["eq", "worker_id", "w1"]]);
    expect(calls[2]!.ops.slice(1)).toEqual([["eq", "user_id", "u1"]]);
    expect(calls[3]!.ops).toHaveLength(1);
  });
});

describe("supabaseConnectorDb: writes", () => {
  it("touches and deletes grants, for one worker or all", async () => {
    const { db, calls } = fakeSupabase(ok(null), ok([{ id: "g1" }]), ok(null));
    await db.touchGrant("g1", "t");
    expect(await db.deleteGrants("u1", "github", "w1")).toBe(1);
    expect(await db.deleteGrants("u1", "github")).toBe(0);
    expect(calls[0]!.ops).toEqual([["update", { last_used_at: "t" }], ["eq", "id", "g1"]]);
    expect(calls[1]!.ops).toEqual([["delete"], ["eq", "user_id", "u1"], ["eq", "connector", "github"], ["eq", "worker_id", "w1"], ["select", "id"]]);
    expect(calls[2]!.ops).toEqual([["delete"], ["eq", "user_id", "u1"], ["eq", "connector", "github"], ["select", "id"]]);
  });

  it("pins a card once", async () => {
    const { db, calls } = fakeSupabase(ok(null));
    await db.pinCard("w1", "c1", { user_id: "u1", folder: "r", repo: "o/r" });
    expect(calls[0]!.ops).toEqual([["upsert", { worker_id: "w1", card_id: "c1", user_id: "u1", folder: "r", repo: "o/r" }, { onConflict: "worker_id,card_id", ignoreDuplicates: true }]]);
  });

  it("logs a mint, says replay on a duplicate nonce and throws on another error", async () => {
    const { db, calls } = fakeSupabase(ok({ id: 7 }), fail("duplicate key", "23505"), fail("down"), ok(null));
    const row = { user_id: "u1", worker_id: "w1", grant_id: null, connector: "github", card_id: "c", repo: "o/r", outcome: "refused" as const, reason: "in progress", token_kind: null, nonce: "n" };
    expect(await db.logMint(row)).toBe(7);
    expect(await db.logMint(row)).toBe("replay");
    await expect(db.logMint(row)).rejects.toThrow("Logging the request: down");
    await db.finishMint(7, { outcome: "minted" });
    expect(calls[0]!.ops).toEqual([["insert", row], ["select", "id"], ["single"]]);
    expect(calls[3]!.ops).toEqual([["update", { outcome: "minted" }], ["eq", "id", 7]]);
  });

  it("saves, deletes and claims the user's chain", async () => {
    const { db, calls } = fakeSupabase(ok(null), ok(null), ok([{ user_id: "u1" }]), ok([]), ok(null));
    await db.saveTokens({ user_id: "u1", refreshing_until: null });
    await db.deleteTokens("u1");
    expect(await db.claimRefresh("u1", "now", "until")).toBe(true);
    expect(await db.claimRefresh("u1", "now", "until")).toBe(false);
    expect(await db.claimRefresh("u1", "now", "until")).toBe(false);
    const [upsert, row, opts] = calls[0]!.ops[0] as [string, Record<string, unknown>, object];
    expect([upsert, row.user_id, row.refreshing_until, typeof row.updated_at, opts]).toEqual(["upsert", "u1", null, "string", { onConflict: "user_id" }]);
    expect(calls[1]!.ops).toEqual([["delete"], ["eq", "user_id", "u1"]]);
    expect(calls[2]!.ops).toEqual([["update", { refreshing_until: "until" }], ["eq", "user_id", "u1"], ["or", "refreshing_until.is.null,refreshing_until.lt.now"], ["select", "user_id"]]);
  });

  it("saves a live token and drops live tokens by id, skipping an empty list", async () => {
    const { db, calls } = fakeSupabase(ok(null), ok(null));
    const row = { user_id: "u1", worker_id: "w1", subject: "card:c", repo: "o/r", token_sealed: "s", issued_at: "t", expires_at: null };
    await db.saveLiveToken(row);
    await db.dropLiveTokens([]);
    await db.dropLiveTokens(["l1", "l2"]);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.ops).toEqual([["upsert", row, { onConflict: "worker_id,subject" }]]);
    expect(calls[1]!.ops).toEqual([["delete"], ["in", "id", ["l1", "l2"]]]);
  });
});
