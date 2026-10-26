"use client";

import { REVIEW_VERDICT_LABEL, SCAN_VERDICT_LABEL } from "@/lib/skill-verdict";
import type { SkillReviewState, SkillScan } from "@/lib/types";

// The scan's verdicts as small pills (lib/skill-scan.ts, lib/skill-review.ts), and the findings worth reading.
// The words come from lib/skill-verdict.ts, so the pill here and the page in the pane call a verdict the same.

const STATIC_TONE = { danger: "text-red-500 border-red-500/50", warn: "text-amber-500 border-amber-500/50", clean: "text-emerald-500 border-emerald-500/50" } as const;
const AI_TONE = { unsafe: "text-red-500 border-red-500/50", caution: "text-amber-500 border-amber-500/50", safe: "text-emerald-500 border-emerald-500/50" } as const;
const pillClass = "rounded-full border px-1.5 text-[10px] font-semibold leading-[16px]";

export function ScanPills({ scan, review }: { scan: SkillScan; review: SkillReviewState }) {
  return (
    <span className="flex flex-wrap items-center gap-1">
      <span className={`${pillClass} ${STATIC_TONE[scan.verdict]}`} title="Weft's static scan">{SCAN_VERDICT_LABEL[scan.verdict]}</span>
      {review.status === "done" && <span className={`${pillClass} ${AI_TONE[review.review.verdict]}`}>AI: {REVIEW_VERDICT_LABEL[review.review.verdict]}</span>}
      {review.status === "running" && <span className={`${pillClass} border-line text-muted`}>AI reading…</span>}
      <span className={`${pillClass} border-line text-muted`} title={scan.license.file ? `From ${scan.license.file}` : undefined}>
        {scan.license.spdx ?? (scan.license.kind === "none" ? "No license" : "License?")}
      </span>
    </span>
  );
}

// The findings that aren't just notes, most serious first.
export function topFindings(scan: SkillScan, n = 3) {
  return scan.findings.filter((f) => f.severity !== "info" && f.category !== "license").slice(0, n);
}

// ⚠ beside a skill you have when its scan found more than a license note; it opens the skill's review.
export function ScanBadge({ scan, onOpen }: { scan: SkillScan | undefined; onOpen: () => void }) {
  if (!scan) return null;
  const top = topFindings(scan, 4);
  if (!top.length) return null;
  const danger = scan.verdict === "danger";
  const title = `${SCAN_VERDICT_LABEL[danger ? "danger" : "warn"]}: ${top.map((f) => f.message).join("; ")}. Click for an AI review in the pane.`;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onOpen();
      }}
      title={title}
      aria-label={title}
      className={`shrink-0 rounded px-0.5 text-[11px] leading-none hover:bg-sunken ${danger ? "text-red-500" : "text-amber-500"}`}
    >
      ⚠
    </button>
  );
}
