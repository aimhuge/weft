import { describe, expect, it, vi } from "vitest";

// /api/limits/plans: the plan limits for the status strip — each CLI that has reported, carrying its
// OWN newest 5-hour and weekly reading. Each CLI has its own plan (lib/plan-pools.ts), so Claude Code's
// windows never land on puku-cli's entry (lib/plan-limits.ts).

vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/lib/limit-history", () => ({
  readSamples: vi.fn(() => [
    { at: 1, backend: "claude", kind: "five_hour", used: 5, resetsAt: 100 },
    { at: 2, backend: "puku", kind: "seven_day", used: 9 },
  ]),
}));
// The models that hit their own cap come with the plans (lib/model-limit.ts). Mocked so the test reads
// no real store, and so the shape the client gets (lib/use-plan-limits.ts) is pinned here.
vi.mock("@/lib/model-limit", () => ({
  modelLimits: vi.fn(() => []),
}));

vi.mock("@/lib/worker-limits-read", () => ({
  workerLimits: vi.fn(() => Promise.resolve({ samples: [{ at: 3, backend: "claude", kind: "five_hour", used: 70 }], models: [{ model: "claude-sonnet-5", at: 2, resetsAt: 50 }] })),
}));

const history = await import("@/lib/limit-history");
const reads = await import("@/lib/worker-limits-read");
const limits = await import("@/lib/model-limit");
const route = await import("./limits/plans/route");

const READ = { host: "localhost:3457" };

describe("GET /api/limits/plans", () => {
  it("returns each CLI's entry with its own windows, and the models at their cap", async () => {
    vi.mocked(limits.modelLimits).mockReturnValueOnce([{ model: "claude-opus-5-5", at: 1, resetsAt: 100 }]);
    const res = await route.GET(new Request("http://localhost:3457/api/limits/plans", { headers: READ }));
    expect(await res.json()).toEqual({
      plans: {
        claude: { reportedAt: 1, fiveHour: { used: 5, resetsAt: 100 }, fiveHourAt: 1 },
        puku: { reportedAt: 2, sevenDay: { used: 9 }, sevenDayAt: 2 },
      },
      models: [{ model: "claude-opus-5-5", at: 1, resetsAt: 100 }],
    });
  });

  it("returns a worker's own plans and capped models with ?worker=", async () => {
    const res = await route.GET(new Request("http://localhost:3457/api/limits/plans?worker=w1", { headers: READ }));
    expect(await res.json()).toEqual({
      plans: { claude: { reportedAt: 3, fiveHour: { used: 70 }, fiveHourAt: 3 } },
      models: [{ model: "claude-sonnet-5", at: 2, resetsAt: 50 }],
    });
    expect(reads.workerLimits).toHaveBeenCalledWith("w1");
  });

  it("refuses other hosts and reports errors", async () => {
    expect((await route.GET(new Request("http://evil.test/api/limits/plans", { headers: { host: "evil.test" } }))).status).toBe(403);
    vi.mocked(history.readSamples).mockImplementationOnce(() => {
      throw new Error("boom");
    });
    expect((await route.GET(new Request("http://localhost:3457/api/limits/plans", { headers: READ }))).status).toBe(500);
  });
});
