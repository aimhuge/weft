// GET /api/web-board/ice (app/api/web-board/ice/route.ts): lib/web-ice.ts's answer as a no-store response.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { webIce, requestSession } = vi.hoisted(() => ({ webIce: vi.fn(), requestSession: vi.fn() }));
vi.mock("@/lib/web-ice", () => ({ webIce }));
vi.mock("@/lib/web-session", () => ({ requestSession }));

const { GET } = await import("./route");
const get = () => GET(new Request("http://localhost/api/web-board/ice"));

beforeEach(() => {
  vi.clearAllMocks();
  requestSession.mockResolvedValue({ supabase: {}, user: { id: "u1" } });
});

describe("GET /api/web-board/ice", () => {
  it("answers the servers for the visitor's session, never cached", async () => {
    webIce.mockResolvedValue({ status: 200, body: { iceServers: [{ urls: "turn:t" }], turn: true } });
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("retry-after")).toBeNull();
    expect(await res.json()).toEqual({ iceServers: [{ urls: "turn:t" }], turn: true });
    expect(webIce).toHaveBeenCalledWith({ supabase: {}, user: { id: "u1" } });
  });

  it("passes a refusal through, with Retry-After when rate-limited", async () => {
    webIce.mockResolvedValueOnce({ status: 403, body: { error: "no" } });
    expect((await get()).status).toBe(403);
    webIce.mockResolvedValueOnce({ status: 429, body: { error: "slow" }, retryAfter: 42 });
    const res = await get();
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("42");
  });
});
