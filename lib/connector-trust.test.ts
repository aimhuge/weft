import { describe, expect, it } from "vitest";
import { fakeDb, iso, NOW, pairedWorker } from "./connector.harness";
import { DAY, macKey, signedAllow, signedGrant, trustedMac, vouch } from "./connector-trust.harness";
import { allowProblem, fresh, grantProblem, isTrusted, pinProblem, SIGNED_FRESH_MS, verifyRaw } from "./connector-trust";

describe("verifyRaw", () => {
  it("checks a raw Ed25519 key's signature, and never throws", () => {
    const k = macKey();
    expect(verifyRaw(k.key, "hello", k.sign("hello"))).toBe(true);
    expect(verifyRaw(k.key, "hullo", k.sign("hello"))).toBe(false);
    expect(verifyRaw(macKey().key, "hello", k.sign("hello"))).toBe(false);
    expect(verifyRaw("c2hvcnQ=", "hello", k.sign("hello"))).toBe(false);
    expect(verifyRaw(k.key, "hello", "not base64 at all !!")).toBe(false);
  });
});

describe("isTrusted and fresh", () => {
  it("trusts a key from its time, until it's revoked", () => {
    expect(isTrusted({ trusted_from: iso(NOW), revoked_at: null }, NOW)).toBe(true);
    expect(isTrusted({ trusted_from: iso(NOW + 1), revoked_at: null }, NOW)).toBe(false);
    expect(isTrusted({ trusted_from: iso(NOW - DAY), revoked_at: iso(NOW) }, NOW)).toBe(false);
    expect(isTrusted(null, NOW)).toBe(false);
  });

  it("takes a time within SIGNED_FRESH_MS either way", () => {
    expect(fresh(NOW - SIGNED_FRESH_MS, NOW)).toBe(true);
    expect(fresh(NOW + SIGNED_FRESH_MS + 1, NOW)).toBe(false);
    expect(fresh(Number.NaN, NOW)).toBe(false);
  });
});

describe("grantProblem, allowProblem, pinProblem", () => {
  function setup() {
    const { db, state } = fakeDb();
    const mac = trustedMac(state);
    const w = pairedWorker(state);
    vouch(state, mac, w.worker);
    const grant = signedGrant(state, mac, { scope: "project", approval: "card", lifetime: "8h" });
    signedAllow(state, mac, grant, "card", "c1");
    return { db, state, mac, w, grant };
  }

  it("passes rows a trusted Mac of the user signed as they stand", async () => {
    const { db, state, w, grant } = setup();
    expect(await grantProblem(db, grant, NOW)).toBeNull();
    expect(await allowProblem(db, state.allows[0]!, "u1", NOW)).toBeNull();
    expect(await pinProblem(db, w.worker, NOW)).toBeNull();
  });

  it("refuses an Allow changed after signing, or claimed for another user", async () => {
    const { db, state } = setup();
    expect(await allowProblem(db, { ...state.allows[0]!, subject: "c2" }, "u1", NOW)).toContain("doesn't check");
    expect(await allowProblem(db, state.allows[0]!, "u2", NOW)).toContain("isn't signed by a Mac of yours");
  });

  it("refuses everything once the signer is revoked or not yet trusted", async () => {
    const { db, state, w, grant } = setup();
    state.signers[0]!.trusted_from = iso(NOW + 1);
    expect(await grantProblem(db, grant, NOW)).toContain("trusted now");
    expect(await pinProblem(db, w.worker, NOW)).toContain("isn't trusted now");
    state.signers[0]!.trusted_from = iso(NOW - DAY);
    state.signers[0]!.revoked_at = iso(NOW);
    expect(await allowProblem(db, state.allows[0]!, "u1", NOW)).toContain("trusted now");
  });

  it("refuses a grant whose signer is gone", async () => {
    const { db, state, grant } = setup();
    state.signers = [];
    expect(await grantProblem(db, grant, NOW)).toContain("isn't signed by a Mac of yours");
  });
});
