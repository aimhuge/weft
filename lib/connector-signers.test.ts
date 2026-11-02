import { describe, expect, it, vi } from "vitest";
import { endorseMessage, signerMessage } from "./connector-messages";
import { deps, fakeDb, fakeGithub, iso, NOW, noContent, pairedWorker, storeTokens, ticking, CFG } from "./connector.harness";
import { DAY, macKey, signedGrant, trustedMac } from "./connector-trust.harness";
import { endorseSigner, listSigners, MAX_SIGNERS, registerSigner, revokeSigner } from "./connector-signers";
import { COOLING_MS } from "./connector-trust";

function setup() {
  const clock = ticking();
  const { db, state } = fakeDb(clock);
  const notify = vi.fn(() => Promise.resolve());
  const gh = fakeGithub({ [`DELETE /applications/${CFG.clientId}/token`]: noContent });
  return { db, state, clock, notify, d: { ...deps(db, gh.fetch, clock), notify } };
}

// A Mac offering its key, signed by it, for user u1.
const offer = (k = macKey(), o: { name?: string; issuedAt?: number; userId?: string } = {}) => {
  const name = o.name ?? "Work Mac";
  const issuedAt = o.issuedAt ?? NOW;
  return { k, body: { key: k.key, name, device: "dev-1", issuedAt, sig: k.sign(signerMessage({ userId: o.userId ?? "u1", key: k.key, name, issuedAt })) } };
};

describe("registerSigner", () => {
  it("adds a new key that waits COOLING_MS and tells you", async () => {
    const { d, state, notify } = setup();
    const { body } = offer();
    const view = await registerSigner(d, "u1", body);
    expect(view).toMatchObject({ key: body.key, name: "Work Mac", trusted: false, endorsed: false });
    expect(Date.parse(view.trustedFrom) - Date.parse(state.signers[0]!.added_at)).toBeGreaterThanOrEqual(COOLING_MS - 5_000);
    expect(state.signers[0]).toMatchObject({ device: "dev-1", user_id: "u1" });
    expect(notify).toHaveBeenCalledWith("u1", "Weft: a new Mac key (Work Mac) for connectors", expect.stringContaining("can approve nothing until"));
    expect(state.mints.at(-1)).toMatchObject({ outcome: "notice", worker_id: null });
  });

  it("answers a live key as it is, without a second notice", async () => {
    const { d, state, notify } = setup();
    const { k, body } = offer();
    await registerSigner(d, "u1", body);
    const second = offer(k, { issuedAt: NOW + 2_000 }).body;
    expect((await registerSigner(d, "u1", second)).id).toBe(state.signers[0]!.id);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(state.signers).toHaveLength(1);
  });

  it("puts a revoked key back as new, waiting again", async () => {
    const { d, state } = setup();
    const mac = trustedMac(state, "u1", { revokedAt: iso(NOW - 1) });
    const name = "Back";
    const view = await registerSigner(d, "u1", { key: mac.key, name, issuedAt: NOW, sig: mac.sign(signerMessage({ userId: "u1", key: mac.key, name, issuedAt: NOW })) });
    expect(view.trusted).toBe(false);
    expect(state.signers.filter((s) => s.sign_key === mac.key)).toHaveLength(1);
  });

  it("refuses a malformed, stale, forged or other user's offer, and more than MAX_SIGNERS", async () => {
    const { d, state } = setup();
    await expect(registerSigner(d, "u1", null)).rejects.toMatchObject({ status: 400 });
    await expect(registerSigner(d, "u1", { ...offer().body, key: "short" })).rejects.toMatchObject({ status: 400 });
    await expect(registerSigner(d, "u1", { ...offer().body, sig: 5 })).rejects.toMatchObject({ status: 400 });
    await expect(registerSigner(d, "u1", offer(undefined, { issuedAt: NOW - 10 * 60_000 }).body)).rejects.toMatchObject({ status: 401, message: expect.stringContaining("too old") as string });
    await expect(registerSigner(d, "u1", offer(undefined, { userId: "u2" }).body)).rejects.toMatchObject({ status: 401, message: expect.stringContaining("doesn't check") as string });
    for (let i = 0; i < MAX_SIGNERS; i++) trustedMac(state);
    await expect(registerSigner(d, "u1", offer().body)).rejects.toMatchObject({ status: 409 });
  });

  it("names a Mac with no name, and cleans what it's given", async () => {
    const { d } = setup();
    const k = macKey();
    const sig = k.sign(signerMessage({ userId: "u1", key: k.key, name: "A Mac", issuedAt: NOW }));
    expect((await registerSigner(d, "u1", { key: k.key, name: 7, issuedAt: NOW, sig })).name).toBe("A Mac");
  });
});

describe("listSigners", () => {
  it("lists live keys, newest first, with whether each is trusted now", async () => {
    const { d, state } = setup();
    const old = trustedMac(state);
    const fresh = trustedMac(state, "u1", { trustedFrom: NOW + DAY });
    fresh.signer.added_at = iso(NOW);
    trustedMac(state, "u1", { revokedAt: iso(NOW) });
    trustedMac(state, "u2");
    const list = await listSigners(d, "u1");
    expect(list.map((s) => [s.id, s.trusted])).toEqual([
      [fresh.signer.id, false],
      [old.signer.id, true],
    ]);
  });
});

describe("endorseSigner", () => {
  function endorse(o: { by: ReturnType<typeof trustedMac>; key: string; issuedAt?: number }) {
    const issuedAt = o.issuedAt ?? NOW;
    return { key: o.key, by: o.by.key, issuedAt, sig: o.by.sign(endorseMessage({ userId: "u1", key: o.key, by: o.by.key, issuedAt })) };
  }

  it("trusts a waiting key now when a trusted Mac vouches for it, once", async () => {
    const { d, state, notify } = setup();
    const by = trustedMac(state, "u1", { name: "Old Mac" });
    const target = trustedMac(state, "u1", { trustedFrom: NOW + DAY, name: "New Mac" });
    const body = endorse({ by, key: target.key });
    const view = await endorseSigner(d, "u1", body);
    expect(view).toMatchObject({ trusted: true, endorsed: true });
    expect(state.signers.find((s) => s.id === target.signer.id)).toMatchObject({ endorsed_by: by.signer.id });
    expect(notify).toHaveBeenCalledWith("u1", "Weft: a Mac key (New Mac) is trusted for connectors", expect.stringContaining("Old Mac"));
    await expect(endorseSigner(d, "u1", body)).rejects.toMatchObject({ status: 401, message: "That was taken already." });
  });

  it("leaves an already-trusted key's time alone", async () => {
    const { d, state } = setup();
    const by = trustedMac(state);
    const target = trustedMac(state);
    const was = target.signer.trusted_from;
    expect((await endorseSigner(d, "u1", endorse({ by, key: target.key }))).trustedFrom).toBe(was);
  });

  it("refuses a malformed, stale, unknown, untrusted or forged vouch", async () => {
    const { d, state } = setup();
    const by = trustedMac(state);
    const waiting = trustedMac(state, "u1", { trustedFrom: NOW + DAY });
    const target = trustedMac(state, "u1", { trustedFrom: NOW + DAY });
    await expect(endorseSigner(d, "u1", undefined)).rejects.toMatchObject({ status: 400 });
    await expect(endorseSigner(d, "u1", endorse({ by, key: target.key, issuedAt: NOW - 10 * 60_000 }))).rejects.toMatchObject({ status: 401 });
    await expect(endorseSigner(d, "u1", endorse({ by, key: macKey().key }))).rejects.toMatchObject({ status: 404 });
    await expect(endorseSigner(d, "u1", endorse({ by: waiting, key: target.key }))).rejects.toMatchObject({ status: 403 });
    await expect(endorseSigner(d, "u1", { ...endorse({ by, key: target.key }), sig: by.sign("other") })).rejects.toMatchObject({ status: 401, message: "That signature doesn't check." });
    state.signers.find((s) => s.id === target.signer.id)!.revoked_at = iso(NOW);
    await expect(endorseSigner(d, "u1", endorse({ by, key: target.key }))).rejects.toMatchObject({ status: 404 });
  });
});

describe("revokeSigner", () => {
  it("takes the key's trust away and turns off the grants it signed", async () => {
    const { d, state } = setup();
    const mac = trustedMac(state);
    const other = trustedMac(state);
    pairedWorker(state);
    storeTokens(state, "u1");
    signedGrant(state, mac);
    signedGrant(state, other, { id: "g2", worker_id: "w2" });
    expect(await revokeSigner(d, "u1", mac.signer.id)).toEqual({ grants: 1 });
    expect(state.signers.find((s) => s.id === mac.signer.id)?.revoked_at).toBeTruthy();
    expect(state.grants.map((g) => g.id)).toEqual(["g2"]);
  });

  it("carries on past a grant whose worker can't be revoked", async () => {
    const { d, state } = setup();
    const mac = trustedMac(state);
    signedGrant(state, mac, { worker_id: "gone" });
    expect(await revokeSigner(d, "u1", mac.signer.id)).toEqual({ grants: 1 });
  });

  it("refuses a key that isn't yours", async () => {
    const { d, state } = setup();
    const theirs = trustedMac(state, "u2");
    await expect(revokeSigner(d, "u1", theirs.signer.id)).rejects.toMatchObject({ status: 404 });
    await expect(revokeSigner(d, "u1", "nope")).rejects.toMatchObject({ status: 404 });
  });
});
