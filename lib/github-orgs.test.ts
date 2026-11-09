import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[][] = [];
let responder: (args: string[]) => string | Error;
vi.mock("node:child_process", () => ({
  execFile: (_cmd: string, args: string[], _opts: unknown, cb: (e: Error | null, r?: { stdout: string; stderr: string }) => void) => {
    calls.push(args);
    const out = responder(args);
    if (out instanceof Error) cb(out);
    else cb(null, { stdout: out, stderr: "" });
  },
}));

const { ORG_PATTERN, githubOrgMembers, githubOrgRepos, githubOrgs } = await import("./github-orgs");

beforeEach(() => {
  calls.length = 0;
  responder = (args) => {
    const path = args[1];
    if (path === "user/orgs") return "zeta\thttp://z\nAcme\thttp://a\n\nbeta\n";
    if (path === "orgs/acme/repos") return "acme/Zed\n acme/alpha \n\nacme/beta\n";
    if (path === "orgs/acme/members") return "ada\thttp://ada\nbob\n\n";
    return "";
  };
});

describe("ORG_PATTERN", () => {
  it("accepts GitHub logins and refuses anything else", () => {
    expect(ORG_PATTERN.test("acme-co")).toBe(true);
    expect(ORG_PATTERN.test("a")).toBe(true);
    expect(ORG_PATTERN.test("-acme")).toBe(false);
    expect(ORG_PATTERN.test("acme/x")).toBe(false);
    expect(ORG_PATTERN.test("a".repeat(40))).toBe(false);
    expect(ORG_PATTERN.test("")).toBe(false);
  });
});

describe("githubOrgs", () => {
  it("lists your orgs sorted case-insensitively, a missing avatar as empty", async () => {
    expect(await githubOrgs()).toEqual({
      orgs: [
        { login: "Acme", avatarUrl: "http://a" },
        { login: "beta", avatarUrl: "" },
        { login: "zeta", avatarUrl: "http://z" },
      ],
      error: null,
    });
    expect(calls[0]?.slice(0, 3)).toEqual(["api", "user/orgs", "--paginate"]);
  });

  it("answers a gh failure as no orgs and an error", async () => {
    responder = () => Object.assign(new Error("x"), { code: "ENOENT" });
    const r = await githubOrgs();
    expect(r.orgs).toEqual([]);
    expect(r.error).toMatch(/isn't installed/);
  });
});

describe("githubOrgRepos", () => {
  it("lists an org's repos trimmed and sorted", async () => {
    expect(await githubOrgRepos("acme")).toEqual(["acme/alpha", "acme/beta", "acme/Zed"]);
    expect(calls[0]?.[1]).toBe("orgs/acme/repos");
  });

  it("asks nothing for a login that isn't an org name", async () => {
    expect(await githubOrgRepos("acme; rm -rf")).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("throws a gh failure to its caller", async () => {
    responder = () => new Error("HTTP 404");
    await expect(githubOrgRepos("acme")).rejects.toThrow("404");
  });
});

describe("githubOrgMembers", () => {
  it("lists an org's members with avatars", async () => {
    expect(await githubOrgMembers("acme")).toEqual([
      { login: "ada", avatarUrl: "http://ada" },
      { login: "bob", avatarUrl: "" },
    ]);
  });

  it("asks nothing for a bad org login", async () => {
    expect(await githubOrgMembers("../x")).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});
