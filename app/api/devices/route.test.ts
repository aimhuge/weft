// Settings → Devices through the API (app/api/devices/route.ts): the guard and lib/device-registry are mocked;
// lib/device-registry.test.ts covers the reads and the revoke themselves.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ connection: async () => {} }));
const gate = vi.hoisted(() => ({ denied: null as Response | null, elevatedDenied: null as Response | null }));
vi.mock("@/lib/guard", () => ({
  guard: () => gate.denied,
  elevated: () => gate.elevatedDenied,
  fail: (err: Error, status = 400) => Response.json({ error: err.message }, { status }),
}));
const registry = vi.hoisted(() => ({ listDevices: vi.fn(), revokeDevice: vi.fn(), moveThreads: vi.fn() }));
vi.mock("@/lib/device-registry", () => registry);

const route = await import("./route");
const url = (q = "") => `http://localhost/api/devices${q}`;

beforeEach(() => {
  vi.clearAllMocks();
  gate.denied = null;
  gate.elevatedDenied = null;
});

describe("GET /api/devices", () => {
  it("lists your devices", async () => {
    registry.listDevices.mockResolvedValue({ signedIn: true, devices: [{ id: "d1" }] });
    const res = await route.GET(new Request(url()));
    expect(await res.json()).toEqual({ signedIn: true, devices: [{ id: "d1" }] });
  });

  it("says why when the registry can't be read", async () => {
    registry.listDevices.mockRejectedValue(new Error("Couldn't read your devices: no view"));
    const res = await route.GET(new Request(url()));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Couldn't read your devices: no view" });
  });

  it("answers the guard first", async () => {
    gate.denied = new Response(null, { status: 403 });
    expect((await route.GET(new Request(url()))).status).toBe(403);
    expect(registry.listDevices).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/devices", () => {
  it("revokes one and says its kind", async () => {
    registry.revokeDevice.mockResolvedValue({ kind: "worker" });
    const res = await route.DELETE(new Request(url("?id=w1"), { method: "DELETE" }));
    expect(registry.revokeDevice).toHaveBeenCalledWith("w1");
    expect(await res.json()).toEqual({ ok: true, kind: "worker" });
  });

  it("needs an id", async () => {
    const res = await route.DELETE(new Request(url(), { method: "DELETE" }));
    expect(res.status).toBe(400);
    expect(registry.revokeDevice).not.toHaveBeenCalled();
  });

  it("passes a refusal on", async () => {
    registry.revokeDevice.mockRejectedValue(new Error("Couldn't revoke that device: That isn't one of your devices."));
    const res = await route.DELETE(new Request(url("?id=x"), { method: "DELETE" }));
    expect(res.status).toBe(502);
  });

  it("refuses a request that isn't elevated (a thread's curl with the plain token)", async () => {
    gate.elevatedDenied = Response.json({ error: "This change needs Weft's own window" }, { status: 403 });
    expect((await route.DELETE(new Request(url("?id=x"), { method: "DELETE" }))).status).toBe(403);
    expect(registry.revokeDevice).not.toHaveBeenCalled();
  });
});

describe("POST /api/devices", () => {
  const post = (body: unknown) => new Request(url(), { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });

  it("moves one worker's threads onto another and says how many", async () => {
    registry.moveThreads.mockResolvedValue({ moved: 38 });
    const res = await route.POST(post({ from: "old", to: "new" }));
    expect(registry.moveThreads).toHaveBeenCalledWith("old", "new");
    expect(await res.json()).toEqual({ ok: true, moved: 38 });
  });

  it("needs both workers", async () => {
    for (const body of [{ from: "old" }, { from: "", to: "new" }, { from: 1, to: "new" }, "not json"]) {
      expect((await route.POST(post(body))).status).toBe(400);
    }
    expect(registry.moveThreads).not.toHaveBeenCalled();
  });

  it("passes a refusal on", async () => {
    registry.moveThreads.mockRejectedValue(new Error("Couldn't move those threads: That worker was revoked."));
    const res = await route.POST(post({ from: "old", to: "new" }));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Couldn't move those threads: That worker was revoked." });
  });

  it("is Weft's window only", async () => {
    gate.elevatedDenied = new Response(null, { status: 403 });
    expect((await route.POST(post({ from: "old", to: "new" }))).status).toBe(403);
    expect(registry.moveThreads).not.toHaveBeenCalled();
  });
});
