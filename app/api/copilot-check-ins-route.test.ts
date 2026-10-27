import { beforeEach, describe, expect, it, vi } from "vitest";

// /api/copilot/check-ins: GET and POST behind the localhost guard and x-weft-token, reading and setting whether the
// copilot checks in on its own (lib/copilot-initiative-run.ts).

vi.mock("@/lib/copilot-initiative-run", () => ({ checkInsOn: vi.fn(() => true), setCheckInsOn: vi.fn() }));

const lib = await import("@/lib/copilot-initiative-run");
const route = await import("./copilot/check-ins/route");

const URL = "http://localhost:3457/api/copilot/check-ins";
const WRITE = { host: "localhost:3457", "x-weft-token": "1", "content-type": "application/json" };
const post = (body: string, headers: Record<string, string> = WRITE) => route.POST(new Request(URL, { method: "POST", headers, body }));

beforeEach(() => vi.clearAllMocks());

describe("/api/copilot/check-ins", () => {
  it("says whether check-ins are on", async () => {
    const res = route.GET(new Request(URL, { headers: WRITE }));
    expect(await res.json()).toEqual({ on: true });
  });

  it("turns them off and on", async () => {
    const res = await post(JSON.stringify({ on: false }));
    expect(await res.json()).toEqual({ on: false });
    expect(lib.setCheckInsOn).toHaveBeenCalledWith(false);
  });

  it("refuses anything but true or false, and a body that isn't JSON", async () => {
    expect((await post(JSON.stringify({ on: "yes" }))).status).toBe(400);
    expect((await post("{")).status).toBe(400);
    expect(lib.setCheckInsOn).not.toHaveBeenCalled();
  });

  it("needs the x-weft-token header", async () => {
    expect(route.GET(new Request(URL, { headers: { host: "localhost:3457" } })).status).toBe(403);
    expect((await post(JSON.stringify({ on: true }), { host: "localhost:3457" })).status).toBe(403);
    expect(lib.setCheckInsOn).not.toHaveBeenCalled();
  });
});
