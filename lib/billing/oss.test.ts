import { describe, expect, it, vi } from "vitest";
import {
  activeOpenSource,
  maintainedRepos,
  maintains,
  openSourceRepo,
  OSS_BAR,
  OSI_LICENCES,
  recentCommits,
  type GithubRepo,
  type OssBar,
} from "./oss";

// lib/billing/oss.ts: open-source eligibility from GitHub's REST API.

function repo(over: Partial<GithubRepo> = {}): GithubRepo {
  return {
    full_name: "octocat/hello",
    private: false,
    fork: false,
    archived: false,
    stargazers_count: 0,
    pushed_at: "2026-10-01T00:00:00Z",
    license: { spdx_id: "MIT" },
    owner: { login: "octocat" },
    ...over,
  };
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe("OSS_BAR and OSI_LICENCES", () => {
  it("sets the default bar at 90 days, 25 stars or 20 recent commits", () => {
    expect(OSS_BAR).toEqual({ activeDays: 90, minStars: 25, minRecentCommits: 20 });
  });

  it("holds the OSI-approved spdx ids, and not NOASSERTION", () => {
    expect(OSI_LICENCES.has("MIT")).toBe(true);
    expect(OSI_LICENCES.has("Apache-2.0")).toBe(true);
    expect(OSI_LICENCES.has("NOASSERTION")).toBe(false);
  });
});

describe("maintains", () => {
  it("matches the owner case-insensitively", () => {
    expect(maintains(repo({ owner: { login: "OctoCat" } }), "octocat")).toBe(true);
    expect(maintains(repo({ owner: { login: "octocat" } }), "OCTOCAT")).toBe(true);
  });

  it("counts a repo the user can admin, maintain or push to", () => {
    expect(maintains(repo({ owner: { login: "other" }, permissions: { admin: true } }), "octocat")).toBe(true);
    expect(maintains(repo({ owner: { login: "other" }, permissions: { maintain: true } }), "octocat")).toBe(true);
    expect(maintains(repo({ owner: { login: "other" }, permissions: { push: true } }), "octocat")).toBe(true);
  });

  it("counts a repo with no permissions as not maintained", () => {
    expect(maintains(repo({ owner: { login: "other" } }), "octocat")).toBe(false);
    expect(maintains(repo({ owner: { login: "other" }, permissions: {} }), "octocat")).toBe(false);
    expect(
      maintains(repo({ owner: { login: "other" }, permissions: { admin: false, maintain: false, push: false } }), "octocat"),
    ).toBe(false);
  });

  it("does not count another user's repo the user has no permission on", () => {
    expect(maintains(repo({ owner: { login: "other" }, permissions: { pull: true } as never }), "octocat")).toBe(false);
  });
});

describe("activeOpenSource", () => {
  const now = new Date("2026-10-24T00:00:00Z");

  it("rejects a private, forked or archived repo", () => {
    expect(activeOpenSource(repo({ private: true }), now)).toBe(false);
    expect(activeOpenSource(repo({ fork: true }), now)).toBe(false);
    expect(activeOpenSource(repo({ archived: true }), now)).toBe(false);
  });

  it("rejects a repo with no licence, a non-OSI one, or NOASSERTION", () => {
    expect(activeOpenSource(repo({ license: null }), now)).toBe(false);
    expect(activeOpenSource(repo({ license: { spdx_id: null } }), now)).toBe(false);
    expect(activeOpenSource(repo({ license: { spdx_id: "NOASSERTION" } }), now)).toBe(false);
    expect(activeOpenSource(repo({ license: { spdx_id: "Proprietary" } }), now)).toBe(false);
  });

  it("rejects a stale push and a null pushed_at", () => {
    expect(activeOpenSource(repo({ pushed_at: "2026-01-01T00:00:00Z" }), now)).toBe(false);
    expect(activeOpenSource(repo({ pushed_at: null }), now)).toBe(false);
  });

  it("accepts a public, non-fork, OSI-licensed repo pushed to inside the bar", () => {
    expect(activeOpenSource(repo(), now)).toBe(true);
  });

  it("honours a custom bar's active days", () => {
    const bar: OssBar = { activeDays: 1, minStars: 0, minRecentCommits: 0 };
    expect(activeOpenSource(repo({ pushed_at: "2026-10-23T12:00:00Z" }), now, bar)).toBe(true);
    expect(activeOpenSource(repo({ pushed_at: "2026-10-20T00:00:00Z" }), now, bar)).toBe(false);
    expect(activeOpenSource(repo({ pushed_at: "2026-10-01T00:00:00Z" }), now, bar)).toBe(false);
  });
});

describe("maintainedRepos", () => {
  it("reads the authenticated user's repos with the token when there is one", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(jsonResponse([repo()])));
    const repos = await maintainedRepos("octocat", { token: "tok", fetchImpl: fetchImpl });

    expect(repos).toHaveLength(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      "https://api.github.com/user/repos?visibility=public&affiliation=owner,collaborator,organization_member&sort=pushed&per_page=100",
    );
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok");
    expect((init.headers as Record<string, string>).accept).toBe("application/vnd.github+json");
    expect((init.headers as Record<string, string>)["user-agent"]).toBe("weft.zip");
  });

  it("reads the public list without a token, with no authorization header", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(jsonResponse([repo({ owner: { login: "octo cat" } })])));
    const repos = await maintainedRepos("octo cat", { fetchImpl: fetchImpl });

    expect(repos).toHaveLength(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.github.com/users/octo%20cat/repos?type=owner&sort=pushed&per_page=100");
    expect((init.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it("filters out repos the user does not maintain", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse([
        repo({ full_name: "a/a" }),
        repo({ full_name: "b/b", owner: { login: "other" } }),
        repo({ full_name: "c/c", owner: { login: "other" }, permissions: { push: true } }),
      ])),
    );
    const repos = await maintainedRepos("octocat", { fetchImpl: fetchImpl });

    expect(repos.map((r) => r.full_name)).toEqual(["a/a", "c/c"]);
  });

  it("throws when GitHub answers with an error", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(jsonResponse({ message: "Bad credentials" }, false, 401)));
    await expect(maintainedRepos("octocat", { token: "bad", fetchImpl: fetchImpl })).rejects.toThrow(
      "GitHub 401 on /user/repos",
    );
  });
});

describe("recentCommits", () => {
  it("counts the commits GitHub returns", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(jsonResponse([{ sha: "a" }, { sha: "b" }])));
    const count = await recentCommits(repo(), new Date("2026-07-01T00:00:00Z"), 50, { fetchImpl: fetchImpl });

    expect(count).toBe(2);
    const [url] = fetchImpl.mock.calls[0] as unknown as [string];
    expect(url).toBe("https://api.github.com/repos/octocat/hello/commits?since=2026-07-01T00:00:00.000Z&per_page=50");
  });

  it("throws when GitHub answers with an error", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(jsonResponse(null, false, 403)));
    await expect(
      recentCommits(repo(), new Date("2026-07-01T00:00:00Z"), 50, { fetchImpl: fetchImpl }),
    ).rejects.toThrow("GitHub 403 on /repos/octocat/hello/commits");
  });
});

describe("openSourceRepo", () => {
  const now = new Date("2026-10-24T00:00:00Z");

  it("returns the starred repo without counting commits", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(jsonResponse([repo({ stargazers_count: 25 })])));
    const found = await openSourceRepo("octocat", { now, fetchImpl: fetchImpl });

    expect(found?.full_name).toBe("octocat/hello");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("returns the repo whose recent commits clear the bar when none is starred", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([repo({ stargazers_count: 0 })]))
      .mockResolvedValueOnce(jsonResponse(Array.from({ length: 20 }, () => ({ sha: "x" }))));
    const found = await openSourceRepo("octocat", { now, fetchImpl: fetchImpl as never });

    expect(found?.full_name).toBe("octocat/hello");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("returns null when no repo clears the bar", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([repo({ stargazers_count: 0 })]))
      .mockResolvedValueOnce(jsonResponse([{ sha: "x" }]));
    const found = await openSourceRepo("octocat", { now, fetchImpl: fetchImpl as never });

    expect(found).toBeNull();
  });

  it("checks at most five repos for their commit count", async () => {
    const candidates = Array.from({ length: 8 }, (_, i) => repo({ full_name: `o/r${i}`, stargazers_count: 0 }));
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(candidates))
      .mockResolvedValue(jsonResponse([{ sha: "x" }]));
    const found = await openSourceRepo("octocat", { now, fetchImpl: fetchImpl as never });

    expect(found).toBeNull();
    // one repo-list request, then five commit requests
    expect(fetchImpl).toHaveBeenCalledTimes(6);
  });

  it("defaults to now, the default bar and the global fetch when the deps leave them out", async () => {
    const fetchStub = vi.fn(() => Promise.resolve(jsonResponse([repo({ stargazers_count: 25 })])));
    vi.stubGlobal("fetch", fetchStub);

    try {
      const found = await openSourceRepo("octocat");
      expect(found?.full_name).toBe("octocat/hello");
      expect(fetchStub).toHaveBeenCalledTimes(1);
      const [url, init] = fetchStub.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe(
        "https://api.github.com/users/octocat/repos?type=owner&sort=pushed&per_page=100",
      );
      expect((init.headers as Record<string, string>).authorization).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("defaults the commit count's fetch to the global one too", async () => {
    const fetchStub = vi.fn(() => Promise.resolve(jsonResponse([])));
    vi.stubGlobal("fetch", fetchStub);

    try {
      const count = await recentCommits(repo(), new Date("2026-07-01T00:00:00Z"), 50);
      expect(count).toBe(0);
      expect(fetchStub).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
