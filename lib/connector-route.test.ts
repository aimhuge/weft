import { describe, expect, it, vi } from "vitest";

vi.mock("./connector-deps", () => ({ connectorDeps: () => null, NOT_SET_UP: { error: "not set up" } }));
vi.mock("./web-session", () => ({ bearerUser: () => Promise.resolve(null) }));

const { connectorRoute, jsonBody, reply } = await import("./connector-route");
const { MintError } = await import("./connector-tokens");
const { fakeDb, deps, fakeGithub } = await import("./connector.harness");

const req = () => new Request("https://weft.zip/api/connectors/x", { method: "POST", body: "{" });
const user = { id: "u1", email: null, name: null, avatar: null };
const d = () => deps(fakeDb().db, fakeGithub({}).fetch);

describe("connectorRoute", () => {
  it("answers 503 unset, 401 signed out (by default), and never caches", async () => {
    const off = await connectorRoute(req(), () => Promise.resolve({}));
    expect(off.status).toBe(503);
    expect(off.headers.get("cache-control")).toContain("no-store");
    expect((await connectorRoute(req(), () => Promise.resolve({}), { deps: d })).status).toBe(401);
  });

  it("answers the handler's body, a MintError as its status, and anything else 502", async () => {
    const o = { deps: d, user: () => Promise.resolve(user) };
    expect(await (await connectorRoute(req(), (_deps, u) => Promise.resolve({ who: u.id }), o)).json()).toEqual({ who: "u1" });
    const refused = await connectorRoute(req(), () => Promise.reject(new MintError(409, "changed")), o);
    expect([refused.status, await refused.json()]).toEqual([409, { error: "changed" }]);
    expect((await connectorRoute(req(), () => Promise.reject(new Error("boom")), o)).status).toBe(502);
  });

  it("reads a body or null, and replies JSON", async () => {
    expect(await jsonBody(req())).toBeNull();
    expect(await jsonBody(new Request("https://x", { method: "POST", body: '{"a":1}' }))).toEqual({ a: 1 });
    expect(reply({ ok: true }, 201).status).toBe(201);
  });
});
