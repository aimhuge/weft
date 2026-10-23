import { describe, expect, it, vi } from "vitest";

// /api/copilot/suggestions: GET the board's chips, POST the one clicked. lib/store, lib/copilot-suggest and
// lib/copilot-sources are mocked.

vi.mock("next/server", () => ({ connection: async () => {} }));
// The guard reads the launch token; none here, so every check no-ops.
vi.mock("@/lib/shell-token", () => ({ shellToken: () => "" }));
vi.mock("@/lib/store", () => ({ listCards: vi.fn(() => [{ id: "a" }]) }));
const result = { chips: [{ text: "Commit Fix login", cardId: "a" }], covers: [] };
const suggest = vi.hoisted(() => ({ boardSuggestions: vi.fn(), boardContext: vi.fn(() => Promise.resolve("## Vercel deploys\n- weft: READY")) }));
vi.mock("@/lib/copilot-suggest", () => suggest);
const sources = vi.hoisted(() => ({ recordClick: vi.fn() }));
vi.mock("@/lib/copilot-sources", () => sources);

const route = await import("./copilot/suggestions/route");
const URL = "http://localhost:3457/api/copilot/suggestions";
const WRITE = { host: "localhost:3457", "x-weft-token": "1", "content-type": "application/json" };

describe("/api/copilot/suggestions", () => {
  it("GETs the board's chips", async () => {
    suggest.boardSuggestions.mockResolvedValue(result);
    const res = await route.GET(new Request(URL, { headers: { host: "localhost:3457" } }));
    expect(await res.json()).toEqual(result);
    expect(suggest.boardSuggestions).toHaveBeenCalledWith([{ id: "a" }]);
  });

  it("GETs what Haiku reads, as text, with ?context=1", async () => {
    const res = await route.GET(new Request(`${URL}?context=1`, { headers: { host: "localhost:3457" } }));
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(await res.text()).toBe("## Vercel deploys\n- weft: READY");
  });

  it("refuses a request from off this machine", async () => {
    expect((await route.GET(new Request(URL, { headers: { host: "evil.com" } }))).status).toBe(403);
    expect((await route.POST(new Request(URL, { method: "POST", headers: { host: "localhost:3457" }, body: "{}" }))).status).toBe(403);
  });

  it("logs a clicked chip, trimmed and capped", async () => {
    const res = await route.POST(new Request(URL, { method: "POST", headers: WRITE, body: JSON.stringify({ text: `  ${"x".repeat(300)} ` }) }));
    expect(await res.json()).toEqual({ ok: true });
    expect(sources.recordClick).toHaveBeenCalledWith("x".repeat(200));
  });

  it("wants text", async () => {
    for (const body of ["{}", '{"text": "  "}', "not json"])
      expect((await route.POST(new Request(URL, { method: "POST", headers: WRITE, body }))).status).toBe(400);
  });
});
