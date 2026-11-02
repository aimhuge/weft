import { describe, expect, it } from "vitest";
import { sealToken } from "./connector-crypto";
import { CFG, deps, fakeDb, fakeGithub, grantRow, iso, json, KEY, noContent, NOW, pair, pairedWorker, storeTokens, type FakeState, type Route } from "./connector.harness";
import { disconnect, revokeWorker } from "./connector-revoke";
import { bound } from "./connector-tokens";

const REFRESH = "POST /login/oauth/access_token";
const DELETE = `DELETE /applications/${CFG.clientId}/token`;
const GRANT = `DELETE /applications/${CFG.clientId}/grant`;
const basic = `Basic ${Buffer.from(`${CFG.clientId}:${CFG.clientSecret}`).toString("base64")}`;

function live(state: FakeState, id: string, token: string, o: { worker?: string; seal?: string; expiresAt?: string | null } = {}) {
  const worker = o.worker ?? "w1";
  state.live.push({ id, user_id: "u1", worker_id: worker, subject: `card:${id}`, repo: "o/r", token_sealed: sealToken(token, o.seal ?? bound.live(worker, `card:${id}`), KEY), issued_at: iso(NOW), expires_at: o.expiresAt ?? null });
}

function handedUserToken(state: FakeState, at = NOW) {
  state.mints.push({ id: 99, at: iso(at), user_id: "u1", worker_id: "w1", grant_id: "g1", connector: "github", card_id: "c", repo: "o/r", outcome: "minted", reason: null, token_kind: "user", nonce: "n" });
}

function setup(routes: Record<string, Route> = {}) {
  const { db, state } = fakeDb();
  pairedWorker(state);
  state.grants.push(grantRow(), grantRow({ id: "g2", worker_id: "w2" }));
  storeTokens(state, "u1");
  const gh = fakeGithub({ [DELETE]: (body) => ((body as { access_token: string }).access_token === "ghu_stuck" ? json({}, 422) : noContent()), [REFRESH]: () => pair("ghu_new", "ghr_new"), [GRANT]: noContent, ...routes });
  return { db, state, gh, d: deps(db, gh.fetch) };
}

describe("revokeWorker", () => {
  it("refuses a worker that isn't yours", async () => {
    const { d } = setup();
    await expect(revokeWorker(d, "u2", "w1")).rejects.toMatchObject({ status: 404 });
    await expect(revokeWorker(d, "u1", "nope")).rejects.toMatchObject({ status: 404 });
  });

  it("deletes the grant, ends live tokens at GitHub, rotates a handed-out user token and logs it", async () => {
    const { d, state, gh } = setup();
    live(state, "a", "ghu_a");
    live(state, "b", "ghu_stuck", { expiresAt: "2026-11-02T20:00:00Z" });
    live(state, "c", "ghu_c", { seal: "live:other:x" });
    live(state, "d", "ghu_d", { worker: "w2" });
    handedUserToken(state);
    const answer = await revokeWorker(d, "u1", "w1");
    expect(answer).toEqual({ grants: 1, tokensRevoked: 2, unconfirmed: [{ expiresAt: "2026-11-02T20:00:00Z" }, { expiresAt: null }], userToken: "rotated" });
    expect(state.grants.map((g) => g.id)).toEqual(["g2"]);
    expect(state.live.map((l) => l.id)).toEqual(["d"]);
    const deletes = gh.called("DELETE", "/token");
    expect(deletes.map((c) => c.body)).toEqual([{ access_token: "ghu_a" }, { access_token: "ghu_stuck" }]);
    expect(deletes[0]!.headers.authorization).toBe(basic);
    expect(gh.called("POST", "/login/oauth/access_token")).toHaveLength(1);
    expect(state.mints.at(-1)).toMatchObject({ outcome: "revoked", worker_id: "w1", reason: "1 narrowed revoked; user token rotated", nonce: null });
  });

  it("leaves the user token alone when this worker wasn't handed the current one", async () => {
    const { d, state, gh } = setup();
    handedUserToken(state, NOW - 3_600_000);
    expect((await revokeWorker(d, "u1", "w1")).userToken).toBe("not handed out");
    expect(gh.calls).toHaveLength(0);
  });

  it("says not handed out when there's no chain or no access token", async () => {
    const none = setup();
    none.state.tokens.clear();
    expect(await revokeWorker(none.d, "u1", "w1")).toMatchObject({ userToken: "not handed out", tokensRevoked: 0 });
    const noAccess = setup();
    storeTokens(noAccess.state, "u1", { access: null, issuedAt: null });
    expect((await revokeWorker(noAccess.d, "u1", "w1")).userToken).toBe("not handed out");
  });

  it("deletes the user token when the refresh fails", async () => {
    const { d, state, gh } = setup({ [REFRESH]: () => json({ error: "bad_refresh_token" }) });
    handedUserToken(state);
    expect(await revokeWorker(d, "u1", "w1")).toMatchObject({ userToken: "deleted", tokensRevoked: 1 });
    expect(gh.called("DELETE", "/token")[0]!.body).toEqual({ access_token: "ghu_old" });
  });

  it("reports the user token unconfirmed when neither the refresh nor the delete worked", async () => {
    const failing = setup({ [REFRESH]: () => json({ error: "x" }), [DELETE]: () => json({}, 500) });
    handedUserToken(failing.state);
    expect(await revokeWorker(failing.d, "u1", "w1")).toMatchObject({ userToken: "unconfirmed", tokensRevoked: 0 });
    const unopenable = setup({ [REFRESH]: () => json({ error: "x" }) });
    handedUserToken(unopenable.state);
    unopenable.state.tokens.get("u1")!.access_sealed = sealToken("ghu_old", "access:someone", KEY);
    expect((await revokeWorker(unopenable.d, "u1", "w1")).userToken).toBe("unconfirmed");
    expect(unopenable.gh.called("DELETE", "/token")).toHaveLength(0);
  });
});

describe("disconnect", () => {
  it("deletes every grant and live token, and says none when GitHub was never connected", async () => {
    const { d, state, gh } = setup();
    state.tokens.clear();
    live(state, "a", "ghu_a");
    expect(await disconnect(d, "u1")).toEqual({ grants: 2, authorization: "none" });
    expect(state.grants).toHaveLength(0);
    expect(state.live).toHaveLength(0);
    expect(gh.calls).toHaveLength(0);
  });

  it("deletes the whole authorization with the access token and forgets the chain", async () => {
    const { d, state, gh } = setup();
    expect(await disconnect(d, "u1")).toEqual({ grants: 2, authorization: "deleted" });
    expect(gh.called("DELETE", "/grant")[0]).toMatchObject({ body: { access_token: "ghu_old" }, headers: { authorization: basic } });
    expect(state.tokens.has("u1")).toBe(false);
  });

  it("is unconfirmed when GitHub won't delete the authorization, and forgets the chain anyway", async () => {
    const { d, state } = setup({ [GRANT]: () => json({}, 422) });
    expect((await disconnect(d, "u1")).authorization).toBe("unconfirmed");
    expect(state.tokens.has("u1")).toBe(false);
  });

  it("refreshes first when no access token opens", async () => {
    const { d, state, gh } = setup();
    storeTokens(state, "u1", { access: null, issuedAt: null });
    expect((await disconnect(d, "u1")).authorization).toBe("deleted");
    expect(gh.called("DELETE", "/grant")[0]!.body).toEqual({ access_token: "ghu_new" });
  });

  it("is unconfirmed when the refresh or the delete after it fails", async () => {
    const refreshFails = setup({ [REFRESH]: () => json({ error: "x" }) });
    storeTokens(refreshFails.state, "u1", { access: null, issuedAt: null });
    expect((await disconnect(refreshFails.d, "u1")).authorization).toBe("unconfirmed");
    const deleteFails = setup({ [GRANT]: () => json({}, 500) });
    storeTokens(deleteFails.state, "u1", { access: null, issuedAt: null });
    expect((await disconnect(deleteFails.d, "u1")).authorization).toBe("unconfirmed");
  });
});
