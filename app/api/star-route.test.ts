import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ connection: async () => {} }));

const starStatus = vi.fn();
const starRepo = vi.fn();
vi.mock("@/lib/github-star", () => ({ starStatus, starRepo }));

const route = await import("./star/route");

const WRITE = { host: "localhost:3457", "x-weft-token": "1" };
const READ = { host: "localhost:3457" };
const req = (method: string, headers: Record<string, string>) => new Request("http://localhost:3457/api/star", { method, headers });

beforeEach(() => vi.clearAllMocks());

describe("GET /api/star", () => {
  it("says whether you've starred Weft", async () => {
    starStatus.mockResolvedValue(false);
    const res = await route.GET(req("GET", READ));
    expect(await res.json()).toEqual({ starred: false });
  });

  it("refuses a foreign host", async () => {
    const res = await route.GET(req("GET", { host: "evil.com" }));
    expect(res.status).toBe(403);
    expect(starStatus).not.toHaveBeenCalled();
  });
});

describe("POST /api/star", () => {
  it("stars it", async () => {
    starRepo.mockResolvedValue(true);
    const res = await route.POST(req("POST", WRITE));
    expect(await res.json()).toEqual({ ok: true });
  });

  it("needs the board's token", async () => {
    const res = await route.POST(req("POST", READ));
    expect(res.status).toBe(403);
    expect(starRepo).not.toHaveBeenCalled();
  });
});
