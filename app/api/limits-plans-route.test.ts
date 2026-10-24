import { describe, expect, it, vi } from "vitest";

// /api/limits/plans: the plan limits for the status strip — each CLI that has reported, carrying the
// PLAN's newest 5-hour and weekly reading. The plan limits are one pool per account (lib/plan-pools.ts),
// so Claude Code and puku-cli read the same windows; only "who reported" differs (lib/plan-limits.ts).

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

const history = await import("@/lib/limit-history");
const limits = await import("@/lib/model-limit");
const route = await import("./limits/plans/route");

const READ = { host: "localhost:3457" };

describe("GET /api/limits/plans", () => {
  it("returns each CLI's entry with the pool's windows, and the models at their cap", async () => {
    vi.mocked(limits.modelLimits).mockReturnValueOnce([{ model: "claude-opus-5-5", at: 1, resetsAt: 100 }]);
    const res = await route.GET(new Request("http://localhost:3457/api/limits/plans", { headers: READ }));
    expect(await res.json()).toEqual({
      plans: {
        claude: { reportedAt: 1, fiveHour: { used: 5, resetsAt: 100 }, fiveHourAt: 1, sevenDay: { used: 9 }, sevenDayAt: 2 },
        puku: { reportedAt: 2, fiveHour: { used: 5, resetsAt: 100 }, fiveHourAt: 1, sevenDay: { used: 9 }, sevenDayAt: 2 },
      },
      models: [{ model: "claude-opus-5-5", at: 1, resetsAt: 100 }],
    });
  });

  it("refuses other hosts and reports errors", async () => {
    expect((await route.GET(new Request("http://evil.test/api/limits/plans", { headers: { host: "evil.test" } }))).status).toBe(403);
    vi.mocked(history.readSamples).mockImplementationOnce(() => {
      throw new Error("boom");
    });
    expect((await route.GET(new Request("http://localhost:3457/api/limits/plans", { headers: READ }))).status).toBe(500);
  });
});
