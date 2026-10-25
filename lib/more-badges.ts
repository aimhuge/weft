// The Streaks extras, Projects, Secret and Undeterred badges: long streaks and freezes, how your projects grew,
// the hidden ones (shown as ❓ until earned) and shipping on through a limit. Pure.
import { atLeast, def, first, liveShipped, noon, nthInADay, shipped, type Def, type Result } from "./badge-kit";
import { addDays, dayKey, weekOf, type ActivityEvent } from "./game";
import type { GameFacts } from "./game-badges";
import { productionReady } from "./project-badges";

// A streak badge dated by the day its length was first reached.
function streakBadge(n: number) {
  return (f: GameFacts): Result => {
    const day = f.streakReached?.[n];
    return { ...atLeast((g) => g.bestStreak, n)(f), at: day ? noon(day) : undefined };
  };
}

// The earliest day a streak freeze covered, dated at noon.
function frozenAt(f: GameFacts): Result {
  const day = [...(f.frozen ?? [])].sort()[0];
  return { unlocked: !!day, at: day ? noon(day) : undefined };
}

// Each ship day's first ship, oldest first.
function shipDays(f: GameFacts): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of shipped(f)) {
    const day = dayKey(e.at);
    if (!out.has(day)) out.set(day, e.at);
  }
  return out;
}

// The first seven consecutive ship days, dated by the seventh day's first ship.
function perfectWeek(f: GameFacts): Result {
  const days = shipDays(f);
  for (const start of days.keys()) {
    const week = [0, 1, 2, 3, 4, 5, 6].map((n) => addDays(start, n));
    if (!week.every((day) => days.has(day))) continue;
    return { unlocked: true, at: days.get(addDays(start, 6)) };
  }
  return { unlocked: false };
}

// The cards created in one project, by their project root.
function createdByRoot(f: GameFacts): Map<string, ActivityEvent[]> {
  const out = new Map<string, ActivityEvent[]>();
  for (const e of f.events) {
    if (e.kind !== "created" || !e.cwd) continue;
    const root = f.roots?.get(e.cwd) ?? e.cwd;
    out.set(root, [...(out.get(root) ?? []), e]);
  }
  return out;
}

// The tenth shipped card of a project, dated by that ship.
function bigBangAt(f: GameFacts): number | undefined {
  const created = createdByRoot(f);
  const tenth = new Map<string, ActivityEvent[]>();
  for (const e of shipped(f)) {
    if (!e.cwd) continue;
    const root = f.roots?.get(e.cwd) ?? e.cwd;
    const list = tenth.get(root) ?? [];
    list.push(e);
    tenth.set(root, list);
  }
  for (const [root, cards] of created) {
    const first = cards[0];
    const ships = tenth.get(root) ?? [];
    const tenthShip = ships[9];
    if (first && tenthShip && dayKey(first.at) === dayKey(tenthShip.at)) return tenthShip.at;
  }
  return undefined;
}

// The first live ship at 4:20, in either 4:20am or 4:20pm.
function blazeAt(f: GameFacts): number | undefined {
  return liveShipped(f).find((e) => {
    const d = new Date(e.at);
    return d.getHours() === 4 && d.getMinutes() === 20 || d.getHours() === 16 && d.getMinutes() === 20;
  })?.at;
}

// The 69th ship in a Monday-to-Sunday week, dated by that ship.
function niceAt(f: GameFacts): number | undefined {
  const weeks = new Map<string, ActivityEvent[]>();
  for (const e of shipped(f)) {
    const monday = weekOf(dayKey(e.at));
    weeks.set(monday, [...(weeks.get(monday) ?? []), e]);
  }
  for (const list of weeks.values()) {
    const hit = list[68];
    if (hit) return hit.at;
  }
  return undefined;
}

// The first shipped card whose title says it fixed a typo.
function typoAt(f: GameFacts): number | undefined {
  return shipped(f).find((e) => /\bfix(?:e[sd])?\b.*\btypos?\b/i.test(e.title ?? ""))?.at;
}

// The third shipped card after a limit hit on that same local day.
function undeterredAt(f: GameFacts): number | undefined {
  for (const hit of [...(f.limitHits ?? [])].sort((a, b) => a.at - b.at)) {
    const ships = shipped(f).filter((e) => e.at >= hit.at && dayKey(e.at) === dayKey(hit.at));
    const third = ships[2];
    if (third) return third.at;
  }
  return undefined;
}

export const MORE_DEFS: Def[] = [
  def("Streaks", "streak-365", "🗓️", "Year on the loom", "A 365-day streak", streakBadge(365)),
  def("Streaks", "streak-1000", "🏛️", "Monument", "A 1,000-day streak", streakBadge(1000)),
  def("Streaks", "saved-by-the-bell", "🛟", "Saved by the bell", "A streak freeze saved your streak", frozenAt),
  def("Streaks", "perfect-week", "💎", "Perfect week", "Ship something every day for 7 days", perfectWeek),
  def("Projects", "cartographer-10", "🗺️", "Cartographer", "Work in 10 projects (3+ cards each)", atLeast((f) => f.projectCount, 10)),
  def("Projects", "cartographer-25", "🌐", "Globetrotter", "Work in 25 projects (3+ cards each)", atLeast((f) => f.projectCount, 25)),
  def("Projects", "big-bang", "💥", "Big bang", "A project's first card to its tenth shipped in one day", first(bigBangAt)),
  def("Projects", "fleet-ready", "🏗️", "Fleet ready", "3 projects Production-ready",
    atLeast((f) => f.projects.filter((p) => productionReady(p)).length, 3)),
  def("Projects", "stack-collector", "🧬", "Stack collector", "Ship in projects on 5 different stacks", atLeast((f) => f.shippedStacks ?? 0, 5)),
  def("Secret", "nice", "🍃", "Nice", "Ship 69 cards in a week", first(niceAt), { secret: true }),
  def("Secret", "blaze-it", "🌿", "Blaze it", "Ship a card at 4:20", first(blazeAt), { secret: true }),
  def("Secret", "the-answer", "🌌", "The answer", "Ship 42 cards in a day", nthInADay(shipped, 42), { secret: true }),
  def("Secret", "typo-slayer", "🔤", "Typo slayer", "Ship a card titled “fix typo”", first(typoAt), { secret: true }),
  def("Limits", "undeterred", "💪", "Undeterred", "Hit a limit and still ship 3 cards that day", first(undeterredAt)),
];
