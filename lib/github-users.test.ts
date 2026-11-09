import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  account: vi.fn(),
  collaborators: vi.fn(),
  repoOf: vi.fn(),
  execFile: vi.fn(),
}));

vi.mock("./github-status", () => ({ githubAccount: h.account }));
vi.mock("./github-collaborators", () => ({ repoCollaborators: h.collaborators }));
vi.mock("./github-issues", () => ({ repoOf: h.repoOf }));
vi.mock("node:child_process", () => ({ execFile: h.execFile }));

import { clearGithubUserSearch, githubUserByLogin, SEARCH_LIMIT, SEARCH_TTL, searchGithubUsers, suggestPeople, type Gh } from "./github-users";

beforeEach(() => {
  clearGithubUserSearch();
  vi.clearAllMocks();
});

const ghReturning = (out: string) => vi.fn<Gh>(() => Promise.resolve(out));

describe("searchGithubUsers", () => {
  it("asks nothing for an empty or impossible query", async () => {
    const gh = ghReturning("");
    expect(await searchGithubUsers("  ", gh)).toEqual([]);
    expect(await searchGithubUsers("@-bad", gh)).toEqual([]);
    expect(await searchGithubUsers("has space", gh)).toEqual([]);
    expect(gh).not.toHaveBeenCalled();
  });

  it("parses gh's lines, drops bad logins, and puts the exact login first", async () => {
    const gh = ghReturning("octocatfan\thttps://a/1\n\t\n-bad\thttps://x\nOctocat\t\n");
    const hits = await searchGithubUsers("@octocat", gh, 1000);
    expect(hits).toEqual([
      { login: "Octocat", name: null, avatarUrl: null, kind: "github" },
      { login: "octocatfan", name: null, avatarUrl: "https://a/1", kind: "github" },
    ]);
    const args = gh.mock.calls[0]![0];
    expect(args).toContain("q=octocat in:login type:user");
    expect(args).toContain(`per_page=${SEARCH_LIMIT}`);
  });

  it("keeps an answer for SEARCH_TTL per lowercased query, then asks again", async () => {
    const gh = ghReturning("ann\t");
    await searchGithubUsers("Ann", gh, 0);
    await searchGithubUsers("ann", gh, SEARCH_TTL - 1);
    expect(gh).toHaveBeenCalledTimes(1);
    await searchGithubUsers("ann", gh, SEARCH_TTL);
    expect(gh).toHaveBeenCalledTimes(2);
  });

  it("answers no one when gh fails, and keeps that too", async () => {
    const gh = vi.fn<Gh>(() => Promise.reject(new Error("rate limited")));
    expect(await searchGithubUsers("zed", gh, 0)).toEqual([]);
    expect(await searchGithubUsers("zed", gh, 1)).toEqual([]);
    expect(gh).toHaveBeenCalledTimes(1);
  });

  it("runs the real gh through execFile by default", async () => {
    h.execFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: (e: unknown, v: unknown) => void) => cb(null, { stdout: "realuser\thttps://av\n" }));
    expect(await searchGithubUsers("realuser")).toEqual([{ login: "realuser", name: null, avatarUrl: "https://av", kind: "github" }]);
    expect(h.execFile.mock.calls[0]![0]).toBe("gh");
    expect(h.execFile.mock.calls[0]![2]).toEqual({ timeout: 10_000, maxBuffer: 1024 * 1024 });
  });
});

describe("githubUserByLogin", () => {
  it("is null for an impossible login without asking", async () => {
    const gh = ghReturning("");
    expect(await githubUserByLogin("not a login", gh)).toBeNull();
    expect(gh).not.toHaveBeenCalled();
  });

  it("returns a user's id and GitHub's spelling", async () => {
    const gh = ghReturning("583231\tOctocat\tUser\n");
    expect(await githubUserByLogin(" @octocat ", gh)).toEqual({ id: 583231, login: "Octocat" });
    expect(gh.mock.calls[0]![0]).toEqual(["api", "users/octocat", "--jq", "[.id, .login, .type] | @tsv"]);
  });

  it("refuses an organization, a bad id or a bad login", async () => {
    expect(await githubUserByLogin("acme", ghReturning("9\tacme\tOrganization"))).toBeNull();
    expect(await githubUserByLogin("acme", ghReturning("x\tacme\tUser"))).toBeNull();
    expect(await githubUserByLogin("acme", ghReturning("0\tacme\tUser"))).toBeNull();
    expect(await githubUserByLogin("acme", ghReturning("1.5\tacme\tUser"))).toBeNull();
    expect(await githubUserByLogin("acme", ghReturning("7\t-acme\tUser"))).toBeNull();
    expect(await githubUserByLogin("acme", ghReturning(""))).toBeNull();
  });

  it("is null when gh fails", async () => {
    const gh = vi.fn<Gh>(() => Promise.reject(new Error("404")));
    expect(await githubUserByLogin("ghost", gh)).toBeNull();
  });
});

describe("suggestPeople", () => {
  it("offers the repo's collaborators, minus you and bad logins", async () => {
    h.account.mockResolvedValue({ account: { login: "Me", url: "" }, error: null });
    const collab = vi.fn(() => Promise.resolve([
      { login: "me", avatarUrl: "a" },
      { login: "ann", avatarUrl: "https://ann" },
      { login: "bob", avatarUrl: "" },
      { login: "-bad", avatarUrl: "" },
    ]));
    expect(await suggestPeople("/repo", collab, 0)).toEqual([
      { login: "ann", name: null, avatarUrl: "https://ann", kind: "repo" },
      { login: "bob", name: null, avatarUrl: null, kind: "repo" },
    ]);
    expect(collab).toHaveBeenCalledWith("/repo");
  });

  it("keeps everyone when you aren't signed in", async () => {
    h.account.mockResolvedValue({ account: null, error: "signed out" });
    const collab = vi.fn(() => Promise.resolve([{ login: "me", avatarUrl: "" }]));
    expect(await suggestPeople("/r2", collab, 0)).toHaveLength(1);
  });

  it("keeps an answer for SEARCH_TTL per folder", async () => {
    h.account.mockResolvedValue({ account: null, error: null });
    const collab = vi.fn(() => Promise.resolve([{ login: "ann", avatarUrl: "" }]));
    await suggestPeople("/r3", collab, 0);
    await suggestPeople("/r3", collab, SEARCH_TTL - 1);
    expect(collab).toHaveBeenCalledTimes(1);
    await suggestPeople("/r3", collab, SEARCH_TTL);
    expect(collab).toHaveBeenCalledTimes(2);
  });

  it("suggests no one when the repo can't be read", async () => {
    h.account.mockResolvedValue({ account: null, error: null });
    const collab = vi.fn(() => Promise.reject(new Error("no repo")));
    expect(await suggestPeople("/r4", collab, 0)).toEqual([]);
  });

  it("asks the card's repo for its collaborators by default", async () => {
    h.account.mockResolvedValue({ account: null, error: null });
    h.repoOf.mockResolvedValue("aimhuge/weft");
    h.collaborators.mockResolvedValue([{ login: "zoe", avatarUrl: "https://z" }]);
    expect(await suggestPeople("/r5")).toEqual([{ login: "zoe", name: null, avatarUrl: "https://z", kind: "repo" }]);
    expect(h.repoOf).toHaveBeenCalledWith("/r5");
    expect(h.collaborators).toHaveBeenCalledWith("aimhuge/weft");
  });
});
