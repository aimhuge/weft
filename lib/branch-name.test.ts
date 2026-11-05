import { describe, expect, it } from "vitest";
import { validBranch } from "./branch-name";

describe("validBranch", () => {
  it("takes plain and slashed names", () => {
    for (const ok of ["main", "feat/login", "fix-42", "release/1.2.x", "a_b.c"]) expect(validBranch(ok)).toBe(true);
  });

  it("refuses what git refuses", () => {
    for (const bad of ["", "-x", "a..b", "a//b", "/a", "a/", ".a", "a/.b", "a.lock", "a.", "HEAD", "a b", "a~1", "a^", "a:b", "a@{1}", "x".repeat(101)]) {
      expect(validBranch(bad)).toBe(false);
    }
  });
});
