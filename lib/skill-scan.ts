import { licenseFinding, readLicense } from "./skill-license";
import { BINARY_EXT, CODE_EXT, HIDDEN_CHARS, LOCAL_HOST, RULES, TEST_PATH } from "./skill-scan-rules";
import { SCAN_VERDICT_RANK } from "./skill-verdict";
import type { ScanFinding, SkillFile, SkillScan } from "./types";

// Weft's skill scan: every text file of a skill against the rules in lib/skill-scan-rules.ts, plus its
// license, the hosts its scripts call, and files no one can review by reading. Pure, so a skill from
// skills.sh is scanned before it touches the disk (lib/skill-registry.ts), and one already installed is
// scanned from its folder (lib/skill-scan-library.ts).

// Enough to see a pattern; a rule that hits more often than this in one file says so once more.
const PER_RULE_PER_FILE = 3;
const MAX_FINDINGS = 60;

const lineOf = (text: string, index: number) => text.slice(0, index).split("\n").length;
const excerptAt = (text: string, index: number) => {
  const start = text.lastIndexOf("\n", index) + 1;
  const end = text.indexOf("\n", index);
  const line = text.slice(start, end === -1 ? undefined : end).trim();
  return line.length > 140 ? `${line.slice(0, 139)}…` : line;
};

function ruleFindings(file: SkillFile): ScanFinding[] {
  const out: ScanFinding[] = [];
  const isTest = TEST_PATH.test(file.path);
  for (const rule of RULES) {
    if (isTest && rule.category === "prompt") continue;
    const global = new RegExp(rule.pattern.source, rule.pattern.flags.includes("g") ? rule.pattern.flags : `${rule.pattern.flags}g`);
    let hits = 0;
    for (const match of file.contents.matchAll(global)) {
      if (++hits > PER_RULE_PER_FILE) break;
      out.push({ severity: rule.severity, category: rule.category, rule: rule.id, message: rule.message, file: file.path, line: lineOf(file.contents, match.index), excerpt: excerptAt(file.contents, match.index) });
    }
  }
  return out;
}

function hiddenCharFinding(file: SkillFile): ScanFinding | null {
  const body = file.contents.replace(/^﻿/, "");
  const match = HIDDEN_CHARS.exec(body);
  if (!match) return null;
  const code = match[0].codePointAt(0)?.toString(16).toUpperCase().padStart(4, "0");
  return { severity: "danger", category: "prompt", rule: "hidden-chars", message: `Holds invisible characters (U+${code}) a model reads but you can't see`, file: file.path, line: lineOf(body, match.index) };
}

const isBinary = (file: SkillFile) => BINARY_EXT.test(file.path) || file.contents.includes("\u0000");
const isCode = (file: SkillFile) => CODE_EXT.test(file.path) || file.contents.startsWith("#!");

// The hosts a skill's scripts reach, from the URLs in them.
export function callHosts(files: SkillFile[]): string[] {
  const hosts = new Set<string>();
  for (const file of files) {
    if (!isCode(file) || isBinary(file)) continue;
    for (const match of file.contents.matchAll(/\bhttps?:\/\/([\w.-]+(?::\d+)?)/gi)) {
      const host = (match[1] ?? "").toLowerCase().replace(/\.$/, "");
      if (host && !LOCAL_HOST.test(host)) hosts.add(host);
    }
  }
  return [...hosts].sort();
}

export function scanFiles(files: SkillFile[]): SkillScan {
  const findings: ScanFinding[] = [];
  for (const file of files) {
    if (isBinary(file)) {
      findings.push({ severity: "warn", category: "code", rule: "binary", message: "A binary file: it can't be reviewed by reading", file: file.path });
      continue;
    }
    findings.push(...ruleFindings(file));
    const hidden = TEST_PATH.test(file.path) ? null : hiddenCharFinding(file);
    if (hidden) findings.push(hidden);
  }
  const license = readLicense(files);
  findings.push(licenseFinding(license));
  const hosts = callHosts(files);
  if (hosts.length) findings.push({ severity: "info", category: "telemetry", rule: "hosts", message: `Its scripts call ${hosts.length === 1 ? "1 host" : `${hosts.length} hosts`}: ${hosts.slice(0, 6).join(", ")}${hosts.length > 6 ? "…" : ""}` });
  findings.sort((a, b) => SCAN_VERDICT_RANK[a.severity] - SCAN_VERDICT_RANK[b.severity]);
  const verdict = findings.some((f) => f.severity === "danger") ? "danger" : findings.some((f) => f.severity === "warn") ? "warn" : "clean";
  return { verdict, findings: findings.slice(0, MAX_FINDINGS), license, hosts, files: files.length, bytes: files.reduce((n, f) => n + f.contents.length, 0) };
}
