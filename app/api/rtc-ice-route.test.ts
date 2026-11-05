// GET /api/rtc-ice (app/api/rtc-ice/route.ts): the session line's ICE servers, for Weft's own window only.
import { describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ connection: async () => {} }));
const elevated = vi.hoisted(() => vi.fn((): Response | null => null));
vi.mock("@/lib/guard", () => ({ elevated }));
vi.mock("@/lib/rtc-ice", () => ({ mintIce: () => Promise.resolve({ iceServers: [{ urls: "stun:s" }], turn: false }) }));

const { GET } = await import("./rtc-ice/route");

describe("GET /api/rtc-ice", () => {
  it("answers the servers", async () => {
    const res = await GET(new Request("http://127.0.0.1/api/rtc-ice"));
    expect(await res.json()).toEqual({ iceServers: [{ urls: "stun:s" }], turn: false });
  });

  it("refuses what isn't Weft's own window", async () => {
    elevated.mockReturnValueOnce(Response.json({ error: "no" }, { status: 403 }));
    expect((await GET(new Request("http://127.0.0.1/api/rtc-ice"))).status).toBe(403);
  });
});
