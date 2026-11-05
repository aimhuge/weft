import type { ScanSeverity, SkillReview, SkillReviewState, SkillScan } from "./types";

// What a skill's scan and its AI review mean, in one place: the labels the drawer, the badge and the review
// page read, and the rule that says a skill needs an explicit confirm before it installs (lib/skill-install.ts,
// components/SkillSearchResults.tsx).

// How serious a finding is, most serious first: the scan sorts its findings by this.
export const SCAN_VERDICT_RANK: Record<ScanSeverity, number> = { danger: 0, warn: 1, info: 2 };

// What the static scan's verdict reads as, everywhere it is shown.
export const SCAN_VERDICT_LABEL: Record<SkillScan["verdict"], string> = {
  danger: "Danger",
  warn: "Worth a look",
  clean: "Clean",
};

// What the AI review's verdict reads as, everywhere it is shown.
export const REVIEW_VERDICT_LABEL: Record<SkillReview["verdict"], string> = {
  unsafe: "Unsafe",
  caution: "Use with care",
  safe: "Looks safe",
};

// A danger verdict, or a finished AI review that says unsafe, needs an explicit confirm: the drawer asks before
// it installs, and the server refuses without `force`. One rule, so the button never offers what the server denies.
export function isDangerous(scan: SkillScan, review?: SkillReviewState): boolean {
  if (scan.verdict === "danger") return true;
  return review?.status === "done" && review.review.verdict === "unsafe";
}
