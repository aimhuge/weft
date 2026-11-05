import fs from "node:fs";
import path from "node:path";
import { globalSingleton } from "./global-singleton";
import { DATA_DIR } from "./store";
import type { Card } from "./types";
import type { Habit } from "./craft-types";

// The craft habits each shipped card showed: the skills its Claude Code transcript ran, sorted into
// the craft attribute's categories (lib/game-attributes.ts). A run in Weft and one in the terminal
// both count. Reading every transcript takes seconds, so the scan runs in the background and reads a
// transcript again only when its size changed; ~/.weft/craft.json keeps what it found, by session id:
// [size, habits].

// The habit lives in lib/craft-types.ts (types only, no node:fs), so the board's palette can name it
// without dragging this module into the browser chunk. Re-exported here: the server's own imports of
// "./craft" keep working.
export type { Habit };

// Each habit's skills, as they follow the slash; "weft:" or another plugin's prefix is optional.
export const HABIT_SKILLS: Record<Habit, string[]> = {
  wrap: ["done", "done-quick"],
  commit: ["commit", "done", "done-quick"],
  review: ["code-review", "review", "security-review"],
  docs: ["architecture", "update-docs", "documentation"],
  refactor: ["simplify", "lint-fix", "tech-debt"],
};

export const CRAFT_FILE = path.join(DATA_DIR, "craft.json");

type Found = Record<string, [number, Habit[]]>;

interface State {
  found: Found | null;
  scan: Promise<void> | null;
}

const state = () => globalSingleton<State>("__weftCraft", () => ({ found: null, scan: null }));

// In a transcript's JSONL: the command Claude Code expanded, a typed /skill, or a skill Claude loaded
// itself (you said "done" and it ran /done).
const SKILL_RUNS = [
  /<command-name>\/(?:[\w-]+:)?([\w-]+)<\/command-name>/g,
  /"(?:text|content)":"\/(?:[\w-]+:)?([\w-]+)(?=\s|\\n|")/g,
  /Base directory for this skill: [^"\\]*\/([\w-]+)(?=\\n|")/g,
];

export function habitsIn(transcript: string): Habit[] {
  const ran = new Set(SKILL_RUNS.flatMap((re) => [...transcript.matchAll(re)].map((m) => m[1])));
  return (Object.keys(HABIT_SKILLS) as Habit[]).filter((habit) => HABIT_SKILLS[habit].some((skill) => ran.has(skill)));
}

function found(): Found {
  const s = state();
  if (!s.found) {
    try {
      s.found = JSON.parse(fs.readFileSync(CRAFT_FILE, "utf8")) as Found;
    } catch {
      s.found = {};
    }
  }
  return s.found;
}

// Each card's habits, as its transcript was last read.
export function craftHabits(cards: Card[]): Map<string, ReadonlySet<Habit>> {
  const seen = found();
  const out = new Map<string, ReadonlySet<Habit>>();
  for (const card of cards) {
    const habits = card.sessionId ? seen[card.sessionId]?.[1] : undefined;
    if (habits?.length) out.set(card.id, new Set(habits));
  }
  return out;
}

async function scan(cards: Card[], files: Map<string, string>) {
  const seen = found();
  let changed = false;
  for (const card of cards) {
    const file = card.column === "done" && card.sessionId ? files.get(card.sessionId) : undefined;
    if (!file || !card.sessionId) continue;
    try {
      const { size } = await fs.promises.stat(file);
      if (seen[card.sessionId]?.[0] === size) continue;
      seen[card.sessionId] = [size, habitsIn(await fs.promises.readFile(file, "utf8"))];
      changed = true;
    } catch {
      // Gone or unreadable: no habits.
    }
  }
  if (changed) {
    fs.mkdirSync(path.dirname(CRAFT_FILE), { recursive: true });
    fs.writeFileSync(CRAFT_FILE, JSON.stringify(seen));
  }
}

// Reads the Done cards' new or grown transcripts, one scan at a time; callers share the one running.
export function scanCraft(cards: Card[], files: Map<string, string>): Promise<void> {
  const s = state();
  s.scan ??= scan(cards, files).finally(() => {
    s.scan = null;
  });
  return s.scan;
}
