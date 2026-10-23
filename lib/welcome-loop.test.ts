import { describe, expect, it } from "vitest";
import { LOOP_PATH, loopSrc } from "./welcome-loop";

describe("loopSrc", () => {
  it("plays live with no names when there are no projects", () => {
    expect(loopSrc([])).toBe(`${LOOP_PATH}?live=1`);
  });

  it("puts the first three project names on the cards", () => {
    const url = new URL(loopSrc(["weft", "deckcp", "site", "extra"]), "http://x");
    expect(url.searchParams.get("live")).toBe("1");
    expect(url.searchParams.get("p")).toBe("weft,deckcp,site");
  });

  it("drops blanks and keeps a comma in a name from splitting it", () => {
    const url = new URL(loopSrc(["  ", "a,b", "c"]), "http://x");
    expect(url.searchParams.get("p")).toBe("a b,c");
  });
});
