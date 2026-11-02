import { describe, expect, it } from "vitest";
import { FRESH_MS } from "./connector-auth";
import { openToken } from "./connector-crypto";
import type { ConnectorDb, GrantRow, StartRow } from "./connector-db";
import { CFG, deps, fakeDb, fakeGithub, grantRow, iso, json, KEY, NOW, pair, pairedWorker, storeTokens } from "./connector.harness";
import { mint, PER_HOUR, PER_MINUTE, repoOfUrl } from "./connector-mint";
import { bound, handedExpiry } from "./connector-tokens";

const NONCE = "ab".repeat(16);
const SCOPED = `POST /applications/${CFG.clientId}/token/scoped`;

interface Setup {
  grant?: Partial<GrantRow> | null;
  start?: Partial<StartRow> | null;
  worker?: Parameters<typeof pairedWorker>[1];
}

function setup(o: Setup = {}) {
  const { db, state } = fakeDb();
  const w = pairedWorker(state, o.worker);
  if (o.grant !== null) state.grants.push(grantRow(o.grant));
  if (o.start !== null) state.starts.push({ worker_id: "w1", card_id: "card-1", kind: "run", folder: "r", payload: { repo: "https://github.com/o/r.git" }, created_by: "u1", ...o.start });
  storeTokens(state, "u1");
  const gh = fakeGithub({ [SCOPED]: () => json({ token: "ghu_narrow", expires_at: null }), "POST /login/oauth/access_token": () => pair("ghu_new", "ghr_new") });
  let n = 0;
  const body = (b: Partial<{ cardId: string; repo: string; ts: number; nonce: string }> = {}) =>
    w.signed({ connector: "github", cardId: "card-1", repo: "o/r", ts: NOW, nonce: (n++).toString(16).padStart(32, "0"), ...b });
  const ask = (b?: Parameters<typeof body>[0], dbOverride: Partial<ConnectorDb> = {}) => mint(deps({ ...db, ...dbOverride }, gh.fetch), w.auth, body(b));
  return { db, state, gh, ask, body, w };
}

const refused = async (p: Promise<{ status: number; body: Record<string, unknown> }>, status: number, words: string) => {
  const a = await p;
  expect(a.status).toBe(status);
  expect(String(a.body.error)).toContain(words);
  return a;
};

describe("repoOfUrl", () => {
  it("reads owner/name from a GitHub https URL", () => {
    expect(repoOfUrl("https://github.com/o/r.git")).toBe("o/r");
    expect(repoOfUrl("https://github.com/o/r")).toBe("o/r");
    expect(repoOfUrl("https://github.com/o/r/")).toBe("o/r");
    expect(repoOfUrl("https://gitlab.com/o/r.git")).toBeNull();
    expect(repoOfUrl(5)).toBeNull();
  });
});

describe("mint: a token", () => {
  it("hands the user token under scope installed, logs it and touches the grant", async () => {
    const { ask, state } = setup();
    const a = await ask();
    expect(a).toEqual({ status: 200, body: { token: "ghu_old", expiresAt: handedExpiry(NOW - 60_000), login: "octo", kind: "user", asks: ["protected_push"] } });
    expect(state.mints[0]).toMatchObject({ outcome: "minted", token_kind: "user", grant_id: "g1", card_id: "card-1", repo: "o/r", reason: null });
    expect(state.grants[0]!.last_used_at).toBe(iso(NOW));
    expect(state.pinned.get("w1/card-1")).toEqual({ user_id: "u1", folder: "r", repo: "o/r" });
  });

  it("narrows to the project's repo under scope project, and reuses that token", async () => {
    const { ask, state, gh } = setup({ grant: { scope: "project" } });
    expect((await ask({ repo: "O/R" })).body).toMatchObject({ token: "ghu_narrow", kind: "scoped" });
    expect(state.live[0]).toMatchObject({ subject: "project:o/r", repo: "o/r" });
    expect(openToken(state.live[0]!.token_sealed, bound.live("w1", "project:o/r"), KEY)).toBe("ghu_narrow");
    expect((await ask()).body).toMatchObject({ token: "ghu_narrow", kind: "scoped" });
    expect(gh.called("POST", "/token/scoped")).toHaveLength(1);
    expect(state.mints.map((m) => m.token_kind)).toEqual(["scoped", "scoped"]);
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

  it("pins the asked repo when the start named no URL and its folder is the repo's name", async () => {
    const { ask, state } = setup({ start: { kind: "new_card", folder: "R", payload: null } });
    expect((await ask()).status).toBe(200);
    expect(state.pinned.get("w1/card-1")?.repo).toBe("o/r");
  });

  it("takes the board's card.create host command as a start", async () => {
    const { ask } = setup({ start: { kind: "host", payload: { verb: "card.create" } } });
    expect((await ask()).status).toBe(200);
  });

  it("passes through a card that isn't Done", async () => {
    const { ask, state } = setup();
    state.cards.set("org1/card-1", { deleted: false, column: "running" });
    expect((await ask()).status).toBe(200);
  });

  it("mints under per-card or per-project approval once there's an Allow", async () => {
    const card = setup({ grant: { approval: "card" } });
    card.state.allows.push({ grant_id: "g1", kind: "card", subject: "card-1" });
    expect((await card.ask()).status).toBe(200);
    const project = setup({ grant: { approval: "project" } });
    project.state.allows.push({ grant_id: "g1", kind: "project", subject: "o/r" });
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
    await refused(mint(deps(s.db, s.gh.fetch), s.w.auth, { ...s.body(), sig: "AAAA" }), 401, "isn't signed");
    await refused(mint(deps(s.db, s.gh.fetch), s.w.auth, { ...s.body(), sig: undefined }), 400, "Sign");
    await refused(mint(deps(s.db, s.gh.fetch), null, s.body()), 401, "key");
    await refused(s.ask({ ts: NOW - FRESH_MS - 1 }), 401, "too old");
    await refused(setup({ worker: { revoked_at: iso(NOW - 1) } }).ask(), 401, "live worker");
    await refused(setup({ worker: { sign_key: null } }).ask(), 403, "enrolled by token");
    expect(s.state.mints).toHaveLength(0);
  });

  it("rate limits at 30 a minute and 300 an hour", async () => {
    const minute = setup();
    for (let i = 0; i < PER_MINUTE - 1; i++) expect((await minute.ask()).status).toBe(200);
    expect((await minute.ask()).status).toBe(200);
    await refused(minute.ask(), 429, "Too many");
    const hour = setup();
    hour.state.mints.push(...Array.from({ length: PER_HOUR }, (_, i) => ({ ...hour.state.mints[0], id: 1000 + i, worker_id: "w1", user_id: "u1", grant_id: null, connector: "github", card_id: null, repo: null, outcome: "minted" as const, reason: null, token_kind: null, nonce: `old${i}`, at: iso(NOW - 30 * 60_000) })));
    await refused(hour.ask(), 429, "Too many");
  });

  it("refuses a replayed nonce", async () => {
    const { ask } = setup();
    expect((await ask({ nonce: NONCE })).status).toBe(200);
    await refused(ask({ nonce: NONCE }), 401, "answered already");
  });

  it("answers 502 when the ledger can't be written", async () => {
    const { ask } = setup();
    await refused(ask({}, { logMint: () => Promise.reject(new Error("db down")) }), 502, "Couldn't mint: db down");
  });
});

describe("mint: refusals in the ledger", () => {
  const ledger = async (s: ReturnType<typeof setup>, status: number, words: string, outcome = "refused") => {
    const a = await refused(s.ask(), status, words);
    expect(s.state.mints.at(-1)).toMatchObject({ outcome, reason: expect.stringContaining(words) as string });
    return a;
  };

  it("refuses without a grant, or after it expired", async () => {
    await ledger(setup({ grant: null }), 403, "isn't turned on for Mini");
    await ledger(setup({ grant: { expires_at: iso(NOW) } }), 403, "lifetime ran out");
  });

  it("refuses a card with no owner-created start", async () => {
    await ledger(setup({ start: null }), 403, "a card you started");
    const other = setup();
    await refused(other.ask({}, { starts: () => Promise.resolve([{ kind: "run", folder: "r", payload: null, created_by: "u2" }]) }), 403, "a card you started");
  });

  it("refuses a host command that isn't card.create", async () => {
    await ledger(setup({ start: { kind: "host", payload: { verb: "card.reply" } } }), 403, "a card you started");
    await ledger(setup({ start: { kind: "host", payload: null } }), 403, "a card you started");
  });

  it("refuses a repo that isn't the started or pinned one", async () => {
    await refused(setup().ask({ repo: "o/other" }), 403, "project is o/r, not o/other");
    await refused(setup({ start: { payload: {}, folder: "r" } }).ask({ repo: "o/other" }), 403, "started in r, not o/other");
    const pinned = setup();
    pinned.state.pinned.set("w1/card-1", { user_id: "u1", folder: "x", repo: "o/x" });
    await refused(pinned.ask(), 403, "project is o/x");
  });

  it("refuses a pinned card someone else started", async () => {
    const s = setup();
    s.state.pinned.set("w1/card-1", { user_id: "u2", folder: "r", repo: "o/r" });
    await ledger(s, 403, "isn't one you started");
  });

  it("refuses a Done or deleted card", async () => {
    const done = setup();
    done.state.cards.set("org1/card-1", { deleted: false, column: "done" });
    await ledger(done, 403, "Done or deleted");
    const deleted = setup();
    deleted.state.cards.set("org1/card-1", { deleted: true, column: "running" });
    await ledger(deleted, 403, "Done or deleted");
  });

  it("asks for an Allow per card or project, as needs_allow", async () => {
    const card = await ledger(setup({ grant: { approval: "card" } }), 403, "asks per card", "needs_allow");
    expect(card.body.needs).toBe("allow");
    const project = await ledger(setup({ grant: { approval: "project" } }), 403, "asks per project", "needs_allow");
    expect(project.body.needs).toBe("allow");
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
    const a = await mint(deps(s.db, gh.fetch), s.w.auth, s.body());
    expect(a.status).toBe(502);
    expect(s.state.mints.at(-1)?.outcome).toBe("refused");
  });
});
