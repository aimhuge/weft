import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/lib/github-collaborators", () => ({
  githubCollaborators: vi.fn(() => Promise.resolve({ people: [], error: null })),
  githubEmail: vi.fn(() => Promise.resolve("ada@x.co")),
}));

const lib = await import("@/lib/github-collaborators");
const route = await import("./github/collaborators/route");

const URL = "http://localhost:3457/api/github/collaborators?repos=a/b,%20c/d,";
const TOKEN = { host: "localhost:3457", "x-weft-token": "1" };

beforeEach(() => vi.clearAllMocks());

describe("GET /api/github/collaborators", () => {
  it("passes the repos list through", async () => {
    const res = await route.GET(new Request(URL, { headers: TOKEN }));
    expect(await res.json()).toEqual({ people: [], error: null });
    expect(lib.githubCollaborators).toHaveBeenCalledWith(["a/b", "c/d"]);
  });

  it("refuses a foreign host", async () => {
    const res = await route.GET(new Request(URL, { headers: { host: "evil.example" } }));
    expect(res.status).toBe(403);
  });

  it("answers an error as a failure", async () => {
    vi.mocked(lib.githubCollaborators).mockRejectedValueOnce(new Error("boom"));
    const res = await route.GET(new Request(URL, { headers: TOKEN }));
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("treats a missing repos param as none", async () => {
    await route.GET(new Request("http://localhost:3457/api/github/collaborators", { headers: TOKEN }));
    expect(lib.githubCollaborators).toHaveBeenCalledWith([]);
  });

  it("adds the org's members for ?org=", async () => {
    await route.GET(new Request("http://localhost:3457/api/github/collaborators?repos=a/b&org=acme", { headers: TOKEN }));
    expect(lib.githubCollaborators).toHaveBeenCalledWith(["a/b"], expect.any(Number), "acme");
  });

  it("answers one login's public email for ?login=", async () => {
    const res = await route.GET(new Request("http://localhost:3457/api/github/collaborators?login=ada&repos=a/b", { headers: TOKEN }));
    expect(await res.json()).toEqual({ email: "ada@x.co" });
    expect(lib.githubEmail).toHaveBeenCalledWith("ada");
    expect(lib.githubCollaborators).not.toHaveBeenCalled();
  });
});
