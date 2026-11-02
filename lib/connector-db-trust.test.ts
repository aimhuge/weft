import { describe, expect, it } from "vitest";
import { supabaseTrustDb } from "./connector-db-trust";
import { fail, fakeSupabase as fake, ok, type R } from "./connector-db.harness";

const fakeSupabase = (...responses: R[]) => {
  const { client, calls } = fake(...responses);
  return { db: supabaseTrustDb(client), calls };
};

const SIGNER = "id, user_id, sign_key, name, device, added_at, trusted_from, endorsed_by, revoked_at, confirm_hash, confirm_expires_at, confirm_sent_at, revoke_hash";

describe("supabaseTrustDb: Mac keys", () => {
  it("reads a key by id or by user and key, and a user's keys", async () => {
    const { db, calls } = fakeSupabase(ok({ id: "s1" }), ok(null), ok([{ id: "s1" }]), ok(null));
    expect(await db.signerById("s1")).toEqual({ id: "s1" });
    expect(await db.signerByKey("u1", "k")).toBeNull();
    expect(await db.signers("u1")).toEqual([{ id: "s1" }]);
    expect(await db.signers("u1")).toEqual([]);
    expect(calls[0]!.ops).toEqual([["select", SIGNER], ["eq", "id", "s1"], ["maybeSingle"]]);
    expect(calls[1]!.ops.slice(1)).toEqual([["eq", "user_id", "u1"], ["eq", "sign_key", "k"], ["maybeSingle"]]);
  });

  it("saves a key as new (not revoked, not vouched), trusts and revokes one, and resends its link", async () => {
    const { db, calls } = fakeSupabase(ok({ id: "s1" }), ok(null), ok(null), fail("x"), ok(null), ok(null));
    expect(await db.saveSigner({ user_id: "u1", sign_key: "k", name: "Mac", device: null, trusted_from: null })).toEqual({ id: "s1" });
    await db.trustSigner("s1", "now", "s0");
    await db.revokeSigner("s1", "now");
    await expect(db.revokeSigner("s1", "now")).rejects.toThrow("Revoking the Mac key: x");
    await db.setConfirm("s1", { confirm_hash: "h", confirm_expires_at: "e", confirm_sent_at: "t" });
    await db.dropPinsBySigner("s1");
    const [op, row, opts] = calls[0]!.ops[0] as [string, Record<string, unknown>, object];
    expect([op, row.revoked_at, row.endorsed_by, row.trusted_from, typeof row.added_at, opts]).toEqual(["upsert", null, null, null, "string", { onConflict: "user_id,sign_key" }]);
    expect(calls[0]!.ops.slice(1)).toEqual([["select", SIGNER], ["single"]]);
    expect(calls[1]!.ops).toEqual([["update", { trusted_from: "now", endorsed_by: "s0", confirm_hash: null, confirm_expires_at: null }], ["eq", "id", "s1"]]);
    expect(calls[2]!.ops).toEqual([["update", { revoked_at: "now" }], ["eq", "id", "s1"]]);
    expect(calls[4]!.ops).toEqual([["update", { confirm_hash: "h", confirm_expires_at: "e", confirm_sent_at: "t" }], ["eq", "id", "s1"]]);
    expect(calls[5]).toEqual({ table: "connector_worker_pins", ops: [["delete"], ["eq", "signer_id", "s1"]] });
  });
});

describe("supabaseTrustDb: pins, nonces and signed writes", () => {
  it("reads and saves a worker's pin", async () => {
    const { db, calls } = fakeSupabase(ok({ worker_id: "w1" }), ok(null));
    expect(await db.workerPin("w1")).toEqual({ worker_id: "w1" });
    const pin = { worker_id: "w1", user_id: "u1", sign_key: "s", box_key: "b", signer_id: "s1", sig: "x" };
    await db.savePin(pin);
    const [op, row, opts] = calls[1]!.ops[0] as [string, Record<string, unknown>, object];
    expect([op, row.worker_id, typeof row.pinned_at, opts]).toEqual(["upsert", "w1", "string", { onConflict: "worker_id" }]);
  });

  it("takes a nonce once, and drops old ones", async () => {
    const { db, calls } = fakeSupabase(ok(null), fail("dup", "23505"), fail("down"), ok(null));
    expect(await db.takeNonce("u1", "n")).toBe(true);
    expect(await db.takeNonce("u1", "n")).toBe(false);
    await expect(db.takeNonce("u1", "n")).rejects.toThrow("Taking the nonce: down");
    await db.dropNoncesBefore("t");
    expect(calls[0]!.ops).toEqual([["insert", { user_id: "u1", nonce: "n" }]]);
    expect(calls[3]!.ops).toEqual([["delete"], ["lt", "at", "t"]]);
  });

  it("inserts a new grant at epoch 0, and updates one only at its epoch", async () => {
    const { db, calls } = fakeSupabase(ok(null), fail("dup", "23505"), fail("down"), ok([{ id: "g1" }]), ok([]), ok(null));
    const row = { user_id: "u1", worker_id: "w1", connector: "github", scope: "project", approval: "worker", lifetime: "revoked", asks: [], signer_id: "s1", sig: "x", nonce: "n", issued_at: "t", epoch: 1 };
    expect(await db.writeGrant(row, 0)).toBe(true);
    expect(await db.writeGrant(row, 0)).toBe(false);
    await expect(db.writeGrant(row, 0)).rejects.toThrow("Saving the grant: down");
    expect(await db.writeGrant({ ...row, epoch: 3 }, 2)).toBe(true);
    expect(await db.writeGrant({ ...row, epoch: 3 }, 2)).toBe(false);
    expect(await db.writeGrant({ ...row, epoch: 3 }, 2)).toBe(false);
    expect(calls[0]!.ops).toEqual([["insert", row]]);
    expect(calls[3]!.ops).toEqual([["update", { ...row, epoch: 3 }], ["eq", "user_id", "u1"], ["eq", "worker_id", "w1"], ["eq", "connector", "github"], ["eq", "epoch", 2], ["select", "id"]]);
  });

  it("saves an Allow over the one before it", async () => {
    const { db, calls } = fakeSupabase(ok(null));
    const row = { grant_id: "g1", user_id: "u1", kind: "card", subject: "c", signer_id: "s1", sig: "x", nonce: "n", issued_at: "t" };
    await db.saveAllow(row);
    expect(calls[0]!.ops).toEqual([["upsert", row, { onConflict: "grant_id,kind,subject" }]]);
  });

  it("reads the account's email through auth admin", async () => {
    const { db } = fakeSupabase(ok({ user: { email: "ada@example.com" } }), ok({ user: null }), ok({ user: {} }));
    expect(await db.userEmail("u1")).toBe("ada@example.com");
    expect(await db.userEmail("u2")).toBeNull();
    expect(await db.userEmail("u3")).toBeNull();
  });
});
