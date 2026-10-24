import { describe, expect, it, vi } from "vitest";

// /api/limits: the plan-limit history from lib/limit-history, for the burndown chart. The plan limits
// are one pool per account, shared by every CLI, so the answer is the account's whole history — which
// is what the chart draws. There is no per-CLI narrowing: a card on the CLI with the fewest readings
// would get a history too short to look back with.

vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/lib/limit-history", () => ({
  readSamples: vi.fn(() => [
    { at: 1, backend: "claude", kind: "five_hour", used: 5 },
    { at: 2, backend: "puku", kind: "five_hour", used: 9 },
  ]),
}));

const history = await import("@/lib/limit-history");
const route = await import("./limits/route");

const READ = { host: "localhost:3457" };

describe("GET /api/limits", () => {
  it("returns the account's whole history", async () => {
    const all = await route.GET(new Request("http://localhost:3457/api/limits", { headers: READ }));
    expect(await all.json()).toEqual({
      samples: [
        { at: 1, backend: "claude", kind: "five_hour", used: 5 },
        { at: 2, backend: "puku", kind: "five_hour", used: 9 },
      ],
    });
  });

  it("answers the same for a backend asked for", async () => {
    // The narrowing that used to be here is gone on purpose: a card on the CLI with the fewest
    // readings got a history too short to look back into the week before a reset.
    const asked = await route.GET(new Request("http://localhost:3457/api/limits?backend=claude", { headers: READ }));
    expect(await asked.json()).toEqual({
      samples: [
        { at: 1, backend: "claude", kind: "five_hour", used: 5 },
        { at: 2, backend: "puku", kind: "five_hour", used: 9 },
      ],
    });
  });

  it("refuses other hosts and reports errors", async () => {
    expect((await route.GET(new Request("http://evil.test/api/limits", { headers: { host: "evil.test" } }))).status).toBe(403);
    vi.mocked(history.readSamples).mockImplementationOnce(() => {
      throw new Error("boom");
    });
    expect((await route.GET(new Request("http://localhost:3457/api/limits", { headers: READ }))).status).toBe(500);
  });
});
