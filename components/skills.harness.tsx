// What the ✦ filter's tests share (components/SkillSearchResults.test.tsx, components/SkillSearchResults.scan.test.tsx):
// the shapes a skills.sh answer takes — a hit, its preview and the scan of it.
import type { RemoteSkill, RemoteSkillPreview, SkillScan } from "@/lib/types";

export const scan = (over: Partial<SkillScan> = {}): SkillScan => ({
  verdict: "clean",
  findings: [],
  license: { spdx: "MIT", kind: "permissive" },
  hosts: [],
  files: 1,
  bytes: 10,
  ...over,
});

export const hit: RemoteSkill = { id: "acme/skills/pdf", source: "acme/skills", name: "pdf", installs: 21_600, installed: false };

export const preview = (over: Partial<RemoteSkillPreview> = {}): RemoteSkillPreview => ({
  id: hit.id,
  source: hit.source,
  name: hit.name,
  description: "Read PDFs",
  hash: "a".repeat(64),
  files: [{ path: "SKILL.md", bytes: 10 }],
  scan: scan(),
  review: { status: "none" },
  installed: false,
  ...over,
});
