import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/lib/github-orgs", () => ({
  githubOrgs: vi.fn(() => Promise.resolve({ orgs: [{ login: "acme", avatarUrl: "" }], error: null })),
  githubOrgRepos: vi.fn(() => Promise.resolve(["acme/a"])),
}));

const lib = await import("@/lib/github-orgs");
const route = await import("./github/orgs/route");

const BASE = "http://localhost:3457/api/github/orgs";
const TOKEN = { host: "localhost:3457", "x-weft-token": "1" };

beforeEach(() => vi.clearAllMocks());

describe("GET /api/github/orgs", () => {
  it("lists your orgs", async () => {
    const res = await route.GET(new Request(BASE, { headers: TOKEN }));
    expect(await res.json()).toEqual({ orgs: [{ login: "acme", avatarUrl: "" }], error: null });
    expect(lib.githubOrgRepos).not.toHaveBeenCalled();
  });

  it("lists one org's repos for ?org=", async () => {
    const res = await route.GET(new Request(`${BASE}?org=acme`, { headers: TOKEN }));
    expect(await res.json()).toEqual({ repos: ["acme/a"] });
    expect(lib.githubOrgRepos).toHaveBeenCalledWith("acme");
    expect(lib.githubOrgs).not.toHaveBeenCalled();
  });

  it("refuses a foreign host", async () => {
    const res = await route.GET(new Request(BASE, { headers: { host: "evil.example" } }));
    expect(res.status).toBe(403);
  });

  it("answers an error as a failure", async () => {
    vi.mocked(lib.githubOrgRepos).mockRejectedValueOnce(new Error("boom"));
    const res = await route.GET(new Request(`${BASE}?org=acme`, { headers: TOKEN }));
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
