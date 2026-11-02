import { describe, expect, it } from "vitest";
import { CFG, fakeGithub, json, noContent, NOW, pair } from "./connector.harness";
import { appConfig, authorizeUrl, deleteAppToken, exchangeCode, githubUser, refreshTokens, scopedToken, TOKEN_PERMISSIONS } from "./github-app";

const TOKEN = "POST /login/oauth/access_token";

describe("appConfig", () => {
  it("needs both the client id and secret", () => {
    expect(appConfig({ GITHUB_APP_CLIENT_ID: " id ", GITHUB_APP_CLIENT_SECRET: " s " })).toEqual({ clientId: "id", clientSecret: "s" });
    expect(appConfig({ GITHUB_APP_CLIENT_ID: "id" })).toBeNull();
    expect(appConfig({ GITHUB_APP_CLIENT_SECRET: "s" })).toBeNull();
  });
  it("reads process.env by default", () => {
    expect(appConfig()).toEqual(process.env.GITHUB_APP_CLIENT_ID && process.env.GITHUB_APP_CLIENT_SECRET ? expect.any(Object) : null);
  });
});

describe("authorizeUrl", () => {
  it("sends the client, state and S256 challenge", () => {
    const url = new URL(authorizeUrl(CFG, { redirectUri: "https://weft.zip/cb", state: "st", challenge: "ch" }));
    expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({ client_id: "Iv1.abc", redirect_uri: "https://weft.zip/cb", state: "st", code_challenge: "ch", code_challenge_method: "S256", allow_signup: "false" });
  });
});

describe("exchangeCode and refreshTokens", () => {
  it("trades a code with its verifier for a pair with expiries", async () => {
    const gh = fakeGithub({ [TOKEN]: () => pair("ghu_a", "ghr_a") });
    const set = await exchangeCode(CFG, { code: "c", verifier: "v", redirectUri: "https://weft.zip/cb" }, gh.fetch, NOW);
    expect(set).toEqual({ access: "ghu_a", accessExpiresAt: new Date(NOW + 28_800_000).toISOString(), refresh: "ghr_a", refreshExpiresAt: new Date(NOW + 15_897_600_000).toISOString() });
    expect(gh.calls[0]!.body).toEqual({ client_id: "Iv1.abc", client_secret: "shh", code: "c", code_verifier: "v", redirect_uri: "https://weft.zip/cb" });
  });

  it("spends a refresh token", async () => {
    const gh = fakeGithub({ [TOKEN]: () => pair("ghu_b", "ghr_b") });
    expect((await refreshTokens(CFG, "ghr_a", gh.fetch, NOW)).access).toBe("ghu_b");
    expect(gh.calls[0]!.body).toEqual({ client_id: "Iv1.abc", client_secret: "shh", grant_type: "refresh_token", refresh_token: "ghr_a" });
  });

  it("refuses GitHub's 200 with an error, naming its description or its code", async () => {
    await expect(refreshTokens(CFG, "x", fakeGithub({ [TOKEN]: () => json({ error: "bad_refresh_token", error_description: "The refresh token passed is incorrect" }) }).fetch, NOW)).rejects.toThrow("The refresh token passed is incorrect");
    await expect(refreshTokens(CFG, "x", fakeGithub({ [TOKEN]: () => json({ error: "bad_refresh_token" }) }).fetch, NOW)).rejects.toThrow("bad_refresh_token");
  });

  it("refuses an HTTP error with no body", async () => {
    await expect(refreshTokens(CFG, "x", fakeGithub({ [TOKEN]: () => new Response("nope", { status: 500 }) }).fetch, NOW)).rejects.toThrow("HTTP 500");
  });

  it("refuses an answer with no access token", async () => {
    await expect(refreshTokens(CFG, "x", fakeGithub({ [TOKEN]: () => json({ access_token: "a" }) }).fetch, NOW)).rejects.toThrow("no access token");
  });

  it("refuses tokens that never expire", async () => {
    await expect(refreshTokens(CFG, "x", fakeGithub({ [TOKEN]: () => json({ access_token: "a", expires_in: 1 }) }).fetch, NOW)).rejects.toThrow("Expire user authorization tokens");
    await expect(refreshTokens(CFG, "x", fakeGithub({ [TOKEN]: () => json({ access_token: "a", expires_in: 1, refresh_token: "r" }) }).fetch, NOW)).rejects.toThrow("Expire user authorization tokens");
  });
});

describe("githubUser", () => {
  it("reads who the token is", async () => {
    const gh = fakeGithub({ "GET /user": () => json({ id: 7, login: "octo" }) });
    expect(await githubUser("ghu_a", gh.fetch)).toEqual({ id: 7, login: "octo" });
    expect(gh.calls[0]!.headers.authorization).toBe("Bearer ghu_a");
  });
  it("refuses a failed or odd answer", async () => {
    await expect(githubUser("t", fakeGithub({ "GET /user": () => json({ message: "Bad credentials" }, 401) }).fetch)).rejects.toThrow("HTTP 401");
    await expect(githubUser("t", fakeGithub({ "GET /user": () => json({ id: "7", login: "o" }) }).fetch)).rejects.toThrow("didn't say");
    await expect(githubUser("t", fakeGithub({ "GET /user": () => json({ id: 7 }) }).fetch)).rejects.toThrow("didn't say");
    await expect(githubUser("t", fakeGithub({ "GET /user": () => new Response("x") }).fetch)).rejects.toThrow("didn't say");
  });
});

describe("scopedToken", () => {
  const PATH = "POST /applications/Iv1.abc/token/scoped";
  it("narrows a user token to one repo with Basic auth and the app's permissions", async () => {
    const gh = fakeGithub({ [PATH]: () => json({ token: "ghu_n", expires_at: "2026-11-02T20:00:00Z" }) });
    expect(await scopedToken(CFG, "ghu_a", "o/r", gh.fetch)).toEqual({ token: "ghu_n", expiresAt: "2026-11-02T20:00:00Z" });
    expect(gh.calls[0]!.body).toEqual({ access_token: "ghu_a", target: "o", repositories: ["r"], permissions: TOKEN_PERMISSIONS });
    expect(gh.calls[0]!.headers.authorization).toBe(`Basic ${Buffer.from("Iv1.abc:shh").toString("base64")}`);
  });
  it("leaves the expiry null when GitHub sends none", async () => {
    expect(await scopedToken(CFG, "t", "o/r", fakeGithub({ [PATH]: () => json({ token: "n" }) }).fetch)).toEqual({ token: "n", expiresAt: null });
  });
  it("refuses with GitHub's message, or the status", async () => {
    await expect(scopedToken(CFG, "t", "o/r", fakeGithub({ [PATH]: () => json({ message: "Validation Failed" }, 422) }).fetch)).rejects.toThrow("wouldn't narrow the token to o/r: Validation Failed");
    await expect(scopedToken(CFG, "t", "o/r", fakeGithub({ [PATH]: () => new Response("", { status: 500 }) }).fetch)).rejects.toThrow("HTTP 500");
  });
});

describe("deleteAppToken", () => {
  it("is true on 204 and 404, for a token or the grant", async () => {
    const gh = fakeGithub({ "DELETE /applications/Iv1.abc/token": noContent, "DELETE /applications/Iv1.abc/grant": () => json({}, 404) });
    expect(await deleteAppToken(CFG, "t", "token", gh.fetch)).toBe(true);
    expect(await deleteAppToken(CFG, "t", "grant", gh.fetch)).toBe(true);
    expect(gh.calls[0]!.body).toEqual({ access_token: "t" });
  });
  it("is false on 422 or a network failure", async () => {
    expect(await deleteAppToken(CFG, "t", undefined, fakeGithub({ "DELETE /applications/Iv1.abc/token": () => json({}, 422) }).fetch)).toBe(false);
    expect(await deleteAppToken(CFG, "t", "token", () => Promise.reject(new Error("down")))).toBe(false);
  });
});
