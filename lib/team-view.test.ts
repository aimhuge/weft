// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cardsPerRepo, memberLabel, orgForTeam, readSavedOrg, saveOrg, stillListed, TEAM_ORG_KEY, unlinkedRepos } from "./team-view";

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("saved workspace", () => {
  it("round-trips and clears", () => {
    expect(readSavedOrg()).toBeUndefined();
    saveOrg("acme");
    expect(window.localStorage.getItem(TEAM_ORG_KEY)).toBe("acme");
    expect(readSavedOrg()).toBe("acme");
    saveOrg(undefined);
    expect(readSavedOrg()).toBeUndefined();
  });

  it("survives storage that throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(readSavedOrg()).toBeUndefined();
    expect(() => saveOrg("acme")).not.toThrow();
  });
});

describe("stillListed", () => {
  const orgs = [{ id: "1", slug: "acme", name: "Acme" }];
  it("accepts no pick or a listed slug, refuses a gone one", () => {
    expect(stillListed(undefined, orgs)).toBe(true);
    expect(stillListed("acme", orgs)).toBe(true);
    expect(stillListed("gone", orgs)).toBe(false);
  });
});

describe("unlinkedRepos", () => {
  it("drops linked repos (any case) and duplicates, sorted", () => {
    expect(unlinkedRepos(["b/b", "a/a", "a/a", "C/c"], ["B/B"])).toEqual(["C/c", "a/a"]);
  });
});

describe("cardsPerRepo", () => {
  it("counts live cards in each repo's folder or below, the deepest folder winning", () => {
    const folders = [
      { folder: "/a", repo: "o/a" },
      { folder: "/a/nested", repo: "o/n" },
      { folder: "/b", repo: null },
    ];
    const cards = [
      { cwd: "/a" },
      { cwd: "/a/src" },
      { cwd: "/a/nested/x" },
      { cwd: "/ab" },
      { cwd: "/b" },
      { cwd: "/a", archived: true },
    ];
    expect(cardsPerRepo(cards, folders)).toEqual({ "o/a": 2, "o/n": 1 });
  });
});

describe("memberLabel", () => {
  it("names a member by @login, then name, then email", () => {
    expect(memberLabel({ login: "ada", name: "Ada", email: "a@x" })).toBe("@ada");
    expect(memberLabel({ login: null, name: " Ada ", email: "a@x" })).toBe("Ada");
    expect(memberLabel({ name: "  ", email: " a@x " })).toBe("a@x");
    expect(memberLabel({ name: null, email: null })).toBe("Unnamed member");
  });
});

describe("orgForTeam", () => {
  it("finds your own org whose login is the slug, any case", () => {
    const orgs = [{ login: "Acme", avatarUrl: "" }];
    expect(orgForTeam("acme", orgs)).toEqual(orgs[0]);
    expect(orgForTeam("other", orgs)).toBeNull();
  });
});
