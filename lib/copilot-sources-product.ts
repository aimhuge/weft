import { execFile } from "node:child_process";
import fs from "node:fs";
import { basename, join } from "node:path";
import type { Source } from "./copilot-sources";

// What the projects say about where they're going, for the copilot's chips (lib/copilot-suggest.ts): the top of each
// roadmap, and what shipped lately. The copilot is a product partner, so "what next" needs both.

const MAX_ITEMS = 6;
const ROADMAPS = ["docs/ROADMAP.md", "ROADMAP.md"];

// A project's roadmap's first items, one line each, or none without a roadmap.
export function roadmapItems(root: string): string[] {
  for (const rel of ROADMAPS) {
    let text: string;
    try {
      text = fs.readFileSync(join(root, rel), "utf8");
    } catch {
      continue;
    }
    return text
      .split("\n")
      .filter((l) => /^\s*(\d+\.|[-*])\s+/.test(l) && !/`Done`/.test(l))
      .slice(0, MAX_ITEMS)
      .map((l) => l.replace(/^\s*(\d+\.|[-*])\s+/, "").replace(/\*\*/g, "").slice(0, 140));
  }
  return [];
}

export const roadmap: Source = (projects) =>
  projects.flatMap((root) => {
    const items = roadmapItems(root);
    return items.length ? [`- ${basename(root)}:`, ...items.map((i) => `  ${i}`)] : [];
  });

// Feature and fix commits from the last week, without the changelog and release bookkeeping.
const log = (cwd: string) =>
  new Promise<string[]>((resolve) =>
    execFile("git", ["log", "--since=7 days ago", "--format=%s", "-n", "40"], { cwd, timeout: 3_000 }, (err, out) =>
      resolve(err ? [] : out.split("\n").filter((s) => /^(feat|fix|perf|refactor)/.test(s)).slice(0, MAX_ITEMS)),
    ),
  );

export const shipped: Source = async (projects) => {
  const each = await Promise.all(
    projects.map(async (root) => {
      const subjects = await log(root);
      return subjects.length ? [`- ${basename(root)}:`, ...subjects.map((s) => `  ${s}`)] : [];
    }),
  );
  return each.flat();
};

export const PRODUCT_SOURCES: { title: string; source: Source; ms: number }[] = [
  { title: "Roadmap: what's next", source: roadmap, ms: 1_000 },
  { title: "Shipped in the last week", source: shipped, ms: 3_000 },
];
