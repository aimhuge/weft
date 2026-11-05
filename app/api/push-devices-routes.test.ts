import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ connection: async () => {} }));

const listPushDevices = vi.fn();
const removePushDevice = vi.fn();
vi.mock("@/lib/push-devices", () => ({ listPushDevices, removePushDevice }));

const route = await import("./push-devices/route");

const WRITE = { host: "localhost:3457", "x-weft-token": "1" };
const READ = { host: "localhost:3457" };
const req = (url: string, method = "GET", headers: Record<string, string> = WRITE) => new Request(`http://localhost:3457/api${url}`, { method, headers });

beforeEach(() => vi.clearAllMocks());

describe("GET /api/push-devices", () => {
  it("lists the phones", async () => {
    listPushDevices.mockResolvedValue({ signedIn: true, devices: [{ id: "d1" }] });
    const res = await route.GET(req("/push-devices", "GET", READ));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ signedIn: true, devices: [{ id: "d1" }] });
  });

  it("502s with the error when Supabase fails", async () => {
    listPushDevices.mockRejectedValue(new Error("down"));
    const res = await route.GET(req("/push-devices"));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "down" });
  });

  it("refuses a foreign host", async () => {
    const res = await route.GET(req("/push-devices", "GET", { host: "evil.com" }));
    expect(res.status).toBe(403);
    expect(listPushDevices).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/push-devices", () => {
  it("removes the phone", async () => {
    removePushDevice.mockResolvedValue(undefined);
    const res = await route.DELETE(req("/push-devices?id=d1", "DELETE"));
    expect(res.status).toBe(200);
    expect(removePushDevice).toHaveBeenCalledWith("d1");
  });

  it("400s without an id", async () => {
    const res = await route.DELETE(req("/push-devices", "DELETE"));
    expect(res.status).toBe(400);
    expect(removePushDevice).not.toHaveBeenCalled();
  });

  it("502s when the delete fails", async () => {
    removePushDevice.mockRejectedValue(new Error("nope"));
    const res = await route.DELETE(req("/push-devices?id=d1", "DELETE"));
    expect(res.status).toBe(502);
  });

  it("needs the window's token", async () => {
    const res = await route.DELETE(req("/push-devices?id=d1", "DELETE", READ));
    expect(res.status).toBe(403);
    expect(removePushDevice).not.toHaveBeenCalled();
  });
});
