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

const { githubCollaborators, githubEmail, clearGithubEmails } = await import("./github-collaborators");

beforeEach(() => {
  calls.length = 0;
  clearGithubEmails();
  responder = (args) => {
    const path = args[1];
    if (path === "user") return "me\n";
    if (path === "repos/a/one/collaborators") return "me\thttp://me\nBob\thttp://bob\nada\thttp://ada\n";
    if (path === "repos/a/two/collaborators") return "ada\thttp://ada\n";
    if (path === "users/ada") return "ada@x.co\n";
    if (path === "orgs/acme/members") return "ME\thttp://me\nada\thttp://ada2\ncy\thttp://cy\n";
    return "null\n";
  };
});

describe("githubCollaborators", () => {
  it("merges repos per person, skips the signed-in user, looks up emails", async () => {
    const r = await githubCollaborators(["a/one", "a/two", "bad repo; rm"]);
    expect(r.error).toBeNull();
    expect(r.people).toEqual([
      { login: "ada", avatarUrl: "http://ada", email: "ada@x.co", repos: ["a/one", "a/two"] },
      { login: "Bob", avatarUrl: "http://bob", email: null, repos: ["a/one"] },
    ]);
    expect(calls.some((c) => c.join(" ").includes("rm"))).toBe(false);
  });

  it("caches emails", async () => {
    await githubCollaborators(["a/one"], 1000);
    const before = calls.filter((c) => c[1] === "users/ada").length;
    await githubCollaborators(["a/one"], 2000);
    expect(calls.filter((c) => c[1] === "users/ada").length).toBe(before);
  });

  it("returns nothing for no valid repos", async () => {
    expect(await githubCollaborators(["nope"])).toEqual({ people: [], error: null });
    expect(calls).toHaveLength(0);
  });

  it("reports signed-out gh", async () => {
    responder = () => Object.assign(new Error("x"), { code: "ENOENT" });
    const r = await githubCollaborators(["a/one"]);
    expect(r.people).toEqual([]);
    expect(r.error).toMatch(/isn't installed/);
  });

  it("errors only when every repo fails, and tolerates an email failure", async () => {
    responder = (args) => (args[1] === "user" ? "me" : new Error("HTTP 403 forbidden"));
    const r = await githubCollaborators(["a/one"]);
    expect(r.error).toMatch(/a\/one: .*403/);
    responder = (args) => {
      if (args[1] === "user") return "me";
      if (args[1] === "repos/a/one/collaborators") return "ada\thttp://ada\n";
      return new Error("boom");
    };
    clearGithubEmails();
    const ok = await githubCollaborators(["a/one", "a/zzz"]);
    expect(ok.error).toBeNull();
    expect(ok.people[0]?.email).toBeNull();
  });
});

describe("githubCollaborators with an org", () => {
  it("adds org members with no repos, skipping you and people already found", async () => {
    const r = await githubCollaborators(["a/one"], Date.now(), "acme");
    expect(r.error).toBeNull();
    expect(r.people).toEqual([
      { login: "ada", avatarUrl: "http://ada", email: "ada@x.co", repos: ["a/one"] },
      { login: "Bob", avatarUrl: "http://bob", email: null, repos: ["a/one"] },
      { login: "cy", avatarUrl: "http://cy", email: null, repos: [] },
    ]);
  });

  it("works with no repos when an org is given", async () => {
    const r = await githubCollaborators([], Date.now(), "acme");
    expect(r).toEqual({
      people: [
        { login: "ada", avatarUrl: "http://ada2", email: "ada@x.co", repos: [] },
        { login: "cy", avatarUrl: "http://cy", email: null, repos: [] },
      ],
      error: null,
    });
  });

  it("tolerates an org failure", async () => {
    const base = responder;
    responder = (args) => (args[1] === "orgs/acme/members" ? new Error("HTTP 403") : base(args));
    const r = await githubCollaborators(["a/two"], Date.now(), "acme");
    expect(r.error).toBeNull();
    expect(r.people.map((p) => p.login)).toEqual(["ada"]);
  });
});

describe("githubEmail", () => {
  it("looks up a typed @login's public email", async () => {
    expect(await githubEmail(" @ada ")).toBe("ada@x.co");
    expect(calls.at(-1)?.[1]).toBe("users/ada");
  });

  it("is null for a hidden email or a login that isn't one", async () => {
    expect(await githubEmail("bob")).toBeNull();
    calls.length = 0;
    expect(await githubEmail("not a login")).toBeNull();
    expect(calls).toHaveLength(0);
  });
});
