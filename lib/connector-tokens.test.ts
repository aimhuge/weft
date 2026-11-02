import { afterEach, describe, expect, it, vi } from "vitest";
import { HOLD_MARGIN_MS, ROTATE_MS } from "./connector-grant";
import { openToken, sealToken } from "./connector-crypto";
import { CFG, deps, fakeDb, fakeGithub, iso, json, KEY, noContent, NOW, pair, storeTokens, type FakeState } from "./connector.harness";
import { bound, handedExpiry, MintError, narrowToken, refreshNow, RETIRED, userToken } from "./connector-tokens";

const REFRESH = "POST /login/oauth/access_token";
const SCOPED = `POST /applications/${CFG.clientId}/token/scoped`;
const DELETE = `DELETE /applications/${CFG.clientId}/token`;
const STALE = NOW - ROTATE_MS + HOLD_MARGIN_MS;

const refusal = (p: Promise<unknown>) => p.then(() => null, (err: unknown) => err as MintError);
const opened = (state: FakeState, field: "access" | "refresh") => {
  const row = state.tokens.get("u1");
  return openToken(field === "access" ? row?.access_sealed : row?.refresh_sealed, bound[field]("u1"), KEY);
};

afterEach(() => {
  vi.useRealTimers();
});

describe("userToken", () => {
  it("refuses a user who never connected GitHub", async () => {
    const { db } = fakeDb();
    expect(await refusal(userToken(deps(db, fakeGithub({}).fetch), "u1"))).toMatchObject({ status: 403, message: expect.stringContaining("isn't connected") as string });
  });

  it("hands out the pair a refresh made between its read and its claim, instead of spending the old refresh token", async () => {
    const { db, state } = fakeDb();
    storeTokens(state, "u1", { issuedAt: STALE });
    let reads = 0;
    const raced = { ...db, tokens: async (u: string) => (reads++ === 1 && storeTokens(state, "u1", { access: "ghu_fresh", issuedAt: NOW }), db.tokens(u)) };
    const gh = fakeGithub({});
    expect(await userToken(deps(raced, gh.fetch), "u1")).toMatchObject({ token: "ghu_fresh" });
    expect(gh.calls).toHaveLength(0);
  });

  it("refuses while a disconnect waits on GitHub", async () => {
    const { db, state } = fakeDb();
    storeTokens(state, "u1");
    state.tokens.get("u1")!.disconnect_pending_at = iso(NOW);
    expect(await refusal(userToken(deps(db, fakeGithub({}).fetch), "u1"))).toMatchObject({ status: 403, message: expect.stringContaining("being disconnected") as string });
  });

  it("hands out the current token while it's young enough, without asking GitHub", async () => {
    const { db, state } = fakeDb();
    storeTokens(state, "u1");
    const gh = fakeGithub({});
    expect(await userToken(deps(db, gh.fetch), "u1")).toEqual({ token: "ghu_old", issuedAt: NOW - 60_000, login: "octo" });
    expect(gh.calls).toHaveLength(0);
  });

  it("refreshes a token past its hand-out window and stores the new sealed pair", async () => {
    const { db, state } = fakeDb();
    storeTokens(state, "u1", { issuedAt: STALE });
    const gh = fakeGithub({ [REFRESH]: () => pair("ghu_new", "ghr_new") });
    expect(await userToken(deps(db, gh.fetch), "u1")).toEqual({ token: "ghu_new", issuedAt: NOW, login: "octo" });
    expect(gh.calls[0]!.body).toMatchObject({ grant_type: "refresh_token", refresh_token: "ghr_old" });
    expect([opened(state, "access"), opened(state, "refresh")]).toEqual(["ghu_new", "ghr_new"]);
    expect(state.tokens.get("u1")).toMatchObject({ access_issued_at: iso(NOW), refreshing_until: null });
  });

  it("refreshes when no access token is stored", async () => {
    const { db, state } = fakeDb();
    storeTokens(state, "u1", { access: null, issuedAt: null });
    const gh = fakeGithub({ [REFRESH]: () => pair("ghu_new", "ghr_new") });
    expect((await userToken(deps(db, gh.fetch), "u1")).token).toBe("ghu_new");
  });

  it("waits for another mint's refresh and hands out its token", async () => {
    const { db, state } = fakeDb();
    storeTokens(state, "u1", { issuedAt: STALE });
    state.tokens.get("u1")!.refreshing_until = iso(NOW + 30_000);
    const gh = fakeGithub({});
    const sleep = vi.fn(() => {
      storeTokens(state, "u1", { access: "ghu_theirs", issuedAt: NOW });
      return Promise.resolve();
    });
    expect((await userToken({ ...deps(db, gh.fetch), sleep }, "u1")).token).toBe("ghu_theirs");
    expect(sleep).toHaveBeenCalledWith(500);
    expect(gh.calls).toHaveLength(0);
  });

  it("gives up with a 503 when the refresh stays claimed", async () => {
    const { db, state } = fakeDb();
    storeTokens(state, "u1", { issuedAt: STALE });
    state.tokens.get("u1")!.refreshing_until = iso(NOW + 30_000);
    expect(await refusal(userToken(deps(db, fakeGithub({}).fetch), "u1"))).toMatchObject({ status: 503 });
  });

  it("sleeps for real when no sleep is given", async () => {
    vi.useFakeTimers();
    const { db, state } = fakeDb();
    storeTokens(state, "u1", { issuedAt: STALE });
    state.tokens.get("u1")!.refreshing_until = iso(NOW + 30_000);
    const rest = deps(db, fakeGithub({}).fetch);
    delete rest.sleep;
    const answer = refusal(userToken(rest, "u1"));
    await vi.advanceTimersByTimeAsync(11 * 500);
    expect((await answer)?.status).toBe(503);
  });
});

describe("refreshNow", () => {
  it("releases the claim and refuses when the refresh token can't be opened", async () => {
    const { db, state } = fakeDb();
    storeTokens(state, "u1");
    state.tokens.get("u1")!.refreshing_until = iso(NOW + 30_000);
    const err = await refusal(refreshNow(deps(db, fakeGithub({}).fetch), "u1", sealToken("ghr", bound.refresh("u2"), KEY), "octo"));
    expect(err).toMatchObject({ status: 403, message: expect.stringContaining("can't be opened") as string });
    expect(state.tokens.get("u1")?.refreshing_until).toBeNull();
  });

  it("releases the claim and keeps the old pair when GitHub refuses", async () => {
    const { db, state } = fakeDb();
    storeTokens(state, "u1", { issuedAt: STALE });
    state.tokens.get("u1")!.refreshing_until = iso(NOW + 30_000);
    const gh = fakeGithub({ [REFRESH]: () => json({ error: "bad_refresh_token" }) });
    const err = await refusal(refreshNow(deps(db, gh.fetch), "u1", state.tokens.get("u1")!.refresh_sealed, "octo"));
    expect(err).toMatchObject({ status: 502, message: expect.stringContaining("bad_refresh_token") as string });
    expect(state.tokens.get("u1")?.refreshing_until).toBeNull();
    expect(opened(state, "refresh")).toBe("ghr_old");
  });
});

describe("narrowToken", () => {
  const o = { userId: "u1", workerId: "w1", subject: "project:o/r", repo: "o/r" };

  function setup(live?: { token?: string; repo?: string; issuedAt?: number; seal?: string }) {
    const { db, state } = fakeDb();
    storeTokens(state, "u1");
    if (live) {
      state.live.push({ id: "l1", user_id: "u1", worker_id: "w1", subject: o.subject, repo: live.repo ?? "o/r", token_sealed: sealToken(live.token ?? "ghu_kept", live.seal ?? bound.live("w1", o.subject), KEY), issued_at: iso(live.issuedAt ?? NOW - 30_000), expires_at: null });
    }
    const gh = fakeGithub({ [SCOPED]: () => json({ token: "ghu_narrow", expires_at: "2026-11-02T20:00:00Z" }), [DELETE]: noContent, [REFRESH]: () => pair("ghu_new", "ghr_new") });
    return { db, state, gh };
  }

  it("refuses a user who never connected GitHub", async () => {
    const { db } = fakeDb();
    expect((await refusal(narrowToken(deps(db, fakeGithub({}).fetch), o)))?.status).toBe(403);
  });

  it("makes a scoped token from the user token and stores it sealed", async () => {
    const { db, state, gh } = setup();
    expect(await narrowToken(deps(db, gh.fetch), o)).toEqual({ token: "ghu_narrow", issuedAt: NOW, login: "octo" });
    expect(gh.called("POST", "/token/scoped")[0]!.body).toMatchObject({ access_token: "ghu_old", target: "o", repositories: ["r"] });
    expect(state.live).toHaveLength(1);
    expect(state.live[0]).toMatchObject({ subject: o.subject, repo: "o/r", issued_at: iso(NOW), expires_at: "2026-11-02T20:00:00Z" });
    expect(openToken(state.live[0]!.token_sealed, bound.live("w1", o.subject), KEY)).toBe("ghu_narrow");
    expect(gh.called("DELETE", "/token")).toHaveLength(0);
  });

  it("reuses a live token made after the current user token while it's young enough", async () => {
    const { db, gh } = setup({});
    expect(await narrowToken(deps(db, gh.fetch), o)).toEqual({ token: "ghu_kept", issuedAt: NOW - 30_000, login: "octo" });
    expect(gh.calls).toHaveLength(0);
  });

  it("replaces a live token that's too old, deleting the old one at GitHub", async () => {
    const { db, gh } = setup({ issuedAt: STALE });
    expect((await narrowToken(deps(db, gh.fetch), o)).token).toBe("ghu_narrow");
    expect(gh.called("DELETE", "/token")[0]!.body).toEqual({ access_token: "ghu_kept" });
  });

  it("deletes the old token before its row is overwritten", async () => {
    const { db, state, gh } = setup({ issuedAt: STALE });
    const seen: number[] = [];
    const watched = { ...db, saveLiveToken: (row: Parameters<typeof db.saveLiveToken>[0]) => (seen.push(gh.called("DELETE", "/token").length), db.saveLiveToken(row)) };
    await narrowToken(deps(watched, gh.fetch), o);
    expect(seen).toEqual([1]);
    expect(state.live.map((l) => l.subject)).toEqual([o.subject]);
  });

  it("keeps a replaced token GitHub didn't confirm deleted as retired, for the sweep", async () => {
    const { db, state } = setup({ issuedAt: STALE });
    const gh = fakeGithub({ [SCOPED]: () => json({ token: "ghu_narrow", expires_at: null }), [DELETE]: () => json({}, 404) });
    expect((await narrowToken(deps(db, gh.fetch), o)).token).toBe("ghu_narrow");
    const retired = state.live.find((l) => l.subject.startsWith(RETIRED))!;
    expect(retired).toMatchObject({ repo: "o/r", issued_at: iso(STALE) });
    expect(openToken(retired.token_sealed, bound.live("w1", retired.subject), KEY)).toBe("ghu_kept");
    expect(state.live.find((l) => l.subject === o.subject)).toBeTruthy();
  });

  it("makes one token at a time per subject: a second mint waits and hands out the first one's", async () => {
    const { db, state, gh } = setup();
    let release: () => void = () => {};
    const slow = fakeGithub({ [SCOPED]: () => new Promise<Response>((r) => (release = () => r(json({ token: "ghu_narrow", expires_at: null })))), [REFRESH]: () => pair("ghu_new", "ghr_new") });
    // The second mint finds the claim taken and waits; while it waits, GitHub answers the first.
    const d = { ...deps(db, slow.fetch), sleep: () => (release(), new Promise<void>((r) => setTimeout(r, 5))) };
    const [a, b] = await Promise.all([narrowToken(d, o), narrowToken(d, o)]);
    expect(a.token).toBe("ghu_narrow");
    expect(b.token).toBe("ghu_narrow");
    expect(slow.called("POST", "/token/scoped")).toHaveLength(1);
    expect(state.live.filter((l) => l.subject === o.subject)).toHaveLength(1);
    expect(state.claims.size).toBe(0);
    expect(gh.calls).toHaveLength(0);
  });

  it("gives up with a 503 while another mint holds the claim", async () => {
    const { db, state, gh } = setup();
    state.claims.set(`w1/${o.subject}`, iso(NOW + 3_600_000));
    expect(await refusal(narrowToken(deps(db, gh.fetch), o))).toMatchObject({ status: 503 });
  });

  it("lets the claim go when GitHub won't narrow", async () => {
    const { db, state } = setup();
    const gh = fakeGithub({ [SCOPED]: () => json({ message: "nope" }, 422) });
    await refusal(narrowToken(deps(db, gh.fetch), o));
    expect(state.claims.size).toBe(0);
  });

  it("replaces a live token made before its parent was refreshed", async () => {
    const { db, gh } = setup({ issuedAt: NOW - 120_000 });
    expect((await narrowToken(deps(db, gh.fetch), o)).token).toBe("ghu_narrow");
    expect(gh.called("DELETE", "/token")).toHaveLength(1);
  });

  it("replaces a live token for another repo", async () => {
    const { db, gh } = setup({ repo: "o/old" });
    expect((await narrowToken(deps(db, gh.fetch), o)).token).toBe("ghu_narrow");
  });

  it("never reuses one when the parent's issue time is unknown, and refreshes the parent", async () => {
    const { db, state, gh } = setup({});
    storeTokens(state, "u1", { access: null, issuedAt: null });
    expect(await narrowToken(deps(db, gh.fetch), o)).toMatchObject({ token: "ghu_narrow" });
    expect(gh.called("POST", "/login/oauth/access_token")).toHaveLength(1);
    expect(gh.called("POST", "/token/scoped")[0]!.body).toMatchObject({ access_token: "ghu_new" });
  });

  it("replaces a live token that doesn't open, without deleting anything", async () => {
    const { db, gh } = setup({ seal: "live:w9:x" });
    expect((await narrowToken(deps(db, gh.fetch), o)).token).toBe("ghu_narrow");
    expect(gh.called("DELETE", "/token")).toHaveLength(0);
  });

  it("refuses with a 502 when GitHub won't narrow", async () => {
    const { db, state } = setup();
    const gh = fakeGithub({ [SCOPED]: () => json({ message: "Validation Failed" }, 422) });
    expect(await refusal(narrowToken(deps(db, gh.fetch), o))).toMatchObject({ status: 502, message: expect.stringContaining("Validation Failed") as string });
    expect(state.live).toHaveLength(0);
  });
});

describe("handedExpiry and MintError", () => {
  it("hands a token out for ROTATE_MS", () => {
    expect(handedExpiry(NOW)).toBe(iso(NOW + ROTATE_MS));
  });
  it("is a refusal by default", () => {
    expect(new MintError(403, "no").outcome).toBe("refused");
  });
});
