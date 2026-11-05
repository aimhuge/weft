// The desktop's calls to weft.zip's GitHub connector routes (lib/connector-remote.ts): the bearer, where they go, how
// each failure reads, and the note a worker's row shows after a revoke.
import { describe, expect, it, vi } from "vitest";
import { connectorSite, connectUrl, remoteDisconnect, remoteRevoke, remoteStatus, revokeNote, type RemoteDeps } from "./connector-remote";

const signedIn = { data: { session: { access_token: "tok" } } };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function deps(answer: () => Promise<Response>, over: Partial<RemoteDeps> = {}) {
  const fetchFn = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(() => answer());
  return { deps: { session: signedIn, fetchFn: fetchFn as unknown as typeof fetch, env: {}, ...over }, fetchFn };
}

describe("where the calls go", () => {
  it("is weft.zip unless WEFT_CONNECTOR_URL says otherwise, without a trailing slash", () => {
    expect(connectorSite({})).toBe("https://weft.zip");
    expect(connectorSite({ WEFT_CONNECTOR_URL: "http://localhost:3000//" })).toBe("http://localhost:3000");
    expect(connectUrl({ WEFT_CONNECTOR_URL: "http://localhost:3000" })).toBe("http://localhost:3000/api/connectors/github/start");
    expect(connectUrl()).toMatch(/\/api\/connectors\/github\/start$/);
  });
});

describe("the calls", () => {
  it("reads the status with your session as a bearer", async () => {
    const { deps: d, fetchFn } = deps(() => Promise.resolve(json({ connected: true, login: "ada" })), { env: { WEFT_CONNECTOR_URL: "http://x.test" } });
    expect(await remoteStatus(d)).toEqual({ connected: true, login: "ada" });
    expect(fetchFn).toHaveBeenCalledWith("http://x.test/api/connectors/github", { method: "GET", headers: { authorization: "Bearer tok" } });
  });

  it("revokes one worker with a JSON body", async () => {
    const result = { grants: 1, tokensRevoked: 2, unconfirmed: [], userToken: "revoked" };
    const { deps: d, fetchFn } = deps(() => Promise.resolve(json(result)));
    expect(await remoteRevoke("w1", d)).toEqual(result);
    expect(fetchFn).toHaveBeenCalledWith("https://weft.zip/api/connectors/github/revoke", {
      method: "POST",
      headers: { authorization: "Bearer tok", "content-type": "application/json" },
      body: JSON.stringify({ workerId: "w1" }),
    });
  });

  it("disconnects with DELETE", async () => {
    const { deps: d, fetchFn } = deps(() => Promise.resolve(json({ grants: 2, authorization: "deleted" })));
    expect(await remoteDisconnect(d)).toEqual({ grants: 2, authorization: "deleted" });
    expect(fetchFn.mock.calls[0]![1]).toMatchObject({ method: "DELETE" });
  });

  it("needs you signed in, and asks nothing then", async () => {
    const { deps: d, fetchFn } = deps(() => Promise.resolve(json({})), { session: { data: { session: null } } });
    await expect(remoteStatus(d)).rejects.toThrow("Sign in to Weft first.");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("says when weft.zip can't be reached", async () => {
    const { deps: d } = deps(() => Promise.reject(new TypeError("fetch failed")));
    await expect(remoteStatus(d)).rejects.toThrow("Couldn't reach weft.zip.");
  });

  it("passes weft.zip's own error on, or names the status", async () => {
    await expect(remoteStatus(deps(() => Promise.resolve(json({ error: "Sign in to Weft first." }, 401))).deps)).rejects.toThrow("Sign in to Weft first.");
    await expect(remoteStatus(deps(() => Promise.resolve(json({}, 503))).deps)).rejects.toThrow("weft.zip answered HTTP 503.");
    await expect(remoteStatus(deps(() => Promise.resolve(new Response("<html>", { status: 200 }))).deps)).rejects.toThrow("weft.zip answered HTTP 200.");
  });
});

describe("revokeNote", () => {
  const base = { grants: 1, tokensRevoked: 0, unconfirmed: [], userToken: "revoked" };

  it("says it's off, and whether it already was", () => {
    expect(revokeNote(base)).toBe("GitHub off");
    expect(revokeNote({ ...base, grants: 0 })).toBe("GitHub off (it was off)");
  });

  it("counts the tokens GitHub confirmed", () => {
    expect(revokeNote({ ...base, tokensRevoked: 1 })).toBe("GitHub off · 1 token revoked ✓");
    expect(revokeNote({ ...base, tokensRevoked: 3 })).toBe("GitHub off · 3 tokens revoked ✓");
  });

  it("says when the unconfirmed ones end, by the latest expiry", () => {
    const late = "2026-11-02T18:00:00Z";
    const note = revokeNote({ ...base, unconfirmed: [{ expiresAt: "2026-11-02T10:00:00Z" }, { expiresAt: null }, { expiresAt: late }] });
    expect(note).toBe(`GitHub off · 3 not confirmed by GitHub, ending by ${new Date(late).toLocaleTimeString()}`);
    expect(revokeNote({ ...base, unconfirmed: [{ expiresAt: null }] })).toBe("GitHub off · 1 not confirmed by GitHub");
  });

  it("warns when your own user token wasn't confirmed", () => {
    expect(revokeNote({ ...base, userToken: "unconfirmed" })).toBe("GitHub off · your user token wasn't confirmed revoked; it ends within 8 hours");
  });
});
