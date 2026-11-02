import { describe, expect, it } from "vitest";
import { FRESH_MS } from "./connector-auth";
import { openToken } from "./connector-crypto";
import type { ConnectorDb, GrantRow } from "./connector-db";
import { deps, fakeGithub, iso, json, KEY, NOW, storeTokens } from "./connector.harness";
import { DAY, signedAllow, signedStart, trustedMac, vouch } from "./connector-trust.harness";
import { LIMITS, mint } from "./connector-mint";
import { ledger, refused, setup } from "./connector-mint.harness";
import { repoOfUrl } from "./connector-card";
import { bound, handedExpiry } from "./connector-tokens";

const NONCE = "ab".repeat(16);

describe("repoOfUrl", () => {
  it("reads owner/name from a GitHub https URL or a bare owner/name", () => {
    expect(repoOfUrl("https://github.com/o/r.git")).toBe("o/r");
    expect(repoOfUrl("https://github.com/o/r")).toBe("o/r");
    expect(repoOfUrl("https://github.com/o/r/")).toBe("o/r");
    expect(repoOfUrl("o/r")).toBe("o/r");
    expect(repoOfUrl("https://gitlab.com/o/r.git")).toBeNull();
    expect(repoOfUrl("r")).toBeNull();
    expect(repoOfUrl(5)).toBeNull();
  });
});

describe("mint: a token", () => {
  it("hands the user token under scope installed, logs which one, and touches the grant", async () => {
    const { ask, state } = setup();
    const a = await ask();
    expect(a).toEqual({ status: 200, body: { token: "ghu_old", expiresAt: handedExpiry(NOW - 60_000), login: "octo", kind: "user", asks: ["protected_push"] } });
    expect(state.mints[0]).toMatchObject({ outcome: "minted", token_kind: "user", token_issued_at: iso(NOW - 60_000), grant_id: "g1", card_id: "card-1", repo: "o/r", reason: null });
    expect(Date.parse(state.grants[0]!.last_used_at!)).toBeLessThanOrEqual(Date.parse(state.mints[0]!.at));
    expect(state.pinned.get("w1/card-1")).toMatchObject({ user_id: "u1", folder: "r", repo: "o/r", signer_id: state.signers[0]!.id, start_sig: expect.stringMatching(/^[0-9a-f]{64}$/) as string });
  });

  it("records the token its own refresh made, so a revoke finds it", async () => {
    const { ask, state } = setup();
    storeTokens(state, "u1", { issuedAt: NOW - 3_600_000 });
    expect((await ask()).body).toMatchObject({ token: "ghu_new" });
    expect(Date.parse(state.mints[0]!.token_issued_at!)).toBe(Date.parse(state.tokens.get("u1")!.access_issued_at!));
    expect(Date.parse(state.mints[0]!.token_issued_at!)).toBeGreaterThan(Date.parse(state.mints[0]!.at));
  });

  it("narrows to the project's repo under scope project, and reuses that token", async () => {
    const { ask, state, gh } = setup({ grant: { scope: "project" } });
    expect((await ask({ repo: "O/R" })).body).toMatchObject({ token: "ghu_narrow", kind: "scoped" });
    expect(state.live[0]).toMatchObject({ subject: "project:o/r", repo: "o/r" });
    expect(openToken(state.live[0]!.token_sealed, bound.live("w1", "project:o/r"), KEY)).toBe("ghu_narrow");
    expect((await ask()).body).toMatchObject({ token: "ghu_narrow", kind: "scoped" });
    expect(gh.called("POST", "/token/scoped")).toHaveLength(1);
    expect(state.mints.map((m) => [m.token_kind, m.token_issued_at])).toEqual([["scoped", null], ["scoped", null]]);
  });

  it("narrows per card under scope card", async () => {
    const { ask, state } = setup({ grant: { scope: "card" } });
    expect((await ask()).status).toBe(200);
    expect(state.live[0]!.subject).toBe("card:card-1");
  });

  it("uses a pinned card after its start command is gone", async () => {
    const { ask, state } = setup();
    await ask();
    state.starts = [];
    expect((await ask()).status).toBe(200);
  });

  it("takes a start signed with its git URL as the repo", async () => {
    const { ask, state, mac } = setup({ start: null });
    signedStart(state, mac);
    state.starts[0]!.payload = { ...(state.starts[0]!.payload as object), repo: "https://github.com/o/r.git" };
    expect((await ask()).status).toBe(200);
    expect(state.pinned.get("w1/card-1")?.repo).toBe("o/r");
  });

  it("passes through a card that isn't Done, and another worker's Done card of the same id", async () => {
    const { ask, state } = setup();
    state.cards.set("org1/card-1", { deleted: false, column: "running" });
    expect((await ask()).status).toBe(200);
    state.cards.set("org1/card-1", { deleted: false, column: "done", owner_worker: "w-other" });
    expect((await ask()).status).toBe(200);
  });

  it("mints under per-card or per-project approval once there's a signed Allow", async () => {
    const card = setup({ grant: { approval: "card" } });
    signedAllow(card.state, card.mac, card.grant!, "card", "card-1");
    expect((await card.ask()).status).toBe(200);
    const project = setup({ grant: { approval: "project" } });
    signedAllow(project.state, project.mac, project.grant!, "project", "o/r");
    expect((await project.ask()).status).toBe(200);
  });
});

describe("mint: refusals before the ledger", () => {
  it("refuses a malformed body", async () => {
    const { db, gh } = setup();
    await refused(mint(deps(db, gh.fetch), null, { connector: "github" }), 400, "card");
  });

  it("refuses a bad or missing signature, a stale ts, a revoked or token-enrolled worker", async () => {
    const s = setup();
    await refused(mint(deps(s.db, s.gh.fetch, s.clock), s.w.auth, { ...s.body(), sig: "AAAA" }), 401, "isn't signed");
    await refused(mint(deps(s.db, s.gh.fetch, s.clock), s.w.auth, { ...s.body(), sig: undefined }), 400, "Sign");
    await refused(mint(deps(s.db, s.gh.fetch, s.clock), null, s.body()), 401, "key");
    await refused(s.ask({ ts: NOW - FRESH_MS - 1 }), 401, "too old");
    await refused(setup({ worker: { revoked_at: iso(NOW - 1) } }).ask(), 401, "live worker");
    await refused(setup({ worker: { sign_key: null } }).ask(), 403, "enrolled by token");
    expect(s.state.mints).toHaveLength(0);
  });

  it("refuses a worker no trusted Mac vouched for", async () => {
    await refused(setup({ vouched: false }).ask(), 403, "No Mac of yours has vouched for Mini's pairing");
    const waiting = setup({ mac: { trustedFrom: NOW + DAY } });
    await refused(waiting.ask(), 403, "The Mac that vouched for Mini isn't trusted now");
    const revoked = setup({ mac: { revokedAt: iso(NOW - 1) } });
    await refused(revoked.ask(), 403, "isn't trusted now");
    const repaired = setup();
    repaired.state.pins[0]!.sign_key = "an-older-key";
    await refused(repaired.ask(), 403, "No Mac of yours has vouched");
    const forged = setup();
    forged.state.pins[0]!.box_key = "swapped";
    await refused(forged.ask(), 403, "pairing signature doesn't check");
    const otherUser = setup();
    otherUser.state.pins[0]!.user_id = "u2";
    await refused(otherUser.ask(), 403, "No Mac of yours");
    const theirMac = setup();
    theirMac.state.signers[0]!.user_id = "u2";
    await refused(theirMac.ask(), 403, "isn't trusted now");
  });

  it("rate limits per worker and per user, in one ledger step", async () => {
    const minute = setup({ step: 10 });
    for (let i = 0; i < LIMITS.workerMinute; i++) expect((await minute.ask()).status).toBe(200);
    await refused(minute.ask(), 429, "Too many");
    const old = (worker: string, i: number) => ({ id: 1000 + i, worker_id: worker, user_id: "u1", grant_id: null, connector: "github", card_id: null, repo: null, outcome: "minted" as const, reason: null, token_kind: null, nonce: `old${worker}${i}`, at: iso(NOW - 30 * 60_000) });
    const hour = setup();
    hour.state.mints.push(...Array.from({ length: LIMITS.workerHour }, (_, i) => old("w1", i)));
    await refused(hour.ask(), 429, "Too many");
    const user = setup();
    user.state.mints.push(...Array.from({ length: LIMITS.userHour }, (_, i) => old(`w${i % 9}x`, i)));
    await refused(user.ask(), 429, "Too many");
    const notices = setup();
    notices.state.mints.push(...Array.from({ length: LIMITS.userHour }, (_, i) => ({ ...old("w1", i), outcome: "notice" as const })));
    expect((await notices.ask()).status).toBe(200);
  });

  it("refuses a replayed nonce", async () => {
    const { ask } = setup();
    expect((await ask({ nonce: NONCE })).status).toBe(200);
    await refused(ask({ nonce: NONCE }), 401, "answered already");
  });

  it("answers 502 when the ledger can't be written", async () => {
    const { ask } = setup();
    await refused(ask({}, { admitMint: () => Promise.reject(new Error("db down")) }), 502, "Couldn't mint: db down");
  });
});

describe("mint: refusals in the ledger", () => {

  it("refuses without a grant, or after it expired", async () => {
    await ledger(setup({ grant: null }), 403, "isn't turned on for Mini");
    await ledger(setup({ grant: { expires_at: iso(NOW - 1) } }), 403, "lifetime ran out");
  });

  it("refuses a grant no trusted Mac signed as it stands", async () => {
    const loosened = setup();
    loosened.state.grants[0]!.scope = "card";
    loosened.state.grants[0]!.approval = "project";
    await ledger(loosened, 403, "signature doesn't check");
    const unknown = setup();
    unknown.state.grants[0]!.lifetime = "forever";
    await ledger(unknown, 403, "settings aren't ones a Mac signs");
    const unsigned = setup();
    unsigned.state.grants[0]!.signer_id = null;
    await ledger(unsigned, 403, "isn't signed by a Mac of yours");
    const waiting = setup();
    waiting.state.signers[0]!.trusted_from = iso(NOW + DAY);
    waiting.state.pins = [];
    vouch(waiting.state, trustedMac(waiting.state), waiting.w.worker);
    await ledger(waiting, 403, "trusted now");
    const epoch = setup();
    epoch.state.grants[0]!.epoch = 2;
    await ledger(epoch, 403, "signature doesn't check");
  });












  it("refuses a repo that isn't the started or pinned one", async () => {
    await refused(setup().ask({ repo: "o/other" }), 403, "project is o/r, not o/other");
    const pinned = setup();
    pinned.state.pinned.set("w1/card-1", { user_id: "u1", folder: "x", repo: "o/x", signer_id: pinned.mac.signer.id, start_sig: "x" });
    await refused(pinned.ask(), 403, "project is o/x");
  });



  it("asks for an Allow per card or project, as needs_allow, and takes only a signed one", async () => {
    const card = await ledger(setup({ grant: { approval: "card" } }), 403, "asks per card", "needs_allow");
    expect(card.body.needs).toBe("allow");
    const project = await ledger(setup({ grant: { approval: "project" } }), 403, "asks per project", "needs_allow");
    expect(project.body.needs).toBe("allow");
    const forged = setup({ grant: { approval: "card" } });
    signedAllow(forged.state, forged.mac, forged.grant!, "card", "card-1");
    forged.state.allows[0]!.sig = "AAAA";
    await ledger(forged, 403, "asks per card", "needs_allow");
    const unsigned = setup({ grant: { approval: "card" } });
    signedAllow(unsigned.state, unsigned.mac, unsigned.grant!, "card", "card-1");
    unsigned.state.allows[0]!.signer_id = null;
    await ledger(unsigned, 403, "asks per card", "needs_allow");
  });

  it("answers nothing when the grant was turned off or changed while the token was got", async () => {
    const off = setup();
    const a = await refused(off.ask({}, { grant: grantThen(off.db, () => null) }), 409, "turned off or changed");
    expect(a.body.token).toBeUndefined();
    expect(off.state.mints.at(-1)).toMatchObject({ outcome: "refused", token_issued_at: iso(NOW - 60_000) });
    const changed = setup();
    await refused(changed.ask({}, { grant: grantThen(changed.db, (g) => ({ ...g, epoch: g.epoch + 1 })) }), 409, "turned off or changed");
    const replaced = setup();
    await refused(replaced.ask({}, { grant: grantThen(replaced.db, (g) => ({ ...g, id: "g2" })) }), 409, "turned off or changed");
    const lapsed = setup();
    await refused(lapsed.ask({}, { grant: grantThen(lapsed.db, (g) => ({ ...g, expires_at: iso(NOW - 1) })) }), 409, "turned off or changed");
  });

  it("answers 502 on an unexpected error, even when the ledger can't be finished", async () => {
    const s = setup();
    const a = await refused(s.ask({}, { cardState: () => Promise.reject(new Error("boom")), finishMint: () => Promise.reject(new Error("also down")) }), 502, "Couldn't mint: boom");
    expect(a.body.needs).toBeUndefined();
  });

  it("logs a GitHub failure as refused", async () => {
    const s = setup();
    storeTokens(s.state, "u1", { issuedAt: NOW - 3_600_000 });
    const gh = fakeGithub({ "POST /login/oauth/access_token": () => json({ error: "bad_refresh_token" }) });
    const a = await mint(deps(s.db, gh.fetch, s.clock), s.w.auth, s.body());
    expect(a.status).toBe(502);
    expect(s.state.mints.at(-1)?.outcome).toBe("refused");
  });
});

// The grant as read the first time, then as `change` makes it on the read after the token.
function grantThen(db: ConnectorDb, change: (g: GrantRow) => GrantRow | null): ConnectorDb["grant"] {
  let reads = 0;
  return async (...args) => {
    const g = await db.grant(...args);
    return reads++ === 0 || !g ? g : change(g);
  };
}
