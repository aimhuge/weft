import { describe, expect, it, vi } from "vitest";

// /api/game: hands ?cwd= and &full=1 to lib/game-server, adds the GitHub profile and reports its failures.

vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/lib/game-server", () => ({ gameState: vi.fn(() => ({ xp: 5 })) }));
vi.mock("@/lib/github-profile", () => ({
  githubProfile: vi.fn(() => Promise.resolve({ login: "ada" })),
  cachedGithubProfile: vi.fn(() => null),
}));
vi.mock("@/lib/profile-card", () => ({ profileCard: vi.fn(() => ({ className: "Shipper" })) }));
vi.mock("@/lib/explore", () => ({ recordExplore: vi.fn(async () => {}) }));
vi.mock("@/lib/profile-card-sync", () => ({ syncProfileCard: vi.fn(() => Promise.reject(new Error("offline"))) }));

const server = await import("@/lib/game-server");
const sync = await import("@/lib/profile-card-sync");
const cards = await import("@/lib/profile-card");
const explore = await import("@/lib/explore");
const route = await import("./game/route");

const READ = { host: "localhost:3457" };

describe("GET /api/game", () => {
  it("returns the game for the project in view", async () => {
    const res = await route.GET(new Request("http://localhost:3457/api/game?cwd=/dev/app&full=1", { headers: READ }));
    expect(await res.json()).toEqual({ game: { xp: 5, github: { login: "ada" } } });
    expect(server.gameState).toHaveBeenLastCalledWith({ cwd: "/dev/app", full: true });
    const light = await route.GET(new Request("http://localhost:3457/api/game", { headers: READ }));
    expect(await light.json()).toEqual({ game: { xp: 5, github: null } });
    expect(server.gameState).toHaveBeenLastCalledWith({ cwd: null, full: false });
  });

  it("posts the public builder card when the dialog asks, and shrugs off a failed post", async () => {
    vi.mocked(sync.syncProfileCard).mockClear();
    await route.GET(new Request("http://localhost:3457/api/game", { headers: READ }));
    expect(sync.syncProfileCard).not.toHaveBeenCalled();
    const res = await route.GET(new Request("http://localhost:3457/api/game?full=1", { headers: READ }));
    expect(res.status).toBe(200);
    const deps = vi.mocked(sync.syncProfileCard).mock.calls[0]?.[0];
    expect(await deps?.card?.()).toEqual({ className: "Shipper" });
    expect(cards.profileCard).toHaveBeenLastCalledWith({ xp: 5 }, { login: "ada" });
  });

  it("refuses other hosts and reports errors", async () => {
    expect((await route.GET(new Request("http://evil.test/api/game", { headers: { host: "evil.test" } }))).status).toBe(403);
    vi.mocked(server.gameState).mockImplementationOnce(() => {
      throw new Error("boom");
    });
    const res = await route.GET(new Request("http://localhost:3457/api/game", { headers: READ }));
    expect(res.status).toBe(500);
  });
});

describe("POST /api/game", () => {
  const post = (body: string, headers: Record<string, string> = { ...READ, "x-weft-token": "1" }) =>
    route.POST(new Request("http://localhost:3457/api/game", { method: "POST", headers, body }));

  it("logs a feature intro watched to the end", async () => {
    const res = await post(JSON.stringify({ intro: "leagues" }));
    expect(await res.json()).toEqual({ ok: true });
    expect(explore.recordExplore).toHaveBeenLastCalledWith("intro:leagues");
  });

  it("refuses an unknown intro, a bad body and a missing token", async () => {
    vi.mocked(explore.recordExplore).mockClear();
    expect((await post(JSON.stringify({ intro: "nope" }))).status).toBe(400);
    expect((await post("not json")).status).toBe(400);
    expect((await post(JSON.stringify({ intro: "leagues" }), READ)).status).toBe(403);
    expect(explore.recordExplore).not.toHaveBeenCalled();
  });
});
