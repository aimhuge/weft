import { describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { settingsOf, type GrantSettings } from "./connector-grant";
import { allowMessage, grantMessage, workerMessage } from "./connector-messages";
import { CFG, deps, fakeDb, fakeGithub, iso, json, noContent, NOW, pair, pairedWorker, storeTokens, ticking } from "./connector.harness";
import { DAY, signedGrant, trustedMac, vouch, type Mac } from "./connector-trust.harness";
import { pinWorker, writeAllow, writeGrant } from "./connector-signed";

const W = "00000000-0000-4000-8000-000000000001";

function setup(o: { macTrustedFrom?: number; vouched?: boolean } = {}) {
  const clock = ticking();
  const { db, state } = fakeDb(clock);
  const w = pairedWorker(state, { id: W, name: "m1mini" });
  const mac = trustedMac(state, "u1", { trustedFrom: o.macTrustedFrom, name: "MacBook" });
  if (o.vouched !== false) vouch(state, mac, w.worker);
  storeTokens(state, "u1");
  const notify = vi.fn(() => Promise.resolve());
  const gh = fakeGithub({ [`DELETE /applications/${CFG.clientId}/token`]: noContent, "POST /login/oauth/access_token": () => pair("ghu_new", "ghr_new") });
  return { db, state, w, mac, notify, gh, d: { ...deps(db, gh.fetch, clock), notify } };
}

const nonce = () => randomBytes(16).toString("hex");

function grantBody(mac: Mac, o: { settings?: Partial<GrantSettings>; prevEpoch?: number; issuedAt?: number; userId?: string; workerId?: string } = {}) {
  const settings = settingsOf({ scope: "project", ...o.settings });
  const statement = { userId: o.userId ?? "u1", workerId: o.workerId ?? W, connector: "github", settings, nonce: nonce(), issuedAt: o.issuedAt ?? NOW, prevEpoch: o.prevEpoch ?? 0 };
  return { workerId: statement.workerId, connector: "github", settings, nonce: statement.nonce, issuedAt: statement.issuedAt, prevEpoch: statement.prevEpoch, signerKey: mac.key, sig: mac.sign(grantMessage(statement)) };
}

describe("pinWorker", () => {
  const pinBody = (mac: Mac, signKey: string, o: { boxKey?: string; workerId?: string } = {}) => ({
    workerId: o.workerId ?? W,
    signKey,
    boxKey: o.boxKey ?? "box",
    signerKey: mac.key,
    sig: mac.sign(workerMessage({ userId: "u1", workerId: o.workerId ?? W, signKey, boxKey: o.boxKey ?? "box" })),
  });

  it("stores a worker vouched for, tells you the first time, and says when a waiting key starts to count", async () => {
    const { d, state, w, mac, notify } = setup({ vouched: false, macTrustedFrom: NOW + DAY });
    expect(await pinWorker(d, "u1", pinBody(mac, w.worker.sign_key!), { ip: "203.0.113.9", ua: "Weft" })).toEqual({ ok: true, waiting: true });
    expect(state.pins[0]).toMatchObject({ worker_id: W, sign_key: w.worker.sign_key, box_key: "box", signer_id: mac.signer.id });
    expect(notify).toHaveBeenCalledWith("u1", "Weft: a worker was vouched for", expect.stringContaining(`worker ${W}`));
    expect(notify).toHaveBeenCalledWith("u1", expect.any(String), expect.stringContaining("From IP 203.0.113.9, client Weft."));
    expect(notify).not.toHaveBeenCalledWith("u1", expect.any(String), expect.stringContaining("MacBook"));
    await pinWorker(d, "u1", pinBody(mac, w.worker.sign_key!));
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("refuses a malformed body, an unregistered key, a worker not yours, another sign key or a bad signature", async () => {
    const { d, state, w, mac } = setup();
    await expect(pinWorker(d, "u1", {})).rejects.toMatchObject({ status: 400 });
    await expect(pinWorker(d, "u1", { ...pinBody(mac, w.worker.sign_key!), signerKey: "unknown" })).rejects.toMatchObject({ status: 403 });
    await expect(pinWorker(d, "u2", pinBody(mac, w.worker.sign_key!))).rejects.toMatchObject({ status: 403 });
    await expect(pinWorker(d, "u1", pinBody(mac, w.worker.sign_key!, { workerId: "00000000-0000-4000-8000-000000000009" }))).rejects.toMatchObject({ status: 404 });
    await expect(pinWorker(d, "u1", pinBody(mac, "another-key"))).rejects.toMatchObject({ status: 409 });
    await expect(pinWorker(d, "u1", { ...pinBody(mac, w.worker.sign_key!), boxKey: "swapped" })).rejects.toMatchObject({ status: 401 });
    state.workers[0]!.revoked_at = iso(NOW);
    await expect(pinWorker(d, "u1", pinBody(mac, w.worker.sign_key!))).rejects.toMatchObject({ status: 404 });
    state.signers[0]!.revoked_at = iso(NOW);
    await expect(pinWorker(d, "u1", pinBody(mac, w.worker.sign_key!))).rejects.toMatchObject({ status: 403 });
  });
});

describe("writeGrant", () => {
  it("turns a connector on at epoch 1 and tells you", async () => {
    const { d, state, mac, notify } = setup();
    expect(await writeGrant(d, "u1", grantBody(mac))).toEqual({ ok: true, epoch: 1, waiting: false, tokensRevoked: 0 });
    expect(state.grants[0]).toMatchObject({ worker_id: W, scope: "project", epoch: 1, signer_id: mac.signer.id });
    expect(notify).toHaveBeenCalledWith("u1", "Weft: GitHub was turned on for a worker", expect.stringContaining(`worker ${W}`));
  });

  it("changes it only at the epoch the signature named, and never re-creates one turned off", async () => {
    const { d, state, mac } = setup();
    await writeGrant(d, "u1", grantBody(mac));
    await expect(writeGrant(d, "u1", grantBody(mac, { prevEpoch: 0 }))).rejects.toMatchObject({ status: 409 });
    expect((await writeGrant(d, "u1", grantBody(mac, { prevEpoch: 1, settings: { scope: "installed" } }))).epoch).toBe(2);
    const stale = grantBody(mac, { prevEpoch: 2, settings: { scope: "card" } });
    state.grants = [];
    await expect(writeGrant(d, "u1", stale)).rejects.toMatchObject({ status: 409 });
  });

  it("refuses when the epoch moved between the read and the write", async () => {
    const { d, mac, db } = setup();
    const raced = { ...d, db: { ...db, writeGrant: () => Promise.resolve(false) } };
    await expect(writeGrant(raced, "u1", grantBody(mac))).rejects.toMatchObject({ status: 409 });
  });

  it("ends the worker's tokens when a change is stricter", async () => {
    const { d, state, mac, gh } = setup();
    signedGrant(state, mac, { worker_id: W, scope: "installed" });
    state.mints.push({ id: 900, at: iso(NOW - 70_000), user_id: "u1", worker_id: W, grant_id: "g1", connector: "github", card_id: "c", repo: "o/r", outcome: "minted", reason: null, token_kind: "user", token_issued_at: iso(NOW - 60_000), nonce: "n" });
    const r = await writeGrant(d, "u1", grantBody(mac, { prevEpoch: 1, settings: { scope: "project" } }));
    expect(r).toMatchObject({ epoch: 2, tokensRevoked: 1 });
    expect(gh.called("POST", "/login/oauth/access_token")).toHaveLength(1);
  });

  it("refuses a replay, a stale or forged statement, a worker not vouched for and an unknown connector", async () => {
    const { d, mac, state } = setup();
    const body = grantBody(mac);
    await writeGrant(d, "u1", body);
    await expect(writeGrant(d, "u1", { ...grantBody(mac, { prevEpoch: 1 }), nonce: body.nonce, sig: mac.sign(grantMessage({ userId: "u1", workerId: W, connector: "github", settings: settingsOf({ scope: "project" }), nonce: body.nonce, issuedAt: NOW, prevEpoch: 1 })) })).rejects.toMatchObject({ status: 401, message: expect.stringContaining("used already") as string });
    await expect(writeGrant(d, "u1", grantBody(mac, { prevEpoch: 1, issuedAt: NOW - 10 * 60_000 }))).rejects.toMatchObject({ status: 401, message: expect.stringContaining("too old") as string });
    await expect(writeGrant(d, "u1", { ...grantBody(mac, { prevEpoch: 1 }), settings: { scope: "installed" } })).rejects.toMatchObject({ status: 401, message: expect.stringContaining("doesn't check") as string });
    await expect(writeGrant(d, "u1", { ...grantBody(mac, { prevEpoch: 1 }), nonce: "zz" })).rejects.toMatchObject({ status: 401 });
    await expect(writeGrant(d, "u1", { ...grantBody(mac), connector: "gitlab" })).rejects.toMatchObject({ status: 400 });
    await expect(writeGrant(d, "u1", { ...grantBody(mac), prevEpoch: -1 })).rejects.toMatchObject({ status: 400 });
    await expect(writeGrant(d, "u1", null)).rejects.toMatchObject({ status: 400 });
    state.pins = [];
    await expect(writeGrant(d, "u1", grantBody(mac, { prevEpoch: 1 }))).rejects.toMatchObject({ status: 409, message: expect.stringContaining("vouched") as string });
    state.workers[0]!.sign_key = null;
    await expect(writeGrant(d, "u1", grantBody(mac, { prevEpoch: 1 }))).rejects.toMatchObject({ status: 404 });
  });

  it("takes a pending key's grant and says it waits", async () => {
    const { d, mac } = setup({ macTrustedFrom: NOW + DAY });
    expect((await writeGrant(d, "u1", grantBody(mac))).waiting).toBe(true);
  });

  it("refuses another user's worker", async () => {
    const { d, state } = setup();
    const theirs = trustedMac(state, "u2");
    await expect(writeGrant(d, "u2", grantBody(theirs, { userId: "u2" }))).rejects.toMatchObject({ status: 404 });
  });
});

describe("writeAllow", () => {
  const allowBody = (mac: Mac, grantId: string, o: { subject?: string; issuedAt?: number } = {}) => {
    const statement = { userId: "u1", grantId, kind: "card" as const, subject: o.subject ?? "c1", nonce: nonce(), issuedAt: o.issuedAt ?? NOW };
    return { ...statement, signerKey: mac.key, sig: mac.sign(allowMessage(statement)) };
  };

  it("refuses a nonce that isn't hex, and a signer key that isn't a string", async () => {
    const { d, state, mac } = setup();
    const grant = signedGrant(state, mac, { worker_id: W });
    const statement = { userId: "u1", grantId: grant.id, kind: "card" as const, subject: "c1", nonce: "123", issuedAt: NOW };
    await expect(writeAllow(d, "u1", { ...statement, nonce: 123, signerKey: mac.key, sig: mac.sign(allowMessage(statement)) })).rejects.toMatchObject({ status: 400, message: "Send a nonce." });
    await expect(writeAllow(d, "u1", { ...allowBody(mac, grant.id), signerKey: 5 })).rejects.toMatchObject({ status: 403 });
  });

  it("stores a signed Allow for a grant of yours", async () => {
    const { d, state, mac } = setup();
    const grant = signedGrant(state, mac, { worker_id: W });
    expect(await writeAllow(d, "u1", allowBody(mac, grant.id))).toEqual({ ok: true });
    expect(state.allows[0]).toMatchObject({ grant_id: grant.id, kind: "card", subject: "c1", signer_id: mac.signer.id, user_id: "u1" });
  });

  it("refuses a malformed, forged, stale Allow or one for a grant not yours", async () => {
    const { d, state, mac } = setup();
    const grant = signedGrant(state, mac, { worker_id: W });
    const theirs = signedGrant(state, trustedMac(state, "u2"), { id: "g9", user_id: "u2", worker_id: W });
    await expect(writeAllow(d, "u1", { ...allowBody(mac, grant.id), kind: "repo" })).rejects.toMatchObject({ status: 400 });
    await expect(writeAllow(d, "u1", { ...allowBody(mac, grant.id), subject: "" })).rejects.toMatchObject({ status: 400 });
    await expect(writeAllow(d, "u1", allowBody(mac, theirs.id))).rejects.toMatchObject({ status: 404 });
    await expect(writeAllow(d, "u1", { ...allowBody(mac, grant.id), subject: "c2" })).rejects.toMatchObject({ status: 401 });
    await expect(writeAllow(d, "u1", allowBody(mac, grant.id, { issuedAt: NOW - 10 * 60_000 }))).rejects.toMatchObject({ status: 401 });
    expect(state.allows).toHaveLength(0);
  });

  it("keeps working when GitHub misbehaves elsewhere", async () => {
    const { state, mac, db } = setup();
    const grant = signedGrant(state, mac, { worker_id: W });
    const d = deps(db, fakeGithub({ "POST /login/oauth/access_token": () => json({ error: "x" }) }).fetch, ticking());
    expect(await writeAllow(d, "u1", allowBody(mac, grant.id))).toEqual({ ok: true });
  });
});
