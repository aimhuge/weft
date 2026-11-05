import { describe, expect, it } from "vitest";
import { isDangerous, REVIEW_VERDICT_LABEL, SCAN_VERDICT_LABEL, SCAN_VERDICT_RANK } from "./skill-verdict";
import type { SkillReview, SkillReviewState, SkillScan } from "./types";

// What a skill's scan and its AI review mean (lib/skill-verdict.ts): the labels every renderer shows, and the
// one rule that says a skill needs an explicit confirm before it installs.

const scan = (verdict: SkillScan["verdict"]): SkillScan => ({
  verdict,
  findings: [],
  license: { spdx: null, kind: "none" },
  hosts: [],
  files: 1,
  bytes: 10,
});

const review = (verdict: SkillReview["verdict"]): SkillReviewState => ({
  status: "done",
  page: "/tmp/r.html",
  review: { verdict, summary: "", whatItDoes: "", concerns: [], falsePositives: [], dataFlow: "", license: "", recommendation: "", model: "", reviewedAt: "" },
});

describe("the verdicts' labels", () => {
  it("read the same wherever they are shown", () => {
    expect(SCAN_VERDICT_LABEL).toEqual({ danger: "Danger", warn: "Worth a look", clean: "Clean" });
    expect(REVIEW_VERDICT_LABEL).toEqual({ unsafe: "Unsafe", caution: "Use with care", safe: "Looks safe" });
  });

  it("rank the static scan's severities, most serious first", () => {
    expect(SCAN_VERDICT_RANK.danger).toBeLessThan(SCAN_VERDICT_RANK.warn);
    expect(SCAN_VERDICT_RANK.warn).toBeLessThan(SCAN_VERDICT_RANK.info);
  });
});

describe("isDangerous", () => {
  it("is a danger verdict, on its own", () => {
    expect(isDangerous(scan("danger"))).toBe(true);
  });

  it("is a finished review that says unsafe", () => {
    expect(isDangerous(scan("clean"), review("unsafe"))).toBe(true);
  });

  it("is nothing else", () => {
    expect(isDangerous(scan("warn"))).toBe(false);
    expect(isDangerous(scan("clean"))).toBe(false);
    expect(isDangerous(scan("clean"), review("safe"))).toBe(false);
    expect(isDangerous(scan("clean"), review("caution"))).toBe(false);
  });

  it("ignores a review that hasn't finished", () => {
    expect(isDangerous(scan("clean"), { status: "none" })).toBe(false);
    expect(isDangerous(scan("clean"), { status: "running", page: "/tmp/r.html" })).toBe(false);
    expect(isDangerous(scan("clean"), { status: "failed", page: "/tmp/r.html", error: "busy" })).toBe(false);
  });
});
