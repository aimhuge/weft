// The builder card: seven attributes (0-100) worked out from what you build and how, the class your
// top two make, and a level per technology from the cards you shipped with it. Pure (see lib/game.ts).
import type { Habit } from "./craft-types";
import { addDays, XP, type ActivityEvent, type DayTally } from "./game";
import { isRefactor } from "./game-badges";
import { branchProgress, type ProjectReport } from "./project-badges";

export type AttributeId = "follow" | "velocity" | "range" | "rigor" | "guard" | "craft" | "stamina";

export interface Attribute {
  id: AttributeId;
  icon: string;
  label: string;
  value: number;
  // How it's measured, with your number.
  hint: string;
}

// Each attribute names the class when it's your best, and its adjective when it's your second best.
const META: Record<AttributeId, { icon: string; label: string; noun: string; adjective: string }> = {
  follow: { icon: "🎯", label: "Follow-through", noun: "Finisher", adjective: "Reliable" },
  velocity: { icon: "⚡", label: "Velocity", noun: "Shipper", adjective: "Swift" },
  range: { icon: "🧭", label: "Range", noun: "Explorer", adjective: "Roaming" },
  rigor: { icon: "🧪", label: "Rigor", noun: "Artisan", adjective: "Rigorous" },
  guard: { icon: "🛡️", label: "Guard", noun: "Guardian", adjective: "Vigilant" },
  craft: { icon: "🧹", label: "Craft", noun: "Refiner", adjective: "Careful" },
  stamina: { icon: "🔥", label: "Stamina", noun: "Marathoner", adjective: "Tireless" },
};

export interface AttributeInput {
  events: ActivityEvent[];
  days: Map<string, DayTally>;
  today: string;
  bestStreak: number;
  projects: ProjectReport[];
  // Projects with 3 or more cards, and every stack seen across them.
  projectCount: number;
  stacks: number;
  // Each card's craft habits, from the skills its transcript ran (lib/craft.ts).
  habits: ReadonlyMap<string, ReadonlySet<Habit>>;
}

// Craft: each habit's points, earned in full once this share of shipped cards shows it. Wrapping up
// with /done is most of it; a refactor counts by the card's title too.
const CRAFT: Record<Habit, { points: number; full: number }> = {
  wrap: { points: 40, full: 1 },
  commit: { points: 15, full: 1 },
  review: { points: 15, full: 0.2 },
  docs: { points: 15, full: 0.2 },
  refactor: { points: 15, full: 0.1 },
};

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const avg = (list: number[]) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0);

function lastDays(days: Map<string, DayTally>, today: string, n: number) {
  const from = addDays(today, -(n - 1));
  return [...days].filter(([day]) => day >= from && day <= today).map(([, d]) => d);
}

function treeShare(projects: ProjectReport[], branches: Parameters<typeof branchProgress>[1][]) {
  return avg(
    projects.map((p) => {
      const parts = branches.map((b) => branchProgress(p, b));
      return (100 * parts.reduce((n, x) => n + x.done, 0)) / parts.reduce((n, x) => n + x.total, 0);
    }),
  );
}

// How many shipped cards show each habit, and the craft score they make.
function craftScore(done: ActivityEvent[], habits: AttributeInput["habits"]) {
  const shipped = new Map(done.map((e) => [e.card, e.title]));
  const shown: Record<Habit, number> & { shipped: number } = { wrap: 0, commit: 0, review: 0, docs: 0, refactor: 0, shipped: shipped.size };
  for (const [card, title] of shipped) {
    const has = (card && habits.get(card)) || new Set<Habit>();
    for (const habit of Object.keys(CRAFT) as Habit[]) {
      if (has.has(habit) || (habit === "refactor" && isRefactor(title))) shown[habit]++;
    }
  }
  const craft = shipped.size
    ? (Object.keys(CRAFT) as Habit[]).reduce((n, h) => n + CRAFT[h].points * Math.min(1, shown[h] / shipped.size / CRAFT[h].full), 0)
    : 0;
  return { craft, shown };
}

export function attributes(input: AttributeInput): Attribute[] {
  const { events, days, today } = input;
  const created = new Set(events.filter((e) => e.kind === "created").map((e) => e.card));
  const done = events.filter((e) => e.kind === "done");
  // A card reopened and moved to Done again logs a second "done"; count each created card once.
  const finished = new Set(done.map((e) => e.card).filter((c) => created.has(c))).size;
  const month = lastDays(days, today, 30);
  const activeMonth = month.filter((d) => d.cards + d.turns + d.done > 0).length;
  const shippedMonth = month.reduce((n, d) => n + d.done, 0);
  const perDay = activeMonth ? shippedMonth / activeMonth : 0;
  const { craft, shown } = craftScore(done, input.habits);
  const values: Record<AttributeId, [number, string]> = {
    follow: [created.size ? (100 * finished) / created.size : 0, `${finished} of ${created.size} cards reached Done`],
    velocity: [perDay * 10, `${perDay.toFixed(1)} cards shipped per active day this month`],
    range: [input.projectCount * 6 + input.stacks * 3, `${input.projectCount} projects, ${input.stacks} technologies`],
    rigor: [treeShare(input.projects, ["testing"]), "Testing checks passed across your projects"],
    guard: [treeShare(input.projects, ["security", "observability"]), "Security and observability checks passed"],
    craft: [craft, `${shown.wrap}/${shown.shipped} ran /done · review ${shown.review} · docs ${shown.docs} · refactor ${shown.refactor}`],
    stamina: [(activeMonth / 30) * 80 + Math.min(20, input.bestStreak), `${activeMonth} active days this month, best streak ${input.bestStreak}`],
  };
  return (Object.keys(META) as AttributeId[]).map((id) => ({
    id,
    icon: META[id].icon,
    label: META[id].label,
    value: clamp(values[id][0]),
    hint: values[id][1],
  }));
}

// "Swift Finisher": your best attribute's noun, after your second best's adjective.
export function classFor(attrs: Attribute[]): string {
  const [top, second] = [...attrs].sort((a, b) => b.value - a.value);
  if (!top) return "Apprentice";
  return second ? `${META[second.id].adjective} ${META[top.id].noun}` : META[top.id].noun;
}

export interface Skill {
  tech: string;
  xp: number;
  level: number;
}

// Every shipped card gives its XP to each technology its project uses.
export function stackSkills(events: ActivityEvent[], stackOf: (cwd: string) => string[]): Skill[] {
  const xp = new Map<string, number>();
  for (const e of events) {
    if (e.kind !== "done" || !e.cwd) continue;
    for (const tech of stackOf(e.cwd)) xp.set(tech, (xp.get(tech) ?? 0) + XP.done);
  }
  return [...xp]
    .map(([tech, n]) => ({ tech, xp: n, level: Math.floor(Math.sqrt(n / 10)) }))
    .sort((a, b) => b.xp - a.xp);
}
