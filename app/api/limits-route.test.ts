import { describe, expect, it, vi } from "vitest";

// /api/limits: the plan-limit history from lib/limit-history, for the burndown chart. Each CLI has its
// own plan (lib/plan-pools.ts), so ?backend asks for that CLI's OWN readings: asking for claude gives
// Claude Code's rows and asking for puku gives Puku's. Without it, every plan's.

vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/lib/limit-history", () => ({
  readSamples: vi.fn(() => [
    { at: 1, backend: "claude", kind: "five_hour", used: 5 },
    { at: 2, backend: "puku", kind: "five_hour", used: 9 },
    { at: 3, backend: "codex", kind: "five_hour", used: 3 },
  ]),
}));

const history = await import("@/lib/limit-history");
const route = await import("./limits/route");

const READ = { host: "localhost:3457" };

describe("GET /api/limits", () => {
  it("returns every plan's samples when no backend is asked for", async () => {
    const all = await route.GET(new Request("http://localhost:3457/api/limits", { headers: READ }));
    expect(await all.json()).toEqual({
      samples: [
        { at: 1, backend: "claude", kind: "five_hour", used: 5 },
        { at: 2, backend: "puku", kind: "five_hour", used: 9 },
        { at: 3, backend: "codex", kind: "five_hour", used: 3 },
      ],
    });
  });

  it("answers with the CLI's own readings", async () => {
    const claude = await route.GET(new Request("http://localhost:3457/api/limits?backend=claude", { headers: READ }));
    expect(await claude.json()).toEqual({
      samples: [{ at: 1, backend: "claude", kind: "five_hour", used: 5 }],
    });
    const puku = await route.GET(new Request("http://localhost:3457/api/limits?backend=puku", { headers: READ }));
    expect(await puku.json()).toEqual({
      samples: [{ at: 2, backend: "puku", kind: "five_hour", used: 9 }],
    });
  });

  it("keeps another plan's readings out of it", async () => {
    const codex = await route.GET(new Request("http://localhost:3457/api/limits?backend=codex", { headers: READ }));
    expect(await codex.json()).toEqual({ samples: [{ at: 3, backend: "codex", kind: "five_hour", used: 3 }] });
  });

  it("refuses other hosts and reports errors", async () => {
    expect((await route.GET(new Request("http://evil.test/api/limits", { headers: { host: "evil.test" } }))).status).toBe(403);
    vi.mocked(history.readSamples).mockImplementationOnce(() => {
      throw new Error("boom");
    });
    expect((await route.GET(new Request("http://localhost:3457/api/limits", { headers: READ }))).status).toBe(500);
  });
});
