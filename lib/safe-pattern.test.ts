import { describe, expect, it } from "vitest";
import { MAX_PATTERN, patternProblem, safeTest } from "./safe-pattern";

// A rule's pattern can't hang the server: capped in length, and each test bounded in time.
describe("patternProblem", () => {
  it("takes a pattern that compiles, and says what's wrong with one that doesn't", () => {
    expect(patternProblem("deploy|ship")).toBeNull();
    expect(patternProblem("  ")).toBe("Enter a pattern");
    expect(patternProblem("x".repeat(MAX_PATTERN + 1))).toMatch(/under 300 characters/);
    expect(patternProblem("(")).toBe("“(” isn't a valid pattern");
  });
});

describe("safeTest", () => {
  it("matches as the regex does", () => {
    expect(safeTest(/deploy/i, "please DEPLOY it")).toBe(true);
    expect(safeTest(/deploy/i, "nothing here")).toBe(false);
  });

  it("gives up on a catastrophic pattern instead of hanging, and still works after", () => {
    const started = Date.now();
    expect(safeTest(/^(a+)+$/, `${"a".repeat(40)}!`, 20)).toBe(false);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(safeTest(/b/, "abc")).toBe(true);
  });
});
