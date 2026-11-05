import { beforeEach, describe, expect, it, vi } from "vitest";

// The simulator live view's taps: the route behind electron/sim-live.cjs. The guard and the input module are
// mocked, so the route's own dispatch — the elevated check, the input, the failure — is what these tests pin.
const state = vi.hoisted(() => ({ denied: false }));

vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/lib/guard", () => ({
  elevated: () => (state.denied ? Response.json({ error: "This change needs Weft's own window" }, { status: 403 }) : null),
  fail: (err: unknown, status = 400) => Response.json({ error: err instanceof Error ? err.message : String(err) }, { status }),
}));
vi.mock("@/lib/simulator-input", () => ({
  parseInput: vi.fn((b: unknown) => b),
  sendInput: vi.fn(() => Promise.resolve("tap 1,2")),
}));

const input = await import("@/lib/simulator-input");
const route = await import("./simulator/input/route");

const post = (body: unknown) => new Request("http://localhost:3457/api/simulator/input", { method: "POST", headers: { host: "localhost:3457" }, body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  state.denied = false;
});

describe("POST /api/simulator/input", () => {
  it("sends the tap and says what it did", async () => {
    const res = await route.POST(post({ kind: "tap", device: "SIM-1", x: 0.1, y: 0.2 }));
    expect(await res.json()).toEqual({ ok: true, done: "tap 1,2" });
    expect(input.sendInput).toHaveBeenCalledWith({ kind: "tap", device: "SIM-1", x: 0.1, y: 0.2 });
  });

  it("needs the launch token", async () => {
    state.denied = true;
    const res = await route.POST(post({ kind: "tap", device: "SIM-1" }));
    expect(res.status).toBe(403);
    expect(input.sendInput).not.toHaveBeenCalled();
  });

  it("reports a failure", async () => {
    vi.mocked(input.sendInput).mockRejectedValueOnce(new Error("iPhone 16 isn't being watched"));
    const res = await route.POST(post({ kind: "tap", device: "SIM-1" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "iPhone 16 isn't being watched" });
  });
});
