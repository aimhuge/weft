"use client";

import type { SkillReviewState, SkillScan } from "@/lib/types";

// The scan's verdicts as small pills (lib/skill-scan.ts, lib/skill-review.ts), and the findings worth reading.

const STATIC = { danger: ["Danger", "text-red-500 border-red-500/50"], warn: ["Check", "text-amber-500 border-amber-500/50"], clean: ["Clean", "text-emerald-500 border-emerald-500/50"] } as const;
const AI = { unsafe: ["AI: unsafe", "text-red-500 border-red-500/50"], caution: ["AI: care", "text-amber-500 border-amber-500/50"], safe: ["AI: safe", "text-emerald-500 border-emerald-500/50"] } as const;
const pillClass = "rounded-full border px-1.5 text-[10px] font-semibold leading-[16px]";

export function ScanPills({ scan, review }: { scan: SkillScan; review: SkillReviewState }) {
  const [label, tone] = STATIC[scan.verdict];
  return (
    <span className="flex flex-wrap items-center gap-1">
      <span className={`${pillClass} ${tone}`} title="Weft's static scan">{label}</span>
      {review.status === "done" && <span className={`${pillClass} ${AI[review.review.verdict][1]}`}>{AI[review.review.verdict][0]}</span>}
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
  const title = `${danger ? "Danger" : "Worth a look"}: ${top.map((f) => f.message).join("; ")}. Click for an AI review in the pane.`;
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
