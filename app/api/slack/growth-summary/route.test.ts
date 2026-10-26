import { beforeEach, describe, expect, it, vi } from "vitest";

// The daily growth summary (app/api/slack/growth-summary/route.ts): the cron card posts one summary a day and
// asks the route what went out, so the card can say what happened rather than claim a message that never
// arrived. GET is the numbers on their own, for a card that only wants to read them.

vi.mock("@/lib/slack-growth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/slack-growth")>("@/lib/slack-growth");
  return { ...actual, postGrowthSummary: vi.fn(() => Promise.resolve(true)) };
});

vi.mock("@/lib/growth-read", async () => {
  const actual = await vi.importActual<typeof import("@/lib/growth-read")>("@/lib/growth-read");
  return { ...actual, growthOverview: vi.fn(() => Promise.resolve(actual.growthOverview)) };
});

const { POST, GET } = await import("./route");
const { postGrowthSummary } = await import("@/lib/slack-growth");
const { growthOverview } = await import("@/lib/growth-read");

const WRITE = { host: "localhost:3457", "x-weft-token": "1", "content-type": "application/json" };
const READ = { host: "localhost:3457", "content-type": "application/json" };

const OVERVIEW = {
  accounts: 12,
  new_7d: 3,
  new_30d: 9,
  signed_in_7d: 5,
  signed_in_30d: 8,
  never_signed_in: 2,
  workspaces: 6,
  invites_pending: 1,
  syncing_accounts: 4,
  synced_cards: 21,
  paying_workspaces: 2,
};

const req = (headers: Record<string, string>) => new Request("http://localhost:3457/api/slack/growth-summary", { headers });

beforeEach(() => {
  vi.mocked(postGrowthSummary).mockClear();
  vi.mocked(postGrowthSummary).mockResolvedValue(true);
  vi.mocked(growthOverview).mockClear();
  vi.mocked(growthOverview).mockResolvedValue(OVERVIEW);
});

describe("POST", () => {
  it("says what went out", async () => {
    const res = await POST(req(WRITE));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      url: "https://weft.zip/apps/growth",
      lines: [
        "3 new in 7 days (9 in 30)",
        "12 accounts, 5 signed in this week",
        "6 workspaces, 2 paying",
        "21 cards synced by 4 accounts",
      ],
    });
    expect(postGrowthSummary).toHaveBeenCalledTimes(1);
  });

  it("says so when the summary did not go out", async () => {
    vi.mocked(postGrowthSummary).mockResolvedValue(false);
    const res = await POST(req(WRITE));
    expect(res.status).toBe(503);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain("did not go out");
  });

  it("says nothing about numbers it could not read", async () => {
    // The summary went out; the numbers that come after it could not be read.
    vi.mocked(growthOverview).mockResolvedValue(null);
    const res = await POST(req(WRITE));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, url: "https://weft.zip/apps/growth", lines: [] });
  });

  it("refuses a write without the board's token", async () => {
    const res = await POST(req(READ));
    expect(res.status).toBe(403);
    expect(postGrowthSummary).not.toHaveBeenCalled();
  });

  it("refuses a request from another host", async () => {
    const res = await POST(new Request("http://evil.test/api/slack/growth-summary", { headers: { "x-weft-token": "1" } }));
    expect(res.status).toBe(403);
    expect(postGrowthSummary).not.toHaveBeenCalled();
  });

  it("says what went wrong when the posting throws", async () => {
    vi.mocked(postGrowthSummary).mockRejectedValue(new Error("slack is down"));
    const res = await POST(req(WRITE));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "slack is down" });
  });
});

describe("GET", () => {
  it("answers with the numbers and the dashboard's address", async () => {
    const res = await GET(req(READ));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      url: "https://weft.zip/apps/growth",
      lines: [
        "3 new in 7 days (9 in 30)",
        "12 accounts, 5 signed in this week",
        "6 workspaces, 2 paying",
        "21 cards synced by 4 accounts",
      ],
      overview: OVERVIEW,
    });
    // A read posts nothing.
    expect(postGrowthSummary).not.toHaveBeenCalled();
  });

  it("says so when the numbers can't be read", async () => {
    vi.mocked(growthOverview).mockResolvedValue(null);
    const res = await GET(req(READ));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "The growth numbers could not be read." });
  });

  it("refuses a request from another host", async () => {
    const res = await GET(new Request("http://evil.test/api/slack/growth-summary", { headers: { "content-type": "application/json" } }));
    expect(res.status).toBe(403);
    expect(growthOverview).not.toHaveBeenCalled();
  });
});
