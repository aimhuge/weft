import crypto from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { authorizeUrl, pkce, signIn, startLoopback } from "./blastcp-oauth.cjs";

// BlastCP's browser sign-in (blastcp-oauth.cjs): PKCE, the authorize address, the loopback catch and the code swap.
// The Weft token exchange in the same file is tested in blastcp-weft.test.ts.

describe("blastcp-oauth", () => {
  it("makes an S256 challenge from its verifier", () => {
    const { verifier, challenge, state } = pkce();
    expect(challenge).toBe(crypto.createHash("sha256").update(verifier).digest("base64url"));
    expect(state).toMatch(/^[\w-]{20,}$/);
  });

  it("builds the authorize address", () => {
    const url = new URL(authorizeUrl({ clientId: "c", redirectUri: "http://127.0.0.1:5/callback", challenge: "ch", state: "st" }));
    expect(url.origin + url.pathname).toBe("https://blastcp.com/api/oauth/authorize");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ client_id: "c", code_challenge: "ch", code_challenge_method: "S256", state: "st", scope: "blastcp:all", response_type: "code" });
  });

  it("catches the code on the loopback server, and a refusal", async () => {
    const ok = await startLoopback();
    expect(ok.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    expect((await fetch(ok.redirectUri.replace("/callback", "/favicon.ico"))).status).toBe(404);
    const page = await fetch(`${ok.redirectUri}?code=abc&state=xyz`);
    expect(await page.text()).toContain("Connected to BlastCP");
    expect(await ok.result).toEqual({ code: "abc", state: "xyz" });
    ok.close();

    const no = await startLoopback();
    await fetch(`${no.redirectUri}?error=access_denied`);
    await expect(no.result).rejects.toThrow("You turned BlastCP down");
    no.close();

    const odd = await startLoopback();
    await fetch(odd.redirectUri);
    await expect(odd.result).rejects.toThrow("BlastCP answered with no code.");
    odd.close();

    const other = await startLoopback();
    await fetch(`${other.redirectUri}?error=server_error`);
    await expect(other.result).rejects.toThrow("BlastCP answered server_error.");
    other.close();
  });

  it("times out when you never finish in the browser", async () => {
    const slow = await startLoopback({ waitMs: 5 });
    await expect(slow.result).rejects.toThrow("timed out");
    slow.close();
  });

  type Answer = { status: number; body: unknown };
  function oauthFetch({ register = { status: 201, body: { client_id: "mcp_1" } }, token = { status: 200, body: { access_token: "tok", expires_in: 60 } } }: { register?: Answer; token?: Answer } = {}) {
    const calls: { url: string; body: string }[] = [];
    const fetch = vi.fn((url: string, init: { body: string }) => {
      calls.push({ url, body: init.body });
      const r = url.endsWith("/register") ? register : token;
      return Promise.resolve({ ok: r.status < 400, status: r.status, json: () => (r.body === null ? Promise.reject(new Error("x")) : Promise.resolve(r.body)) });
    });
    return { fetch, calls };
  }

  const loopbackWith = (back: (state: string) => { code: string; state: string | null }) => {
    const close = vi.fn();
    type Back = { code: string; state: string | null };
    let opened: (v: Back) => void = () => {};
    const result = new Promise<Back>((ok) => (opened = ok));
    // The browser "redirects back" once Weft opens it, with the state it was sent.
    const openExternal = (url: string) => opened(back(new URL(url).searchParams.get("state") ?? ""));
    const loopback = () => Promise.resolve({ redirectUri: "http://127.0.0.1:9/callback", result, close });
    return { loopback, openExternal, close };
  };

  it("signs in: registers, opens the browser, swaps the code for a token", async () => {
    const { fetch, calls } = oauthFetch();
    const { loopback, openExternal, close } = loopbackWith((state) => ({ code: "c0de", state }));
    const before = Date.now();
    const result = await signIn({ fetch, openExternal, loopback });
    expect(result).toMatchObject({ token: "tok", clientId: "mcp_1" });
    expect(result.expiresAt).toBeGreaterThanOrEqual(before + 60_000);
    expect(JSON.parse(calls[0]!.body)).toEqual({ client_name: "Weft", redirect_uris: ["http://127.0.0.1:9/callback"] });
    expect(Object.fromEntries(new URLSearchParams(calls[1]!.body))).toMatchObject({ grant_type: "authorization_code", code: "c0de", client_id: "mcp_1", redirect_uri: "http://127.0.0.1:9/callback" });
    expect(close).toHaveBeenCalled();
    const noExpiry = await signIn({ fetch: oauthFetch({ token: { status: 200, body: { access_token: "t" } } }).fetch, ...loopbackWith((state) => ({ code: "c", state })) });
    expect(noExpiry.expiresAt).toBeNull();
  });

  it("stops on a refused registration, a mismatched state or a refused token", async () => {
    const ok = () => loopbackWith((state) => ({ code: "c", state }));
    await expect(signIn({ fetch: oauthFetch({ register: { status: 400, body: { error_description: "Invalid redirect_uri" } } }).fetch, ...ok() })).rejects.toThrow("Invalid redirect_uri");
    await expect(signIn({ fetch: oauthFetch({ register: { status: 500, body: null } }).fetch, ...ok() })).rejects.toThrow("wouldn't register Weft (500)");
    const forged = loopbackWith(() => ({ code: "c", state: "other" }));
    await expect(signIn({ fetch: oauthFetch().fetch, ...forged })).rejects.toThrow("didn't match");
    expect(forged.close).toHaveBeenCalled();
    await expect(signIn({ fetch: oauthFetch({ token: { status: 400, body: { error_description: "PKCE verification failed" } } }).fetch, ...ok() })).rejects.toThrow("PKCE");
    await expect(signIn({ fetch: oauthFetch({ token: { status: 502, body: null } }).fetch, ...ok() })).rejects.toThrow("wouldn't give Weft a token (502)");
  });
});
