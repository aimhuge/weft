import { describe, expect, it, vi } from "vitest";

// /api/limits/plans: each CLI's newest 5-hour and weekly reading, for the status strip.

vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/lib/limit-history", () => ({
  readSamples: vi.fn(() => [
    { at: 1, backend: "claude", kind: "five_hour", used: 5, resetsAt: 100 },
    { at: 2, backend: "puku", kind: "seven_day", used: 9 },
  ]),
}));

const history = await import("@/lib/limit-history");
const route = await import("./limits/plans/route");

const READ = { host: "localhost:3457" };

describe("GET /api/limits/plans", () => {
  it("returns each CLI's own plan", async () => {
    const res = await route.GET(new Request("http://localhost:3457/api/limits/plans", { headers: READ }));
    expect(await res.json()).toEqual({
      plans: {
        claude: { at: 1, fiveHour: { used: 5, resetsAt: 100 } },
        puku: { at: 2, sevenDay: { used: 9 } },
      },
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
