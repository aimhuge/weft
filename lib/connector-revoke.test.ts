import { describe, expect, it } from "vitest";
import { openToken, sealToken } from "./connector-crypto";
import { CFG, deps, fakeDb, fakeGithub, iso, json, KEY, noContent, NOW, pair, pairedWorker, storeTokens, ticking, type FakeState, type Route } from "./connector.harness";
import { signedGrant, signedStart, trustedMac, vouch } from "./connector-trust.harness";
import { ROTATE_MS } from "./connector-grant";
import { mint } from "./connector-mint";
import { disconnect, endAuthorization, revokeWorker, YOUNG_MS } from "./connector-revoke";
import { bound } from "./connector-tokens";

const REFRESH = "POST /login/oauth/access_token";
const DELETE = `DELETE /applications/${CFG.clientId}/token`;
const GRANT = `DELETE /applications/${CFG.clientId}/grant`;
const basic = `Basic ${Buffer.from(`${CFG.clientId}:${CFG.clientSecret}`).toString("base64")}`;

function live(state: FakeState, id: string, token: string, o: { worker?: string; seal?: string; expiresAt?: string | null } = {}) {
  const worker = o.worker ?? "w1";
  state.live.push({ id, user_id: "u1", worker_id: worker, subject: `card:${id}`, repo: "o/r", token_sealed: sealToken(token, o.seal ?? bound.live(worker, `card:${id}`), KEY), issued_at: iso(NOW), expires_at: o.expiresAt ?? null });
}

// The ledger row a mint writes when it hands this worker the user token issued at `issuedAt`.
function handed(state: FakeState, issuedAt: number, worker = "w1") {
  state.mints.push({ id: 900 + state.mints.length, at: iso(issuedAt - 5_000), user_id: "u1", worker_id: worker, grant_id: "g1", connector: "github", card_id: "c", repo: "o/r", outcome: "minted", reason: null, token_kind: "user", token_issued_at: iso(issuedAt), nonce: `n${state.mints.length}` });
}

let refreshes = 0;
function setup(routes: Record<string, Route> = {}) {
  const clock = ticking();
  const { db, state } = fakeDb(clock);
  pairedWorker(state);
  const mac = trustedMac(state);
  signedGrant(state, mac);
  signedGrant(state, mac, { id: "g2", worker_id: "w2" });
  storeTokens(state, "u1");
  refreshes = 0;
  const gh = fakeGithub({
    [DELETE]: (body) => ((body as { access_token: string }).access_token === "ghu_stuck" ? json({}, 422) : noContent()),
    [REFRESH]: () => (refreshes++, pair(`ghu_new${refreshes}`, `ghr_new${refreshes}`)),
    [GRANT]: noContent,
    ...routes,
  });
  return { db, state, gh, d: deps(db, gh.fetch, clock), clock, mac };
}

describe("revokeWorker", () => {
  it("refuses a worker that isn't yours", async () => {
    const { d } = setup();
    await expect(revokeWorker(d, "u2", "w1")).rejects.toMatchObject({ status: 404 });
    await expect(revokeWorker(d, "u1", "nope")).rejects.toMatchObject({ status: 404 });
  });

  it("deletes the grant, ends live tokens at GitHub, keeps the unconfirmed ones, rotates a handed user token and logs it", async () => {
    const { d, state, gh } = setup();
    live(state, "a", "ghu_a");
    live(state, "b", "ghu_stuck", { expiresAt: "2026-11-02T20:00:00Z" });
    live(state, "c", "ghu_c", { seal: "live:other:x" });
    live(state, "d", "ghu_d", { worker: "w2" });
    handed(state, NOW - 60_000);
    const answer = await revokeWorker(d, "u1", "w1");
    expect(answer).toEqual({ grants: 1, tokensRevoked: 2, unconfirmed: [{ expiresAt: "2026-11-02T20:00:00Z" }, { expiresAt: null }], userToken: "rotated" });
    expect(state.grants.map((g) => g.id)).toEqual(["g2"]);
    expect(state.live.map((l) => l.id)).toEqual(["b", "d"]);
    const deletes = gh.called("DELETE", "/token");
    expect(deletes.map((c) => c.body)).toEqual([{ access_token: "ghu_a" }, { access_token: "ghu_stuck" }]);
    expect(deletes[0]!.headers.authorization).toBe(basic);
    expect(gh.called("POST", "/login/oauth/access_token")).toHaveLength(1);
    expect(state.mints.at(-1)).toMatchObject({ outcome: "revoked", worker_id: "w1", reason: "1 narrowed revoked, 2 unconfirmed; user token rotated", nonce: null });
  });

  it("counts a 404 as unconfirmed, and keeps that token's row", async () => {
    const { d, state } = setup({ [DELETE]: () => json({ message: "Not Found" }, 404) });
    live(state, "a", "ghu_a");
    expect(await revokeWorker(d, "u1", "w1")).toMatchObject({ tokensRevoked: 0, unconfirmed: [{ expiresAt: null }] });
    expect(state.live.map((l) => l.id)).toEqual(["a"]);
  });

  it("rotates the token the worker's own mint refreshed, on advancing clocks", async () => {
    const s = setup();
    const w = pairedWorker(s.state, { id: "w9", name: "Nine" });
    vouch(s.state, s.mac, w.worker);
    signedGrant(s.state, s.mac, { id: "g9", worker_id: "w9" });
    signedStart(s.state, s.mac, { workerId: "w9" });
    storeTokens(s.state, "u1", { issuedAt: NOW - ROTATE_MS });
    const answer = await mint(s.d, w.auth, w.signed({ connector: "github", cardId: "card-1", repo: "o/r", ts: s.clock(), nonce: "a".repeat(32) }));
    expect(answer.body.token).toBe("ghu_new1");
    const minted = s.state.mints.find((m) => m.worker_id === "w9" && m.outcome === "minted")!;
    expect(Date.parse(minted.at)).toBeLessThan(Date.parse(s.state.tokens.get("u1")!.access_issued_at!));
    expect((await revokeWorker(s.d, "u1", "w9")).userToken).toBe("rotated");
    expect(openToken(s.state.tokens.get("u1")!.access_sealed, bound.access("u1"), KEY)).toBe("ghu_new2");
  });

  it("leaves the user token alone when this worker wasn't handed the current one", async () => {
    const { d, state, gh } = setup();
    handed(state, NOW - 3_600_000);
    handed(state, NOW - 60_000, "w2");
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

  it("waits out a refresh in flight instead of spending the refresh token beside it", async () => {
    const s = setup();
    handed(s.state, NOW - 60_000);
    s.state.tokens.get("u1")!.refreshing_until = iso(NOW + 60_000);
    let waits = 0;
    // The other refresh lands while revoke waits: a new token, never handed to this worker, and the claim let go.
    const d = { ...s.d, sleep: () => (waits++ === 0 && storeTokens(s.state, "u1", { access: "ghu_theirs", issuedAt: NOW + 1 }), Promise.resolve()) };
    expect((await revokeWorker(d, "u1", "w1")).userToken).toBe("rotated");
    expect(s.gh.called("POST", "/login/oauth/access_token")).toHaveLength(0);
  });

  it("rotates again when the refresh in flight handed this worker its new token", async () => {
    const s = setup();
    handed(s.state, NOW - 60_000);
    s.state.tokens.get("u1")!.refreshing_until = iso(NOW + 60_000);
    let waits = 0;
    const d = {
      ...s.d,
      sleep: () => {
        if (waits++ === 0) {
          storeTokens(s.state, "u1", { access: "ghu_theirs", issuedAt: NOW + 1 });
          handed(s.state, NOW + 1);
        }
        return Promise.resolve();
      },
    };
    expect((await revokeWorker(d, "u1", "w1")).userToken).toBe("rotated");
    expect(s.gh.called("POST", "/login/oauth/access_token")).toHaveLength(1);
  });

  it("lets the claim go and looks again when a refresh landed between its read and its claim", async () => {
    const s = setup();
    handed(s.state, NOW - 60_000);
    let reads = 0;
    const db = {
      ...s.db,
      tokens: async (u: string) => {
        // The second read (under the claim) sees a pair someone else just made, which this worker was never handed.
        if (reads++ === 1) storeTokens(s.state, "u1", { access: "ghu_theirs", issuedAt: NOW + 1 });
        return s.db.tokens(u);
      },
    };
    expect((await revokeWorker({ ...s.d, db }, "u1", "w1")).userToken).toBe("rotated");
    expect(s.gh.called("POST", "/login/oauth/access_token")).toHaveLength(0);
    expect(s.state.tokens.get("u1")!.refreshing_until).toBeNull();
  });

  it("is unconfirmed when the refresh stays claimed", async () => {
    const s = setup();
    handed(s.state, NOW - 60_000);
    s.state.tokens.get("u1")!.refreshing_until = iso(NOW + 3_600_000);
    expect((await revokeWorker(s.d, "u1", "w1")).userToken).toBe("unconfirmed");
  });

  it("deletes the user token when the refresh fails", async () => {
    const { d, state, gh } = setup({ [REFRESH]: () => json({ error: "bad_refresh_token" }) });
    handed(state, NOW - 60_000);
    expect(await revokeWorker(d, "u1", "w1")).toMatchObject({ userToken: "deleted", tokensRevoked: 1 });
    expect(gh.called("DELETE", "/token")[0]!.body).toEqual({ access_token: "ghu_old" });
  });

  it("reports the user token unconfirmed when neither the refresh nor the delete worked", async () => {
    const failing = setup({ [REFRESH]: () => json({ error: "x" }), [DELETE]: () => json({}, 404) });
    handed(failing.state, NOW - 60_000);
    expect(await revokeWorker(failing.d, "u1", "w1")).toMatchObject({ userToken: "unconfirmed", tokensRevoked: 0 });
    const unopenable = setup({ [REFRESH]: () => json({ error: "x" }) });
    handed(unopenable.state, NOW - 60_000);
    unopenable.state.tokens.get("u1")!.access_sealed = sealToken("ghu_old", "access:someone", KEY);
    expect((await revokeWorker(unopenable.d, "u1", "w1")).userToken).toBe("unconfirmed");
    expect(unopenable.gh.called("DELETE", "/token")).toHaveLength(0);
  });
});

describe("disconnect", () => {
  it("deletes every grant, and says none when GitHub was never connected", async () => {
    const { d, state, gh } = setup();
    state.tokens.clear();
    expect(await disconnect(d, "u1")).toEqual({ grants: 2, authorization: "none" });
    expect(state.grants).toHaveLength(0);
    expect(gh.calls).toHaveLength(0);
  });

  it("deletes the whole authorization with a young access token, then forgets the chain and the narrowed rows", async () => {
    const { d, state, gh } = setup();
    live(state, "a", "ghu_a");
    expect(await disconnect(d, "u1")).toEqual({ grants: 2, authorization: "deleted" });
    expect(gh.called("DELETE", "/grant")[0]).toMatchObject({ body: { access_token: "ghu_old" }, headers: { authorization: basic } });
    expect(state.tokens.has("u1")).toBe(false);
    expect(state.live).toHaveLength(0);
  });

  it("keeps the chain, pending, and the narrowed rows when GitHub doesn't confirm (a 404 included)", async () => {
    for (const status of [422, 404]) {
      const { d, state } = setup({ [GRANT]: () => json({}, status) });
      live(state, "a", "ghu_a");
      expect((await disconnect(d, "u1")).authorization).toBe("unconfirmed");
      expect(state.tokens.get("u1")?.disconnect_pending_at).toBeTruthy();
      expect(state.live).toHaveLength(1);
    }
  });

  it("refreshes first after 8 idle hours, so GitHub knows the token it's asked to delete with", async () => {
    const { d, state, gh } = setup();
    storeTokens(state, "u1", { issuedAt: NOW - 9 * 3_600_000 });
    expect((await disconnect(d, "u1")).authorization).toBe("deleted");
    expect(gh.called("DELETE", "/grant")[0]!.body).toEqual({ access_token: "ghu_new1" });
  });

  it("refreshes first when no access token opens", async () => {
    const { d, state, gh } = setup();
    storeTokens(state, "u1", { access: null, issuedAt: null });
    expect((await disconnect(d, "u1")).authorization).toBe("deleted");
    expect(gh.called("DELETE", "/grant")[0]!.body).toEqual({ access_token: "ghu_new1" });
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

describe("endAuthorization", () => {
  it("says deleted when there's nothing left", async () => {
    const { d, state } = setup();
    state.tokens.clear();
    expect(await endAuthorization(d, "u1")).toBe("deleted");
  });

  it("uses the stored token just under the young limit, and waits out a refresh in flight past it", async () => {
    const young = setup();
    storeTokens(young.state, "u1", { issuedAt: NOW - YOUNG_MS + 60_000 });
    expect(await endAuthorization(young.d, "u1")).toBe("deleted");
    expect(young.gh.called("DELETE", "/grant")[0]!.body).toEqual({ access_token: "ghu_old" });
    const claimed = setup();
    storeTokens(claimed.state, "u1", { issuedAt: NOW - YOUNG_MS - 60_000 });
    claimed.state.tokens.get("u1")!.refreshing_until = iso(NOW + 3_600_000);
    let waits = 0;
    const d = { ...claimed.d, sleep: () => (waits++ === 0 && storeTokens(claimed.state, "u1", { access: "ghu_theirs", issuedAt: NOW }), Promise.resolve()) };
    expect(await endAuthorization(d, "u1")).toBe("deleted");
    expect(claimed.gh.called("DELETE", "/grant")[0]!.body).toEqual({ access_token: "ghu_theirs" });
  });

  it("is unconfirmed when the refresh stays claimed", async () => {
    const { d, state } = setup();
    storeTokens(state, "u1", { access: null, issuedAt: null });
    state.tokens.get("u1")!.refreshing_until = iso(NOW + 3_600_000);
    expect(await endAuthorization(d, "u1")).toBe("unconfirmed");
  });
});
