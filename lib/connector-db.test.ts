import { describe, expect, it } from "vitest";
import { supabaseConnectorDb } from "./connector-db";
import { fail, fakeSupabase as fake, ok, type R } from "./connector-db.harness";

const fakeSupabase = (...responses: R[]) => {
  const { client, calls } = fake(...responses);
  return { db: supabaseConnectorDb(client), calls };
};

const GRANT_COLS = "id, user_id, worker_id, connector, scope, approval, lifetime, asks, signer_id, sig, nonce, issued_at, epoch, expires_at, last_used_at";

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

  it("reads a grant by its owner and worker, or by id, with its signature and epoch", async () => {
    const { db, calls } = fakeSupabase(ok({ id: "g1" }), ok({ id: "g2" }));
    expect(await db.grant("u1", "w1", "github")).toEqual({ id: "g1" });
    expect(await db.grantById("g2")).toEqual({ id: "g2" });
    expect(calls[0]!.ops).toEqual([["select", GRANT_COLS], ["eq", "user_id", "u1"], ["eq", "worker_id", "w1"], ["eq", "connector", "github"], ["maybeSingle"]]);
    expect(calls[1]!.ops.slice(1)).toEqual([["eq", "id", "g2"], ["maybeSingle"]]);
  });

  it("reads expired grants in a batch, and a signer's grants", async () => {
    const { db, calls } = fakeSupabase(ok([{ id: "g1" }]), ok(null), ok([{ id: "g2" }]), ok(null));
    expect(await db.expiredGrants("t")).toEqual([{ id: "g1" }]);
    expect(await db.expiredGrants("t")).toEqual([]);
    expect(await db.grantsBySigner("s1")).toEqual([{ id: "g2" }]);
    expect(await db.grantsBySigner("s1")).toEqual([]);
    expect(calls[0]!.ops.slice(1)).toEqual([["lt", "expires_at", "t"], ["limit", 500]]);
    expect(calls[2]!.ops.slice(1)).toEqual([["eq", "signer_id", "s1"]]);
  });

  it("reads an Allow with its signature, the pinned card and the chain", async () => {
    const { db, calls } = fakeSupabase(ok({ grant_id: "g1" }), ok({ user_id: "u1", folder: "r", repo: "o/r" }), ok({ user_id: "u1" }));
    expect(await db.allow("g1", "card", "c1")).toEqual({ grant_id: "g1" });
    expect(await db.pinnedCard("w1", "c1")).toEqual({ user_id: "u1", folder: "r", repo: "o/r" });
    expect(await db.tokens("u1")).toEqual({ user_id: "u1" });
    expect(calls.map((c) => c.table)).toEqual(["connector_allows", "connector_cards", "connector_github_tokens"]);
    expect(calls[0]!.ops).toEqual([["select", "grant_id, kind, subject, signer_id, sig, nonce, issued_at"], ["eq", "grant_id", "g1"], ["eq", "kind", "card"], ["eq", "subject", "c1"], ["maybeSingle"]]);
  });

  it("reads owner-created starts: a card.create by its own card id, a run or new_card by the reported one", async () => {
    const { db, calls } = fakeSupabase(ok([{ kind: "run" }]), ok(null));
    expect(await db.starts("w1", "c1", "u1")).toEqual([{ kind: "run" }]);
    expect(await db.starts("w1", "c1", "u1")).toEqual([]);
    expect(calls[0]).toEqual({
      table: "cloud_commands",
      ops: [["select", "kind, folder, payload, created_by, created_at"], ["eq", "target_device", "worker:w1"], ["eq", "created_by", "u1"], ["or", "and(kind.eq.host,payload->args->>id.eq.c1),and(kind.in.(new_card,run),card_id.eq.c1)"], ["order", "created_at", { ascending: true }]],
    });
  });

  it("reads this worker's card's state from the cloud board", async () => {
    const { db, calls } = fakeSupabase(ok({ deleted: false, col: "done" }), ok(null));
    expect(await db.cardState("org1", "w1", "c1")).toEqual({ deleted: false, column: "done" });
    expect(await db.cardState("org1", "w1", "c2")).toBeNull();
    expect(calls[0]!.ops).toEqual([["select", "deleted, col:card->>column"], ["eq", "org_id", "org1"], ["eq", "owner_worker", "w1"], ["eq", "card_id", "c1"], ["maybeSingle"]]);
  });

  it("says whether a worker was handed a user token, by its issue time", async () => {
    const { db, calls } = fakeSupabase(ok([{ id: 1 }]), ok(null));
    expect(await db.handedUser("w1", "t")).toBe(true);
    expect(await db.handedUser("w1", "t")).toBe(false);
    expect(calls[0]!.ops).toEqual([["select", "id"], ["eq", "worker_id", "w1"], ["eq", "outcome", "minted"], ["eq", "token_kind", "user"], ["eq", "token_issued_at", "t"], ["limit", 1]]);
  });

  it("reads pending disconnects", async () => {
    const { db, calls } = fakeSupabase(ok([{ user_id: "u1" }]), ok(null));
    expect(await db.pendingDisconnects()).toEqual([{ user_id: "u1" }]);
    expect(await db.pendingDisconnects()).toEqual([]);
    expect(calls[0]!.ops.slice(1)).toEqual([["not", "disconnect_pending_at", "is", null], ["limit", 500]]);
  });

  it("reads one live token or the live tokens by worker, user or all", async () => {
    const { db, calls } = fakeSupabase(ok({ id: "l1" }), ok([{ id: "l1" }]), ok([{ id: "l2" }]), ok(null));
    expect(await db.liveToken("w1", "card:c1")).toEqual({ id: "l1" });
    expect(await db.liveTokens({ workerId: "w1" })).toEqual([{ id: "l1" }]);
    expect(await db.liveTokens({ userId: "u1" })).toEqual([{ id: "l2" }]);
    expect(await db.liveTokens({})).toEqual([]);
    expect(calls[1]!.ops.slice(1)).toEqual([["eq", "worker_id", "w1"], ["limit", 500]]);
    expect(calls[2]!.ops.slice(1)).toEqual([["eq", "user_id", "u1"], ["limit", 500]]);
    expect(calls[3]!.ops).toHaveLength(2);
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

  it("admits a request through connector_mint_admit: an id, a replay or a limit", async () => {
    const { db, calls } = fakeSupabase(ok(7), ok(-1), ok(-2), fail("down"));
    const row = { user_id: "u1", worker_id: "w1", grant_id: null, connector: "github", card_id: "c", repo: "o/r", outcome: "refused" as const, reason: "in progress", token_kind: null, nonce: "n" };
    const limits = { workerMinute: 1, workerHour: 2, userMinute: 3, userHour: 4 };
    expect(await db.admitMint(row, limits)).toBe(7);
    expect(await db.admitMint(row, limits)).toBe("replay");
    expect(await db.admitMint(row, limits)).toBe("limited");
    await expect(db.admitMint(row, limits)).rejects.toThrow("Logging the request: down");
    expect(calls[0]).toEqual({ table: "rpc:connector_mint_admit", ops: [[{ p_row: row, p_worker_minute: 1, p_worker_hour: 2, p_user_minute: 3, p_user_hour: 4 }]] });
  });

  it("logs a ledger row and finishes one", async () => {
    const { db, calls } = fakeSupabase(ok(null), ok(null), fail("x"));
    const row = { user_id: "u1", worker_id: null, grant_id: null, connector: "github", card_id: null, repo: null, outcome: "notice" as const, reason: "r", token_kind: null, nonce: null };
    await db.logMint(row);
    await db.finishMint(7, { outcome: "minted" });
    await expect(db.logMint(row)).rejects.toThrow("Logging: x");
    expect(calls[0]!.ops).toEqual([["insert", row]]);
    expect(calls[1]!.ops).toEqual([["update", { outcome: "minted" }], ["eq", "id", 7]]);
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

  it("claims the making of a narrowed token: a new claim, an expired one, or not; and lets it go", async () => {
    const { db, calls } = fakeSupabase(ok(null), fail("dup", "23505"), ok([{ subject: "s" }]), fail("dup", "23505"), ok([]), fail("dup", "23505"), ok(null), fail("down"), ok(null));
    expect(await db.claimLive("w1", "s", "now", "until")).toBe(true);
    expect(await db.claimLive("w1", "s", "now", "until")).toBe(true);
    expect(await db.claimLive("w1", "s", "now", "until")).toBe(false);
    expect(await db.claimLive("w1", "s", "now", "until")).toBe(false);
    await expect(db.claimLive("w1", "s", "now", "until")).rejects.toThrow("Claiming the token: down");
    await db.releaseLive("w1", "s");
    expect(calls[0]).toEqual({ table: "connector_live_claims", ops: [["insert", { worker_id: "w1", subject: "s", until: "until" }]] });
    expect(calls[2]!.ops).toEqual([["update", { until: "until" }], ["eq", "worker_id", "w1"], ["eq", "subject", "s"], ["lt", "until", "now"], ["select", "subject"]]);
    expect(calls.at(-1)!.ops).toEqual([["delete"], ["eq", "worker_id", "w1"], ["eq", "subject", "s"]]);
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
