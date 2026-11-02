import { describe, expect, it } from "vitest";
import { sealToken } from "./connector-crypto";
import { CFG, deps, fakeDb, fakeGithub, iso, json, KEY, noContent, NOW, pair, pairedWorker, storeTokens, ticking, type FakeState, type Route } from "./connector.harness";
import { signedGrant, trustedMac } from "./connector-trust.harness";
import { bound, RETIRED } from "./connector-tokens";
import { ASSUMED_LIFE_MS, sweep } from "./connector-sweep";

const DELETE = `DELETE /applications/${CFG.clientId}/token`;
const GRANT = `DELETE /applications/${CFG.clientId}/grant`;

function live(state: FakeState, subject: string, token: string, o: { worker?: string; user?: string; issuedAt?: number; expiresAt?: string | null } = {}) {
  const worker = o.worker ?? "w1";
  state.live.push({ id: `l-${subject}`, user_id: o.user ?? "u1", worker_id: worker, subject, repo: "o/r", token_sealed: sealToken(token, bound.live(worker, subject), KEY), issued_at: iso(o.issuedAt ?? NOW - 60_000), expires_at: o.expiresAt ?? null });
}

function setup(routes: Record<string, Route> = {}) {
  const clock = ticking();
  const { db, state } = fakeDb(clock);
  pairedWorker(state);
  storeTokens(state, "u1");
  const gh = fakeGithub({ [DELETE]: (b) => ((b as { access_token: string }).access_token.includes("stuck") ? json({}, 404) : noContent()), [GRANT]: noContent, "POST /login/oauth/access_token": () => pair("ghu_new", "ghr_new"), ...routes });
  return { db, state, gh, d: deps(db, gh.fetch, clock), mac: trustedMac(state) };
}

describe("sweep", () => {
  it("revokes grants past their lifetime and leaves live ones", async () => {
    const { d, state, mac } = setup();
    signedGrant(state, mac, { expires_at: iso(NOW - 1) });
    signedGrant(state, mac, { id: "g2", worker_id: "w2", expires_at: iso(NOW + 3_600_000) });
    live(state, "card:c1", "ghu_a");
    const r = await sweep(d);
    expect(r).toMatchObject({ expired: 1, tokensRevoked: 1, failed: [] });
    expect(state.grants.map((g) => g.id)).toEqual(["g2"]);
    expect(state.mints.at(-1)).toMatchObject({ outcome: "revoked", worker_id: "w1" });
  });

  it("deletes narrowed tokens no grant covers, keeps the ones GitHub didn't confirm until their life is over", async () => {
    const { d, state, mac } = setup();
    signedGrant(state, mac, { id: "g2", worker_id: "w2" });
    live(state, "card:covered", "ghu_kept", { worker: "w2" });
    live(state, `${RETIRED}a`, "ghu_retired", { worker: "w2" });
    live(state, "card:orphan", "ghu_orphan");
    live(state, "card:stuck-young", "ghu_stuck1");
    live(state, "card:stuck-old", "ghu_stuck2", { issuedAt: NOW - ASSUMED_LIFE_MS - 1 });
    live(state, "card:stuck-expired", "ghu_stuck3", { expiresAt: iso(NOW - 1) });
    state.live.push({ id: "l-unopenable", user_id: "u1", worker_id: "w1", subject: "card:x", repo: "o/r", token_sealed: "v9.x.y", issued_at: iso(NOW), expires_at: null });
    state.live.push({ id: "l-nouser", worker_id: "w1", subject: "card:y", repo: "o/r", token_sealed: sealToken("ghu_y", bound.live("w1", "card:y"), KEY), issued_at: iso(NOW), expires_at: null } as never);
    state.live.push({ id: "l-noworker", user_id: "u1", subject: "card:z", repo: "o/r", token_sealed: sealToken("ghu_z", bound.live("", "card:z"), KEY), issued_at: iso(NOW), expires_at: null } as never);
    const r = await sweep(d);
    expect(r).toMatchObject({ tokensRevoked: 4, tokensDropped: 7 });
    expect(state.live.map((l) => l.id).sort()).toEqual(["l-card:covered", "l-card:stuck-young"]);
  });

  it("retries a disconnect GitHub didn't confirm, and forgets the sign-in once it's gone", async () => {
    const { d, state } = setup();
    state.tokens.get("u1")!.disconnect_pending_at = iso(NOW - 3_600_000);
    live(state, "card:c1", "ghu_stuck");
    expect((await sweep(d)).disconnects).toBe(1);
    expect(state.tokens.has("u1")).toBe(false);
    expect(state.live).toHaveLength(0);
  });

  it("keeps a disconnect pending while GitHub still won't confirm", async () => {
    const { d, state } = setup({ [GRANT]: () => json({}, 404) });
    state.tokens.get("u1")!.disconnect_pending_at = iso(NOW);
    expect((await sweep(d)).disconnects).toBe(0);
    expect(state.tokens.has("u1")).toBe(true);
  });

  it("drops nonces older than a day", async () => {
    const { d, state } = setup();
    state.nonces.push({ user_id: "u1", nonce: "old", at: iso(NOW - 25 * 3_600_000) }, { user_id: "u1", nonce: "new", at: iso(NOW - 60_000) });
    await sweep(d);
    expect(state.nonces.map((n) => n.nonce)).toEqual(["new"]);
  });

  it("carries on past a step that fails, and names it", async () => {
    const { d, state, mac, db } = setup();
    signedGrant(state, mac, { expires_at: iso(NOW - 1) });
    state.tokens.get("u1")!.disconnect_pending_at = iso(NOW);
    const broken = { ...d, db: { ...db, workerById: () => Promise.reject(new Error("db down")), liveTokens: () => Promise.reject(new Error("no live")), tokens: () => Promise.reject(new Error("no tokens")) } };
    const r = await sweep(broken);
    expect(r.failed).toEqual(["grant g1: db down", "narrowed tokens: no live", "disconnect u1: no tokens"]);
  });
});
