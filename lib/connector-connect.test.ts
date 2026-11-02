import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { callbackUrl, checkConnect, CONNECT_PATH, connectCookie, connectStatus, donePage, endPrevious, finishConnect, newConnect, sameOrigin, startPage } from "./connector-connect";
import { openToken } from "./connector-crypto";
import { CFG, deps, fakeDb, fakeGithub, iso, json, KEY, noContent, NOW, pair, storeTokens } from "./connector.harness";
import { signedGrant, trustedMac } from "./connector-trust.harness";
import { bound } from "./connector-tokens";

const GRANT = `DELETE /applications/${CFG.clientId}/grant`;
const OTHER_KEY = { id: "v1", key: Buffer.alloc(32, 9) };

describe("newConnect and checkConnect", () => {
  it("makes a state, a verifier and its S256 challenge, carried in a MACed cookie with the account before", () => {
    const c = newConnect("u1", KEY, 42, (n) => Buffer.alloc(n, n));
    const verifier = Buffer.alloc(48, 48).toString("base64url");
    expect(c.state).toBe(Buffer.alloc(24, 24).toString("base64url"));
    expect(c.challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
    expect(c.cookie.startsWith(`u1.${c.state}.${verifier}.42.`)).toBe(true);
    expect(checkConnect(c.cookie, "u1", c.state, KEY)).toEqual({ verifier, previous: 42 });
    expect(checkConnect(newConnect("u1", KEY, null).cookie, "u1", newConnect("u1", KEY, null).state, KEY)).toBeNull();
  });

  it("uses random bytes by default, and carries no account before as null", () => {
    const a = newConnect("u1", KEY, null);
    expect(a.state).not.toBe(newConnect("u1", KEY, null).state);
    expect(checkConnect(a.cookie, "u1", a.state, KEY)?.previous).toBeNull();
  });

  it("refuses another visitor's cookie, another state, a forged or re-keyed MAC, or a missing piece", () => {
    const c = newConnect("u1", KEY, null);
    expect(checkConnect(c.cookie, "u2", c.state, KEY)).toBeNull();
    expect(checkConnect(c.cookie, "u1", "other", KEY)).toBeNull();
    expect(checkConnect(c.cookie, "u1", null, KEY)).toBeNull();
    expect(checkConnect(undefined, "u1", c.state, KEY)).toBeNull();
    expect(checkConnect("u1.only", "u1", "only", KEY)).toBeNull();
    expect(checkConnect(c.cookie, "u1", c.state, OTHER_KEY)).toBeNull();
    const [u, s, v, , mac] = c.cookie.split(".");
    expect(checkConnect(`${u}.${s}.${v}.7.${mac}`, "u1", c.state, KEY)).toBeNull();
    expect(checkConnect(`${u}.${s}.${v}.-.x`, "u1", c.state, KEY)).toBeNull();
  });

  it("names the cookie __Host- on https, and builds the callback URL", () => {
    expect(connectCookie(true)).toBe("__Host-weft_github_connect");
    expect(connectCookie(false)).toBe("weft_github_connect");
    expect(callbackUrl("https://weft.zip")).toBe(`https://weft.zip${CONNECT_PATH}/callback`);
  });
});

describe("sameOrigin", () => {
  const req = (headers: Record<string, string>) => new Request("https://weft.zip/x", { method: "POST", headers });
  it("takes only a same-origin request whose Origin, if sent, is this one", () => {
    expect(sameOrigin(req({ "sec-fetch-site": "same-origin" }), "https://weft.zip")).toBe(true);
    expect(sameOrigin(req({ "sec-fetch-site": "same-origin", origin: "https://weft.zip" }), "https://weft.zip")).toBe(true);
    expect(sameOrigin(req({ "sec-fetch-site": "same-origin", origin: "https://evil.example" }), "https://weft.zip")).toBe(false);
    expect(sameOrigin(req({ "sec-fetch-site": "cross-site" }), "https://weft.zip")).toBe(false);
    expect(sameOrigin(req({}), "https://weft.zip")).toBe(false);
  });
});

describe("endPrevious", () => {
  it("is null with nothing connected", async () => {
    const { db } = fakeDb();
    expect(await endPrevious(deps(db, fakeGithub({}).fetch), "u1")).toBeNull();
  });

  it("deletes the old authorization at GitHub and forgets it, keeping the workers' grants", async () => {
    const { db, state } = fakeDb();
    storeTokens(state, "u1");
    signedGrant(state, trustedMac(state));
    const gh = fakeGithub({ [GRANT]: noContent });
    expect(await endPrevious(deps(db, gh.fetch), "u1")).toBe(42);
    expect(state.tokens.has("u1")).toBe(false);
    expect(state.grants).toHaveLength(1);
  });

  it("keeps it pending when GitHub doesn't confirm", async () => {
    const { db, state } = fakeDb();
    storeTokens(state, "u1");
    expect(await endPrevious(deps(db, fakeGithub({ [GRANT]: () => json({}, 404) }).fetch), "u1")).toBe(42);
    expect(state.tokens.get("u1")?.disconnect_pending_at).toBe(iso(NOW));
  });
});

describe("finishConnect", () => {
  const github = (id = 7, extra = {}) => fakeGithub({ "POST /login/oauth/access_token": () => pair("ghu_a", "ghr_a"), "GET /user": () => json({ id, login: "octo" }), [GRANT]: noContent, ...extra });

  it("trades the code, reads who it is and stores the pair sealed", async () => {
    const { db, state } = fakeDb();
    const gh = github();
    expect(await finishConnect(deps(db, gh.fetch), "u1", { code: "c", verifier: "v", redirectUri: "https://weft.zip/cb", previous: null })).toBe("octo");
    const row = state.tokens.get("u1");
    expect(row).toMatchObject({ github_id: 7, github_login: "octo", access_issued_at: iso(NOW), refreshing_until: null, disconnect_pending_at: null });
    expect(openToken(row?.refresh_sealed, bound.refresh("u1"), KEY)).toBe("ghr_a");
    expect(openToken(row?.access_sealed, bound.access("u1"), KEY)).toBe("ghu_a");
    expect(gh.called("GET", "/user")[0]!.headers.authorization).toBe("Bearer ghu_a");
  });

  it("turns the workers' grants off and tells you when it's another GitHub account than before", async () => {
    const { db, state } = fakeDb();
    signedGrant(state, trustedMac(state));
    const notify = vi.fn(() => Promise.resolve());
    await finishConnect({ ...deps(db, github(8).fetch), notify }, "u1", { code: "c", verifier: "v", redirectUri: "r", previous: 7 });
    expect(state.grants).toHaveLength(0);
    expect(notify).toHaveBeenCalledWith("u1", "Weft: GitHub reconnected as @octo", expect.stringContaining("turned off"));
  });

  it("keeps the grants for the same account, and clears a pending disconnect of it", async () => {
    const { db, state } = fakeDb();
    signedGrant(state, trustedMac(state));
    storeTokens(state, "u1");
    state.tokens.get("u1")!.github_id = 7;
    state.tokens.get("u1")!.disconnect_pending_at = iso(NOW);
    await finishConnect(deps(db, github(7).fetch), "u1", { code: "c", verifier: "v", redirectUri: "r", previous: 7 });
    expect(state.grants).toHaveLength(1);
    expect(state.tokens.get("u1")?.disconnect_pending_at).toBeNull();
  });

  it("refuses another account while the old one's authorization isn't confirmed gone, and ends the new one", async () => {
    const { db, state } = fakeDb();
    storeTokens(state, "u1");
    state.tokens.get("u1")!.disconnect_pending_at = iso(NOW);
    const gh = github(99);
    await expect(finishConnect(deps(db, gh.fetch), "u1", { code: "c", verifier: "v", redirectUri: "r", previous: 42 })).rejects.toMatchObject({ status: 409, message: expect.stringContaining("@octo") as string });
    expect(gh.called("DELETE", "/grant")[0]!.body).toEqual({ access_token: "ghu_a" });
    expect(state.tokens.get("u1")?.github_id).toBe(42);
  });

  it("stores nothing when GitHub refuses the code", async () => {
    const { db, state } = fakeDb();
    const gh = fakeGithub({ "POST /login/oauth/access_token": () => json({ error: "bad_verification_code" }) });
    await expect(finishConnect(deps(db, gh.fetch), "u1", { code: "c", verifier: "v", redirectUri: "r", previous: null })).rejects.toThrow("bad_verification_code");
    expect(state.tokens.size).toBe(0);
  });
});

describe("connectStatus", () => {
  it("says who's connected and until when, or that a disconnect is pending", async () => {
    const { db, state } = fakeDb();
    expect(await connectStatus({ db }, "u1")).toEqual({ connected: false });
    storeTokens(state, "u1");
    expect(await connectStatus({ db }, "u1")).toEqual({ connected: true, login: "octo", refreshExpiresAt: state.tokens.get("u1")?.refresh_expires_at });
    state.tokens.get("u1")!.disconnect_pending_at = iso(NOW);
    expect(await connectStatus({ db }, "u1")).toEqual({ connected: false, pendingDisconnect: true, login: "octo" });
  });
});

describe("donePage and startPage", () => {
  it("is an escaped, uncached, unframeable HTML page", async () => {
    const res = donePage("<GitHub> & you", `"it's" done`);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    const html = await res.text();
    expect(html).toContain("<title>&#60;GitHub&#62; &#38; you</title>");
    expect(html).toContain("<p>&#34;it&#39;s&#34; done</p>");
  });

  it("is one button that POSTs the start, saying it ends the current connection", async () => {
    const fresh = await startPage(null).text();
    expect(fresh).toContain(`<form method="post" action="${CONNECT_PATH}/start">`);
    expect(fresh).not.toContain("ends Weft's current connection");
    expect(await startPage("o<c").text()).toContain("ends Weft's current connection as @o&#60;c first");
  });
});
