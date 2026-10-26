import { afterEach, describe, expect, it, vi } from "vitest";

// /api/admin/users/[id]/activity: the super-admin gate, the id check, then admin_user_activity through the service client.

vi.mock("next/server", () => ({ connection: async () => {} }));

const adminMock = vi.hoisted(() => ({
  requireSuperAdminWeft: vi.fn(),
  isAdminWeft: vi.fn(),
  adminServiceClient: vi.fn(),
}));
vi.mock("@/lib/admin", () => adminMock);

const route = await import("./admin/users/[id]/activity/route");

const ID = "de6ae0aa-1111-4222-8333-444455556666";

function get(id: string, host = "127.0.0.1:3457") {
  return route.GET(new Request(`http://127.0.0.1:3457/api/admin/users/${id}/activity`, { headers: { host } }), { params: Promise.resolve({ id }) });
}

afterEach(() => vi.clearAllMocks());

describe("/api/admin/users/[id]/activity", () => {
  it("answers the days, counts and summary", async () => {
    const rpc = vi.fn(() =>
      Promise.resolve({
        data: { days: [{ day: "2026-10-24", active: true, cards: 92, items: 15021 }, { day: "2026-10-25", active: true, cards: 54, items: 4204 }], cards: 751, sessions: 4 },
        error: null,
      }),
    );
    adminMock.adminServiceClient.mockResolvedValueOnce({ rpc });
    const res = await get(ID);
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("admin_user_activity", { uid: ID, days: 84 });
    const data = (await res.json()) as Record<string, unknown>;
    expect(data).toMatchObject({ cards: 751, sessions: 4, summary: { streak: 2, active7: 2, peakCards: 92 } });
  });

  it("refuses an id that isn't a uuid before touching the database", async () => {
    const res = await get("nope");
    expect(res.status).toBe(400);
    expect(adminMock.adminServiceClient).not.toHaveBeenCalled();
  });

  it("answers 503 without the service key", async () => {
    adminMock.adminServiceClient.mockResolvedValueOnce(null);
    expect((await get(ID)).status).toBe(503);
  });

  it("passes the RPC's error on", async () => {
    adminMock.adminServiceClient.mockResolvedValueOnce({ rpc: () => Promise.resolve({ data: null, error: { message: "function not found" } }) });
    const res = await get(ID);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "function not found" });
  });

  it("says it couldn't read when the error has no message", async () => {
    adminMock.adminServiceClient.mockResolvedValueOnce({ rpc: () => Promise.resolve({ data: null, error: {} }) });
    expect(await (await get(ID)).json()).toEqual({ error: "Couldn't read the activity." });
  });

  it("runs the gate first", async () => {
    adminMock.requireSuperAdminWeft.mockRejectedValueOnce(new Error("NEXT_NOT_FOUND"));
    expect((await get(ID)).status).toBe(400);
    expect(adminMock.adminServiceClient).not.toHaveBeenCalled();
  });

  it("refuses non-localhost hosts", async () => {
    expect((await get(ID, "evil.com")).status).toBe(403);
  });
});
