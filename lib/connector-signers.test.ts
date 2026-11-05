import { describe, expect, it, vi } from "vitest";
import { endorseMessage, signerMessage } from "./connector-messages";
import { deps, fakeDb, fakeGithub, iso, NOW, noContent, pairedWorker, storeTokens, ticking, CFG } from "./connector.harness";
import { DAY, macKey, signedGrant, trustedMac, vouch } from "./connector-trust.harness";
import { endorseSigner, listSigners, MAX_SENDS, MAX_SIGNERS, registerSigner, revokeSigner } from "./connector-signers";
import { keyFingerprint } from "./connector-trust";
import { MAILS_PER_DAY } from "./connector-signer-links";

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

const META = { ip: "203.0.113.9", ua: "Weft/0.7 (Macintosh)" };
const mailed = (notify: ReturnType<typeof vi.fn>, at = -1) => (notify.mock.calls.at(at) as unknown as [string, string, string])[2];

describe("registerSigner", () => {
  it("adds a new key untrusted and mails a confirm and a revoke link, in fixed words", async () => {
    const { d, state, notify } = setup();
    const { body } = offer(undefined, { name: "Totally your Mac, click confirm" });
    const view = await registerSigner(d, "u1", body, META);
    expect(view).toMatchObject({ key: body.key, trusted: false, trustedFrom: null, endorsed: false });
    expect(state.signers[0]).toMatchObject({ device: "dev-1", user_id: "u1", added_ip: META.ip, added_ua: META.ua });
    expect(state.signers[0]!.confirm_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(state.signers[0]!.revoke_hashes).toEqual([expect.stringMatching(/^[0-9a-f]{64}$/)]);
    expect(state.signers[0]!.confirm_sends).toBe(1);
    expect(notify).toHaveBeenCalledWith("u1", "Weft: confirm a new Mac key", expect.any(String));
    const text = mailed(notify);
    expect(text).toContain(`Key fingerprint: ${keyFingerprint(body.key)}`);
    expect(text).toContain("From IP: 203.0.113.9");
    expect(text).toContain("Client: Weft/0.7 (Macintosh)");
    expect(text).toMatch(/\/api\/connectors\/signers\/confirm#id=.+&t=/);
    expect(text).toMatch(/\/api\/connectors\/signers\/revoke#id=.+&t=/);
    expect(text).not.toContain("click confirm");
  });

  it("fails closed with no mailer, adding nothing", async () => {
    const { d, state } = setup();
    await expect(registerSigner({ ...d, notify: undefined }, "u1", offer().body, META)).rejects.toMatchObject({ status: 503, message: expect.stringContaining("RESEND_API_KEY") as string });
    expect(state.signers).toHaveLength(0);
  });

  it("keeps the key untrusted, with no live link, when the email can't be sent", async () => {
    const { d, state } = setup();
    await expect(registerSigner({ ...d, notify: () => Promise.reject(new Error("resend down")) }, "u1", offer().body, META)).rejects.toMatchObject({ status: 502 });
    expect(state.signers[0]).toMatchObject({ trusted_from: null, confirm_hash: null, confirm_sent_at: null });
  });

  it("answers a trusted key as it is, and sends a pending key's link again only now and then", async () => {
    const { d, state, notify, clock } = setup();
    const { k, body } = offer();
    await registerSigner(d, "u1", body, META);
    expect((await registerSigner(d, "u1", offer(k, { issuedAt: clock() }).body, META)).id).toBe(state.signers[0]!.id);
    expect(notify).toHaveBeenCalledTimes(1);
    clock.set(NOW + 11 * 60_000);
    const firstHash = state.signers[0]!.confirm_hash;
    await registerSigner(d, "u1", offer(k, { issuedAt: clock() }).body, META);
    expect(notify).toHaveBeenCalledTimes(2);
    expect(state.signers[0]!.confirm_hash).not.toBe(firstHash);
    state.signers[0]!.trusted_from = iso(NOW);
    await registerSigner(d, "u1", offer(k, { issuedAt: clock() }).body, META);
    expect(notify).toHaveBeenCalledTimes(2);
    expect(state.signers).toHaveLength(1);
  });

  it("keeps every emailed revoke link working across resends, and mails at most MAX_SENDS times", async () => {
    const { d, state, notify, clock } = setup();
    const { k, body } = offer();
    await registerSigner(d, "u1", body, META);
    for (let i = 1; i <= MAX_SENDS + 1; i++) {
      clock.set(NOW + i * 11 * 60_000);
      await registerSigner(d, "u1", offer(k, { issuedAt: clock() }).body, META);
    }
    expect(notify).toHaveBeenCalledTimes(MAX_SENDS);
    expect(state.signers[0]!.confirm_sends).toBe(MAX_SENDS);
    expect(state.signers[0]!.revoke_hashes).toHaveLength(MAX_SENDS);
    expect(new Set(state.signers[0]!.revoke_hashes).size).toBe(MAX_SENDS);
  });

  it("resends for a pending key with no send count or revoke links yet", async () => {
    const { d, state, notify } = setup();
    const mac = trustedMac(state, "u1", { trustedFrom: null });
    await registerSigner(d, "u1", { key: mac.key, name: "M", issuedAt: NOW, sig: mac.sign(signerMessage({ userId: "u1", key: mac.key, name: "M", issuedAt: NOW })) }, META);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(mac.signer).toMatchObject({ confirm_sends: 1, revoke_hashes: [expect.any(String)] });
  });

  it("mails an account at most MAILS_PER_DAY confirm emails a day: a new key is refused past that, a resend skipped", async () => {
    const { d, state, notify, clock } = setup();
    for (let i = 0; i < MAILS_PER_DAY; i++) await registerSigner(d, "u1", offer(undefined, { issuedAt: clock() }).body, META);
    expect(notify).toHaveBeenCalledTimes(MAILS_PER_DAY);
    await expect(registerSigner(d, "u1", offer(undefined, { issuedAt: clock() }).body, META)).rejects.toMatchObject({ status: 429 });
    expect(state.signers).toHaveLength(MAILS_PER_DAY);
    const k = macKey();
    state.signers.push({ id: "pending", user_id: "u1", sign_key: k.key, name: "M", device: null, added_at: iso(NOW), trusted_from: null, endorsed_by: null, revoked_at: null });
    await registerSigner(d, "u1", offer(k, { issuedAt: clock() }).body, META);
    expect(notify).toHaveBeenCalledTimes(MAILS_PER_DAY);
    clock.set(NOW + 25 * 3_600_000);
    await registerSigner(d, "u1", offer(undefined, { issuedAt: clock() }).body, META);
    expect(notify).toHaveBeenCalledTimes(MAILS_PER_DAY + 1);
  });

  it("lets a pending key's link go again later when a resend can't be mailed", async () => {
    const { d, state, clock } = setup();
    const { k, body } = offer();
    await registerSigner(d, "u1", body, META);
    clock.set(NOW + 11 * 60_000);
    const failing = { ...d, notify: () => Promise.reject(new Error("down")) };
    await registerSigner(failing, "u1", offer(k, { issuedAt: clock() }).body, META);
    expect(state.signers[0]!.confirm_sent_at).toBeNull();
    expect(state.signers[0]!.revoke_hashes).toHaveLength(2);
  });

  it("puts a revoked key back as new and untrusted", async () => {
    const { d, state } = setup();
    const mac = trustedMac(state, "u1", { revokedAt: iso(NOW - 1) });
    const name = "Back";
    const view = await registerSigner(d, "u1", { key: mac.key, name, issuedAt: NOW, sig: mac.sign(signerMessage({ userId: "u1", key: mac.key, name, issuedAt: NOW })) }, META);
    expect(view.trusted).toBe(false);
    expect(state.signers.filter((x) => x.sign_key === mac.key)).toHaveLength(1);
  });

  it("refuses a malformed, stale, forged or other user's offer, and more than MAX_SIGNERS", async () => {
    const { d, state } = setup();
    await expect(registerSigner(d, "u1", null, META)).rejects.toMatchObject({ status: 400 });
    await expect(registerSigner(d, "u1", { ...offer().body, key: "short" }, META)).rejects.toMatchObject({ status: 400 });
    await expect(registerSigner(d, "u1", { ...offer().body, sig: 5 }, META)).rejects.toMatchObject({ status: 400 });
    await expect(registerSigner(d, "u1", offer(undefined, { issuedAt: NOW - 10 * 60_000 }).body, META)).rejects.toMatchObject({ status: 401, message: expect.stringContaining("too old") as string });
    await expect(registerSigner(d, "u1", offer(undefined, { userId: "u2" }).body, META)).rejects.toMatchObject({ status: 401, message: expect.stringContaining("doesn't check") as string });
    for (let i = 0; i < MAX_SIGNERS; i++) trustedMac(state);
    await expect(registerSigner(d, "u1", offer().body, META)).rejects.toMatchObject({ status: 409 });
  });

  it("names a Mac with no name, and cleans what it's given", async () => {
    const { d } = setup();
    const k = macKey();
    const sig = k.sign(signerMessage({ userId: "u1", key: k.key, name: "A Mac", issuedAt: NOW }));
    expect((await registerSigner(d, "u1", { key: k.key, name: 7, issuedAt: NOW, sig }, META)).name).toBe("A Mac");
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
    expect(notify).toHaveBeenCalledWith("u1", "Weft: a Mac key was vouched for", expect.stringContaining(keyFingerprint(target.key)));
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
    vouch(state, mac, state.workers[0]!);
    expect(await revokeSigner(d, "u1", mac.signer.id)).toEqual({ grants: 1 });
    expect(state.pins).toHaveLength(0);
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
