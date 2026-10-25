import path from "node:path";
import { CHECKS, setupPrompt, type ProjectReport } from "./project-badges";
import type { GhIssue } from "./github-issues";
import type { Card } from "./types";

// A new project's starter Backlog: what Weft already knows about a folder, as a few parked cards
// (docs/architecture/project-seed.md). Pure: lib/project-seed-find.ts does the looking and
// lib/project-seed-run.ts makes the cards. Each finding is one small card with a prompt that stands on its own.

export type SeedKind = "agents" | "migrations" | "issue" | "check" | "todo";

export interface Seed {
  kind: SeedKind;
  title: string;
  prompt: string;
  // An issue's seed becomes its card through lib/github-issues.ts, so a later issue sync knows it.
  issue?: { repo: string; issue: GhIssue };
}

// How many cards one project gets at most, so a big repo doesn't flood the board, and per source.
export const MAX_SEEDS = 6;
const MAX_ISSUES = 3;
const MAX_CHECKS = 2;
// A file needs this many TODO/FIXME comments to count as a cluster worth a card.
const TODO_MIN = 4;

// The order kinds fill the cap in: what unblocks agents first, then what's on fire, then polish.
const KIND_ORDER: SeedKind[] = ["agents", "migrations", "issue", "check", "todo"];

// The production-ready checks worth a starter card, most important first. Agent docs have their own card.
const CHECK_ORDER = ["envIgnored", "upstream", "lockfile", "guarded", "coverage", "readme", "secretScan", "errors", "deploys", "pinned"];

export function agentsSeed(name: string): Seed {
  return {
    kind: "agents",
    title: `Set up ${name} for agents`,
    prompt: [
      `${name} has no CLAUDE.md or AGENTS.md, so every thread here starts without knowing the project.`,
      "1. Run /init to write a CLAUDE.md: what the project is, a file map, its conventions, and the commands to lint, type-check and test.",
      "2. Then run /weft:setup-done so /weft:done has what it needs here (tests with coverage, docs folders, strict lint).",
      "Keep both short and true to the code as it is today.",
    ].join("\n"),
  };
}

// The most important failing checks of the production-ready tree, at most two.
export function checkSeeds(report: ProjectReport): Seed[] {
  return CHECK_ORDER.flatMap((id) => CHECKS.filter((c) => c.id === id && report.ok[id] === false))
    .slice(0, MAX_CHECKS)
    .map((check) => ({ kind: "check" as const, title: `${check.label} for ${report.name}`, prompt: setupPrompt(check, report) }));
}

// The open issues worth a card (assigned to you or labeled bug), newest numbers first, at most three.
export function issueSeeds(repo: string, issues: readonly GhIssue[]): Seed[] {
  const seen = new Set<number>();
  return [...issues]
    .sort((a, b) => b.number - a.number)
    .filter((i) => !seen.has(i.number) && seen.add(i.number))
    .slice(0, MAX_ISSUES)
    .map((issue) => ({ kind: "issue" as const, title: issue.title.trim() || `${repo}#${issue.number}`, prompt: "", issue: { repo, issue } }));
}

// The densest TODO/FIXME cluster in `git grep -n` output ("file:line:text"), as one card, or null.
export function todoSeed(grep: string): Seed | null {
  const byFile = new Map<string, number[]>();
  for (const row of grep.split("\n")) {
    const m = /^(.+?):(\d+):/.exec(row);
    if (!m) continue;
    const [, file, line] = m as unknown as [string, string, string];
    byFile.set(file, [...(byFile.get(file) ?? []), Number(line)]);
  }
  const top = [...byFile].sort((a, b) => b[1].length - a[1].length)[0];
  if (!top || top[1].length < TODO_MIN) return null;
  const [file, lines] = top;
  const shown = lines.slice(0, 12).join(", ");
  return {
    kind: "todo",
    title: `Clear the TODOs in ${path.basename(file)}`,
    prompt: [
      `${file} has ${lines.length} TODO/FIXME comments (lines ${shown}${lines.length > 12 ? ", …" : ""}), the densest cluster in the repo.`,
      "Work through them: fix the quick ones with a test where it matters, delete the ones that are stale, and list the bigger ones for me with a line each on what they'd take.",
    ].join("\n\n"),
  };
}

const norm = (title: string) => title.trim().toLowerCase().replace(/\s+/g, " ");

type Existing = Pick<Card, "title" | "issue">;

// Whether the board already has this seed's card: the same issue, or a card of the same title.
function onBoard(seed: Seed, cards: readonly Existing[]) {
  if (seed.issue) {
    const { repo, issue } = seed.issue;
    return cards.some((c) => c.issue?.number === issue.number && c.issue.repo.toLowerCase() === repo.toLowerCase());
  }
  return cards.some((c) => norm(c.title) === norm(seed.title));
}

// The seeds to make: none already on the board, in kind order, capped.
export function pickSeeds(seeds: readonly Seed[], cards: readonly Existing[], max = MAX_SEEDS): Seed[] {
  return KIND_ORDER.flatMap((kind) => seeds.filter((s) => s.kind === kind))
    .filter((s) => !onBoard(s, cards))
    .slice(0, max);
}

// One line per seed for the copilot's chips (lib/copilot-setup.ts).
export function seedLine(project: string, seed: Seed) {
  return `- ${project}: starter card "${seed.title}" (${seed.kind === "issue" && seed.issue ? `issue ${seed.issue.repo}#${seed.issue.issue.number}` : seed.kind})`;
}
