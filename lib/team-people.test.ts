import { describe, expect, it } from "vitest";
import { looksLikeEmail, PEOPLE_SHOWN, suggestPeople, visiblePeople } from "./team-people";

const p = (login: string, email: string | null) => ({ login, avatarUrl: "", email, repos: ["a/b"] });

describe("suggestPeople", () => {
  it("drops members and pending invites by email, ignoring case", () => {
    const out = suggestPeople(
      [p("ada", "Ada@X.co"), p("bob", "bob@x.co"), p("cy", "cy@x.co"), p("dee", null)],
      [{ email: "ada@x.co" }, { email: null }],
      [{ email: " BOB@x.co " }],
    );
    expect(out.map((x) => x.login)).toEqual(["cy", "dee"]);
  });

  it("drops members by GitHub login too, even when GitHub hides their email", () => {
    const out = suggestPeople([p("Zulker-Nien", null), p("eve", null)], [{ email: "z@x.co", login: "zulker-nien" }, { email: null, login: null }], []);
    expect(out.map((x) => x.login)).toEqual(["eve"]);
  });
});

describe("visiblePeople", () => {
  const many = Array.from({ length: PEOPLE_SHOWN + 3 }, (_, i) => i);
  it("caps at the limit and counts the rest", () => {
    expect(visiblePeople(many, false)).toEqual({ shown: many.slice(0, PEOPLE_SHOWN), hidden: 3 });
  });
  it("shows all when asked or short", () => {
    expect(visiblePeople(many, true).hidden).toBe(0);
    expect(visiblePeople([1], false)).toEqual({ shown: [1], hidden: 0 });
  });
});

describe("looksLikeEmail", () => {
  it("checks the shape", () => {
    expect(looksLikeEmail(" a@b.co ")).toBe(true);
    expect(looksLikeEmail("a@b")).toBe(false);
  });
});
