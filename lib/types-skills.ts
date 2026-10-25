// Skills from a registry and what Weft's scan found in them (lib/skill-registry.ts, lib/skill-scan.ts).

export type ScanSeverity = "danger" | "warn" | "info";
export type ScanCategory = "code" | "telemetry" | "license" | "prompt";

export interface ScanFinding {
  severity: ScanSeverity;
  category: ScanCategory;
  // The rule's id, e.g. "pipe-to-shell".
  rule: string;
  message: string;
  file?: string;
  line?: number;
  // The matching line, trimmed.
  excerpt?: string;
}

export interface SkillLicense {
  // An SPDX-style id when Weft recognised the terms ("MIT", "Apache-2.0"), else null.
  spdx: string | null;
  kind: "permissive" | "copyleft" | "noncommercial" | "proprietary" | "unknown" | "none";
  // Where the terms came from: a LICENSE file, or "SKILL.md" for its frontmatter.
  file?: string;
}

export interface SkillScan {
  // danger: something a skill shouldn't do; warn: worth a look; clean: nothing found.
  verdict: "clean" | "warn" | "danger";
  findings: ScanFinding[];
  license: SkillLicense;
  // Every host its scripts call.
  hosts: string[];
  files: number;
  bytes: number;
}

// A file of a skill as text.
export interface SkillFile {
  path: string;
  contents: string;
}

// One search hit from skills.sh.
export interface RemoteSkill {
  // "owner/repo/skill", the id skills.sh downloads by.
  id: string;
  // The GitHub repo it lives in, "owner/repo".
  source: string;
  name: string;
  installs: number;
  // A skill with this name is already in the library.
  installed: boolean;
}

// The AI review (lib/skill-review.ts): a model reads the static scan and then the skill itself.
export interface SkillReview {
  verdict: "safe" | "caution" | "unsafe";
  // Two or three sentences for the drawer.
  summary: string;
  // What the skill makes the model do, in plain words.
  whatItDoes: string;
  concerns: { severity: "high" | "medium" | "low"; file?: string; line?: number; explanation: string }[];
  // Static findings the reviewer read and judged harmless, and why.
  falsePositives: { rule: string; file?: string; line?: number; why: string }[];
  // Where data goes: hosts, telemetry, what leaves the machine.
  dataFlow: string;
  license: string;
  recommendation: string;
  model: string;
  reviewedAt: string;
}

// Where a skill's AI review stands: none yet, running, done, or failed with why.
export type SkillReviewState = { status: "none" } | { status: "running"; page: string } | { status: "done"; page: string; review: SkillReview } | { status: "failed"; page: string; error: string };

// What the drawer shows before an install: the skill's files, the static scan and any AI review.
export interface RemoteSkillPreview {
  id: string;
  source: string;
  name: string;
  description: string;
  // The content hash Weft's copy is kept under (lib/skill-cache.ts).
  hash: string;
  files: { path: string; bytes: number }[];
  scan: SkillScan;
  review: SkillReviewState;
  installed: boolean;
  // skills.sh couldn't be reached and this is the copy Weft kept from before.
  offline?: boolean;
}
