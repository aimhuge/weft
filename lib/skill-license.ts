import type { ScanFinding, SkillFile, SkillLicense } from "./types";

// Which terms a skill comes under, from its LICENSE file or the `license:` in its SKILL.md frontmatter,
// and what that means for using it (lib/skill-scan.ts). Order matters: AGPL and LGPL before GPL, and
// non-commercial before plain CC BY.

const KNOWN: [RegExp, string, SkillLicense["kind"]][] = [
  [/GNU AFFERO|\bAGPL/i, "AGPL-3.0", "copyleft"],
  [/GNU LESSER|\bLGPL/i, "LGPL", "copyleft"],
  [/GNU GENERAL PUBLIC|\bGPL/i, "GPL", "copyleft"],
  [/Mozilla Public License|\bMPL-?2/i, "MPL-2.0", "copyleft"],
  [/NonCommercial|\bCC[- ]BY[- ](NC|SA[- ]NC)/i, "CC-BY-NC", "noncommercial"],
  [/\bCC0\b|CC Zero|Creative Commons Zero/i, "CC0-1.0", "permissive"],
  [/Apache License|\bApache-2\.0\b/i, "Apache-2.0", "permissive"],
  [/\bMIT License\b|^\s*MIT\s*$|Permission is hereby granted, free of charge/im, "MIT", "permissive"],
  [/\bISC License\b|^\s*ISC\s*$|Permission to use, copy, modify, and\/or distribute/im, "ISC", "permissive"],
  [/\bBSD\b|Redistribution and use in source and binary forms/i, "BSD", "permissive"],
  [/\bUnlicense\b|This is free and unencumbered software/i, "Unlicense", "permissive"],
  [/\bCC[- ]BY\b|Creative Commons Attribution/i, "CC-BY", "permissive"],
  [/All rights reserved|\bproprietary\b|may not (be )?(copied|redistributed|modified)|\bconfidential\b/i, "Proprietary", "proprietary"],
];

const LICENSE_FILE = /(^|\/)(LICEN[CS]E|COPYING)(\.[\w]+)?$/i;

function classify(text: string): Pick<SkillLicense, "spdx" | "kind"> {
  for (const [pattern, spdx, kind] of KNOWN) if (pattern.test(text)) return { spdx, kind };
  return { spdx: null, kind: "unknown" };
}

// A `license:` value from SKILL.md's frontmatter, unless it only points at a file.
function frontmatterLicense(files: SkillFile[]): string | null {
  const skill = files.find((f) => /(^|\/)SKILL\.md$/i.test(f.path));
  const front = skill?.contents.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1];
  const value = front?.match(/^license:\s*(.+)$/im)?.[1]?.trim().replace(/^(["'])(.*)\1$/, "$2");
  return value ? value : null;
}

export function readLicense(files: SkillFile[]): SkillLicense {
  // The license file nearest the skill's root.
  const file = files.filter((f) => LICENSE_FILE.test(f.path)).sort((a, b) => a.path.split("/").length - b.path.split("/").length)[0];
  if (file) return { ...classify(file.contents), file: file.path };
  const declared = frontmatterLicense(files);
  if (declared) return { ...classify(declared), file: "SKILL.md" };
  return { spdx: null, kind: "none" };
}

const MESSAGES: Record<SkillLicense["kind"], [ScanFinding["severity"], string]> = {
  permissive: ["info", "Permissive license: free to use, keep the notice"],
  copyleft: ["warn", "Copyleft license: work you share that's built on it must use the same license"],
  noncommercial: ["warn", "Non-commercial license: not for paid or business work"],
  proprietary: ["warn", "Proprietary terms: check you're allowed to use and share it"],
  unknown: ["warn", "A license Weft doesn't recognise: read it before you rely on the skill"],
  none: ["warn", "No license in the skill's files: by default you have no right to copy or share it"],
};

export function licenseFinding(license: SkillLicense): ScanFinding {
  const [severity, message] = MESSAGES[license.kind];
  return { severity, category: "license", rule: `license-${license.kind}`, message: license.spdx ? `${message} (${license.spdx})` : message, file: license.file };
}
