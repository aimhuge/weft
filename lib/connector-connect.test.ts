import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { callbackUrl, checkConnect, CONNECT_PATH, connectStatus, donePage, finishConnect, newConnect } from "./connector-connect";
import { openToken } from "./connector-crypto";
import { deps, fakeDb, fakeGithub, iso, json, KEY, NOW, pair, storeTokens } from "./connector.harness";
import { bound } from "./connector-tokens";

describe("newConnect and checkConnect", () => {
  it("makes a state, a verifier and its S256 challenge, carried in the cookie", () => {
    const c = newConnect("u1", (n) => Buffer.alloc(n, n));
    const verifier = Buffer.alloc(48, 48).toString("base64url");
    expect(c.state).toBe(Buffer.alloc(24, 24).toString("base64url"));
    expect(c.challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
    expect(c.cookie).toBe(`u1.${c.state}.${verifier}`);
    expect(checkConnect(c.cookie, "u1", c.state)).toBe(verifier);
  });

  it("uses random bytes by default", () => {
    expect(newConnect("u1").state).not.toBe(newConnect("u1").state);
  });

  it("refuses another visitor's cookie, another state or a missing piece", () => {
    const c = newConnect("u1");
    expect(checkConnect(c.cookie, "u2", c.state)).toBeNull();
    expect(checkConnect(c.cookie, "u1", "other")).toBeNull();
    expect(checkConnect(c.cookie, "u1", null)).toBeNull();
    expect(checkConnect(undefined, "u1", c.state)).toBeNull();
    expect(checkConnect("u1.only", "u1", "only")).toBeNull();
  });

  it("builds the callback URL", () => {
    expect(callbackUrl("https://weft.zip")).toBe(`https://weft.zip${CONNECT_PATH}/callback`);
  });
});

describe("finishConnect", () => {
  it("trades the code, reads who it is and stores the pair sealed", async () => {
    const { db, state } = fakeDb();
    const gh = fakeGithub({ "POST /login/oauth/access_token": () => pair("ghu_a", "ghr_a"), "GET /user": () => json({ id: 7, login: "octo" }) });
    expect(await finishConnect(deps(db, gh.fetch), "u1", { code: "c", verifier: "v", redirectUri: "https://weft.zip/cb" })).toBe("octo");
    const row = state.tokens.get("u1");
    expect(row).toMatchObject({ github_id: 7, github_login: "octo", access_issued_at: iso(NOW), refreshing_until: null });
    expect(openToken(row?.refresh_sealed, bound.refresh("u1"), KEY)).toBe("ghr_a");
    expect(openToken(row?.access_sealed, bound.access("u1"), KEY)).toBe("ghu_a");
    expect(gh.called("GET", "/user")[0]!.headers.authorization).toBe("Bearer ghu_a");
  });

  it("stores nothing when GitHub refuses the code", async () => {
    const { db, state } = fakeDb();
    const gh = fakeGithub({ "POST /login/oauth/access_token": () => json({ error: "bad_verification_code" }) });
    await expect(finishConnect(deps(db, gh.fetch), "u1", { code: "c", verifier: "v", redirectUri: "r" })).rejects.toThrow("bad_verification_code");
    expect(state.tokens.size).toBe(0);
  });
});

describe("connectStatus", () => {
  it("says who's connected and until when", async () => {
    const { db, state } = fakeDb();
    expect(await connectStatus({ db }, "u1")).toEqual({ connected: false });
    storeTokens(state, "u1");
    expect(await connectStatus({ db }, "u1")).toEqual({ connected: true, login: "octo", refreshExpiresAt: state.tokens.get("u1")?.refresh_expires_at });
  });
});

describe("donePage", () => {
  it("is an escaped, uncached HTML page", async () => {
    const res = donePage("<GitHub> & you", `"it's" done`);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const html = await res.text();
    expect(html).toContain("<title>&#60;GitHub&#62; &#38; you</title>");
    expect(html).toContain("<p>&#34;it&#39;s&#34; done</p>");
  });
});
