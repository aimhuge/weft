import { beforeEach, describe, expect, it, vi } from "vitest";

// Settings → Connectors → Simulators: the route behind the simulator connector. lib/simulator-status and the
// guard are mocked, so the route's own dispatch — the guard, the status, the failure — is what these tests pin.

const state = vi.hoisted(() => ({ denied: false }));

vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/lib/guard", () => ({
  guard: () => (state.denied ? Response.json({ error: "Forbidden host" }, { status: 403 }) : null),
  fail: (err: unknown, status = 400) => Response.json({ error: err instanceof Error ? err.message : String(err) }, { status }),
}));
vi.mock("@/lib/simulator-status", () => ({
  simulatorStatus: vi.fn(() => Promise.resolve({ checks: [], devices: 0 })),
}));

const status = await import("@/lib/simulator-status");
const route = await import("./connectors/simulators/route");

const URL = "http://localhost:3457/api/connectors/simulators";
const READ = { host: "localhost:3457" };

beforeEach(() => {
  vi.clearAllMocks();
  state.denied = false;
});

describe("GET /api/connectors/simulators", () => {
  it("returns the simulator status", async () => {
    vi.mocked(status.simulatorStatus).mockResolvedValueOnce({ checks: [], devices: 2 });
    const res = await route.GET(new Request(URL, { headers: READ }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ checks: [], devices: 2 });
    expect(status.simulatorStatus).toHaveBeenCalled();
  });

  it("reports a failure", async () => {
    vi.mocked(status.simulatorStatus).mockRejectedValueOnce(new Error("simctl isn't on this Mac's PATH."));
    const res = await route.GET(new Request(URL, { headers: READ }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("simctl isn't on this Mac's PATH.");
  });

  it("refuses a request the guard denies", async () => {
    state.denied = true;
    const res = await route.GET(new Request(URL, { headers: READ }));
    expect(res.status).toBe(403);
    expect(status.simulatorStatus).not.toHaveBeenCalled();
  });
});
