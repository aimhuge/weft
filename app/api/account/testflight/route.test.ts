import { beforeEach, describe, expect, it, vi } from "vitest";

// The local /api/account/testflight route: localhost guard, then the testflight client.

const client = vi.hoisted(() => ({ fetchTestflight: vi.fn(), requestInvite: vi.fn() }));
vi.mock("@/lib/testflight-client", () => client);

const route = await import("./route");

const LOCAL = { host: "127.0.0.1:3457", "x-weft-token": "1" };
const req = (method: "GET" | "POST", headers: Record<string, string> = LOCAL) =>
  new Request("http://127.0.0.1:3457/api/account/testflight", { method, headers });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/account/testflight", () => {
  it("returns the client's info", async () => {
    client.fetchTestflight.mockResolvedValueOnce({ url: "https://testflight.apple.com/join/abc", invites: true });
    const res = await route.GET(req("GET"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: "https://testflight.apple.com/join/abc", invites: true });
  });

  it("passes through null (nothing to show)", async () => {
    client.fetchTestflight.mockResolvedValueOnce(null);
    const res = await route.GET(req("GET"));
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
  });

  it("refuses other hosts", async () => {
    const res = await route.GET(req("GET", { host: "evil.com" }));
    expect(res.status).toBe(403);
    expect(client.fetchTestflight).not.toHaveBeenCalled();
  });

  it("is 400 with the message when the client throws", async () => {
    client.fetchTestflight.mockRejectedValueOnce(new Error("network down"));
    const res = await route.GET(req("GET"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "network down" });
  });
});

describe("POST /api/account/testflight", () => {
  it("returns the invite answer", async () => {
    client.requestInvite.mockResolvedValueOnce({ ok: true, email: "a@b.co", already: false });
    const res = await route.POST(req("POST"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, email: "a@b.co", already: false });
  });

  it("passes a failed answer through as 200 so the dialog shows the message", async () => {
    client.requestInvite.mockResolvedValueOnce({ ok: false, error: "Sign in to your Weft account first." });
    const res = await route.POST(req("POST"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, error: "Sign in to your Weft account first." });
  });

  it("refuses other hosts, and writes without the token header", async () => {
    expect((await route.POST(req("POST", { host: "evil.com", "x-weft-token": "1" }))).status).toBe(403);
    expect((await route.POST(req("POST", { host: "127.0.0.1:3457" }))).status).toBe(403);
    expect(client.requestInvite).not.toHaveBeenCalled();
  });

  it("is 400 with the message when the client throws", async () => {
    client.requestInvite.mockRejectedValueOnce(new Error("boom"));
    const res = await route.POST(req("POST"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "boom" });
  });
});
