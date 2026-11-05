// Settings → Devices → a worker → Connectors through the API (app/api/devices/connectors/route.ts): the guard, the
// account client, lib/connector-view and lib/connector-remote are mocked; their own tests cover the reads and calls.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ connection: async () => {} }));
const gate = vi.hoisted(() => ({ denied: null as Response | null, elevatedDenied: null as Response | null }));
vi.mock("@/lib/guard", () => ({
  guard: () => gate.denied,
  elevated: () => gate.elevatedDenied,
  fail: (err: Error, status = 400) => Response.json({ error: err.message }, { status }),
}));
const session = { data: { session: { access_token: "tok" } } };
vi.mock("@/lib/account", () => ({ accountClient: () => ({ auth: { getSession: () => Promise.resolve(session) } }) }));
const view = vi.hoisted(() => ({ connectorsView: vi.fn() }));
vi.mock("@/lib/connector-view", () => view);
const remote = vi.hoisted(() => ({ remoteDisconnect: vi.fn(), remoteRevoke: vi.fn(), revokeNote: vi.fn(() => "GitHub off · 1 token revoked ✓") }));
vi.mock("@/lib/connector-remote", () => remote);

const route = await import("./connectors/route");
const url = (q = "") => `http://localhost/api/devices/connectors${q}`;
const del = (q = "") => route.DELETE(new Request(url(q), { method: "DELETE" }));

beforeEach(() => {
  vi.clearAllMocks();
  gate.denied = null;
  gate.elevatedDenied = null;
});

describe("GET /api/devices/connectors", () => {
  it("reads your connectors", async () => {
    view.connectorsView.mockResolvedValue({ signedIn: true, workers: {} });
    expect(await (await route.GET(new Request(url()))).json()).toEqual({ signedIn: true, workers: {} });
  });

  it("says why with a 502 when they can't be read", async () => {
    view.connectorsView.mockRejectedValue(new Error("Couldn't read your connectors: no table"));
    const res = await route.GET(new Request(url()));
    expect([res.status, await res.json()]).toEqual([502, { error: "Couldn't read your connectors: no table" }]);
  });

  it("answers the guard first", async () => {
    gate.denied = new Response(null, { status: 403 });
    expect((await route.GET(new Request(url()))).status).toBe(403);
    expect(view.connectorsView).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/devices/connectors", () => {
  it("turns GitHub off for one worker, with your session, and says what GitHub confirmed", async () => {
    const result = { grants: 1, tokensRevoked: 1, unconfirmed: [], userToken: "rotated" };
    remote.remoteRevoke.mockResolvedValue(result);
    const res = await del("?worker=w1");
    expect(await res.json()).toEqual({ ok: true, note: "GitHub off · 1 token revoked ✓", ...result });
    expect(remote.remoteRevoke).toHaveBeenCalledWith("w1", { session, fetchFn: fetch, env: process.env });
    expect(remote.revokeNote).toHaveBeenCalledWith(result);
  });

  it("disconnects GitHub altogether with ?all=1", async () => {
    remote.remoteDisconnect.mockResolvedValue({ grants: 2, authorization: "deleted" });
    expect(await (await del("?all=1")).json()).toEqual({ ok: true, grants: 2, authorization: "deleted" });
    expect(remote.remoteRevoke).not.toHaveBeenCalled();
  });

  it("needs a worker", async () => {
    const res = await del();
    expect([res.status, await res.json()]).toEqual([400, { error: "Say which worker." }]);
    expect(remote.remoteRevoke).not.toHaveBeenCalled();
  });

  it("passes weft.zip's refusal on as a 502", async () => {
    remote.remoteRevoke.mockRejectedValue(new Error("Couldn't reach weft.zip."));
    const res = await del("?worker=w1");
    expect([res.status, await res.json()]).toEqual([502, { error: "Couldn't reach weft.zip." }]);
  });

  it("refuses a request that isn't elevated (a thread's curl with the plain token)", async () => {
    gate.elevatedDenied = Response.json({ error: "This change needs Weft's own window" }, { status: 403 });
    expect((await del("?worker=w1")).status).toBe(403);
    expect(remote.remoteRevoke).not.toHaveBeenCalled();
  });
});
