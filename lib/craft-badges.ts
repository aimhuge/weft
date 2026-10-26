// The Craft and Board badges: the habits your shipped cards showed (the skills their transcripts ran,
// lib/craft.ts) and the shape of your board right now. Pure.
import { atLeast, crossing, def, isRefactor, shipped, type Def, type Result } from "./badge-kit";
import type { Habit } from "./craft-types";
import { dayKey, type ActivityEvent } from "./game";
import type { GameFacts } from "./game-badges";

// Each shipped card's habits, from the skills its transcript ran.
const habitsOf = (f: GameFacts, card: string | undefined) => (card ? f.habits?.get(card) : undefined);

// Each shipped card that showed the habit, dated by its ship.
const showed = (f: GameFacts, habit: Habit): [number, number][] =>
  shipped(f)
    .filter((e) => habitsOf(f, e.card)?.has(habit))
    .map((e) => [e.at, 1] as [number, number]);

// The project root a shipped card belongs to: its folder's root, or the folder itself.
const rootOf = (f: GameFacts, e: ActivityEvent): string => {
  const cwd = e.cwd ?? "";
  return f.roots?.get(cwd) ?? cwd;
};

// A day in one project that shipped both a refactor and a feature, dated by the later of the first pair.
function scoutDay(f: GameFacts): Result {
  // Each project and day, the first refactor and the first feature shipped in it. The cards come oldest
  // first, so the first card to complete a pair is the first pair.
  const days = new Map<string, { refactor?: number; feature?: number }>();
  for (const e of shipped(f)) {
    const key = `${rootOf(f, e)} ${dayKey(e.at)}`;
    const seen = days.get(key) ?? {};
    const side = isRefactor(e.title) ? "refactor" : "feature";
    seen[side] ??= e.at;
    days.set(key, seen);
    if (seen.refactor !== undefined && seen.feature !== undefined) return { unlocked: true, at: e.at };
  }
  return { unlocked: false };
}

const G = "Craft";
const B = "Board";

export const CRAFT_DEFS: Def[] = [
  def(G, "wrapped-up", "✅", "Wrapped up", "Run /done on a shipped card", crossing((f) => showed(f, "wrap"), 1)),
  def(G, "ritualist", "🕯️", "Ritualist", "Run /done on 100 shipped cards", crossing((f) => showed(f, "wrap"), 100)),
  def(G, "second-opinion", "🔍", "Second opinion", "Run a code review on 10 shipped cards", crossing((f) => showed(f, "review"), 10)),
  def(G, "archivist", "📚", "Archivist", "Update the docs on 25 shipped cards", crossing((f) => showed(f, "docs"), 25)),
  def(G, "boy-scout", "⛺", "Boy scout", "Ship a refactor and a feature in one project on the same day", scoutDay),
  def(B, "dreamer", "💭", "Dreamer", "50 cards in Backlog", atLeast((f) => f.board?.backlog ?? 0, 50)),
  def(B, "librarian", "🏷️", "Librarian", "Tag 50 cards", atLeast((f) => f.board?.tagged ?? 0, 50)),
];
