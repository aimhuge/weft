import { describe, expect, it } from "vitest";
import { clipNote, GITHUB_LOGIN_RE, isGithubLogin, mentionsIn, NOTE_MAX, ungrantedMentions } from "./share-grant-types";

describe("isGithubLogin", () => {
  it("takes GitHub's own login shape", () => {
    expect(isGithubLogin("octocat")).toBe(true);
    expect(isGithubLogin("a-b-1")).toBe(true);
    expect(isGithubLogin("a".repeat(39))).toBe(true);
    expect(GITHUB_LOGIN_RE.test("x")).toBe(true);
  });

  it("refuses everything else", () => {
    expect(isGithubLogin("a".repeat(40))).toBe(false);
    expect(isGithubLogin("-lead")).toBe(false);
    expect(isGithubLogin("")).toBe(false);
    expect(isGithubLogin("has space")).toBe(false);
    expect(isGithubLogin(42)).toBe(false);
    expect(isGithubLogin(undefined)).toBe(false);
  });
});

describe("mentionsIn", () => {
  it("finds @logins in order, once each, lowercased", () => {
    expect(mentionsIn("@Alice and @bob, then @alice again (@carol)")).toEqual(["alice", "bob", "carol"]);
  });

  it("skips email addresses, code spans and fenced code", () => {
    expect(mentionsIn("mail me@example.com")).toEqual([]);
    expect(mentionsIn("run `@notme` now")).toEqual([]);
    expect(mentionsIn("```\n@fenced\n```\n@real")).toEqual(["real"]);
  });

  it("skips paths and over-long or hyphen-led tokens", () => {
    expect(mentionsIn("see ./@scoped/pkg and a/@b")).toEqual([]);
    expect(mentionsIn(`@${"a".repeat(40)}`)).toEqual([]);
    expect(mentionsIn("@-nope")).toEqual([]);
    expect(mentionsIn("no mentions here")).toEqual([]);
  });
});

describe("ungrantedMentions", () => {
  it("drops people already granted or in the team, case-blind", () => {
    expect(ungrantedMentions("@Alice @bob @carol", ["ALICE"], ["Bob"])).toEqual(["carol"]);
    expect(ungrantedMentions("@dave", [], [])).toEqual(["dave"]);
  });
});

describe("clipNote", () => {
  it("is null for a non-string or blank note", () => {
    expect(clipNote(undefined)).toBeNull();
    expect(clipNote(7)).toBeNull();
    expect(clipNote("   \n\t ")).toBeNull();
  });

  it("flattens whitespace into one paragraph", () => {
    expect(clipNote("  hello\n\n  there  ")).toBe("hello there");
  });

  it("keeps a note of exactly NOTE_MAX and cuts a longer one with an ellipsis", () => {
    const exact = "x".repeat(NOTE_MAX);
    expect(clipNote(exact)).toBe(exact);
    const long = `${"a".repeat(NOTE_MAX - 2)} ${"b".repeat(20)}`;
    const out = clipNote(long) as string;
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(NOTE_MAX);
    expect(out).toBe(`${"a".repeat(NOTE_MAX - 2)}…`);
  });
});
