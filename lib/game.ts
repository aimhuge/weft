// Weft's game layer, the pure part: XP, levels, streaks, the activity "cloth" and personal records,
// all worked out from the activity log (lib/activity.ts). Pure, so the client can import the types
// and tests can pin every rule; lib/game-server.ts puts it together on the server.

// "explore" marks the first use of a Weft feature (lib/explore.ts); like "quality" and "limit" it earns no XP and keeps no streak.
export type ActivityKind = "created" | "start" | "turn" | "done" | "quality" | "limit" | "explore";

// One thing that happened, a line of ~/.weft/activity.jsonl.
export interface ActivityEvent {
  // Stable, so a sync (once there are accounts) can tell what it already sent.
  id: string;
  at: number;
  kind: ActivityKind;
  card?: string;
  // The card's folder; for "quality", the project root measured.
  cwd?: string;
  // turn and done: the card's total cost then. A backfilled turn counts `turns` turns at once.
  cost?: number;
  turns?: number;
  // start: how many cards were running at once.
  running?: number;
  // quality: the checklist score and line coverage that day.
  score?: number;
  coverage?: number;
  // created and done: the card's title, for the craft attribute and refactor badges.
  title?: string;
  // limit: which plan window a Weft thread ran out of (lib/usage.ts).
  limit?: "five_hour" | "seven_day";
  // explore: which feature was used for the first time (lib/explore.ts EXPLORE_FEATURES, or "intro:<id>").
  feature?: string;
}

// Shipping is worth the most, so starting cards for the sake of it doesn't pay.
export const XP = { created: 2, turn: 1, done: 10 } as const;
// A card shipped in a project whose latest quality checklist scored this or better earns more.
export const QUALITY_BAR = 80;
export const QUALITY_BONUS = 1.5;

const TITLES: [number, string][] = [
  [30, "Tapestry"],
  [20, "Loom"],
  [15, "Bolt"],
  [10, "Yarn"],
  [5, "Strand"],
  [1, "Thread"],
];

export interface Level {
  level: number;
  title: string;
  // XP at the start of this level and of the next.
  floor: number;
  next: number;
}

const LEVEL_STEP = 40;

function xpForLevel(level: number) {
  return LEVEL_STEP * (level - 1) ** 2;
}

export function levelFor(xp: number): Level {
  const level = Math.floor(Math.sqrt(Math.max(0, xp) / LEVEL_STEP)) + 1;
  const title = TITLES.find(([min]) => level >= min)?.[1] ?? "Thread";
  return { level, title, floor: xpForLevel(level), next: xpForLevel(level + 1) };
}

const pad = (n: number) => String(n).padStart(2, "0");

// The local calendar day of a time, "2026-10-11".
export function dayKey(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return dayKey(new Date(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + n).getTime());
}

// The Monday of a day's week: leagues and the weekly XP run Monday to Sunday.
export function weekOf(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const weekday = (new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1).getDay() + 6) % 7;
  return addDays(day, -weekday);
}

export interface DayTally {
  cards: number;
  turns: number;
  done: number;
  xp: number;
}

const emptyDay = (): DayTally => ({ cards: 0, turns: 0, done: 0, xp: 0 });

// The latest quality score of each project at a time, from its snapshots.
function qualityAt(events: ActivityEvent[]) {
  const byRoot = new Map<string, { at: number; score: number }[]>();
  for (const e of events) {
    if (e.kind !== "quality" || !e.cwd || e.score === undefined) continue;
    const list = byRoot.get(e.cwd) ?? [];
    list.push({ at: e.at, score: e.score });
    byRoot.set(e.cwd, list);
  }
  return (root: string, at: number) => {
    const before = (byRoot.get(root) ?? []).filter((s) => s.at <= at);
    return before.length ? before.reduce((a, b) => (b.at > a.at ? b : a)).score : null;
  };
}

// The XP an event earns. A done card in a healthy project earns the quality bonus.
export function eventXp(e: ActivityEvent, score: number | null): number {
  if (e.kind === "created") return XP.created;
  if (e.kind === "turn") return XP.turn * (e.turns ?? 1);
  if (e.kind === "done") return Math.round(XP.done * (score !== null && score >= QUALITY_BAR ? QUALITY_BONUS : 1));
  return 0;
}

// What each day added up to. `rootOf` maps a card's folder to its project root.
export function tallyDays(events: ActivityEvent[], rootOf: (cwd: string) => string): Map<string, DayTally> {
  const score = qualityAt(events);
  const days = new Map<string, DayTally>();
  for (const e of events) {
    if (e.kind === "quality" || e.kind === "start" || e.kind === "limit" || e.kind === "explore") continue;
    const key = dayKey(e.at);
    const day = days.get(key) ?? emptyDay();
    if (e.kind === "created") day.cards += 1;
    if (e.kind === "turn") day.turns += e.turns ?? 1;
    if (e.kind === "done") day.done += 1;
    day.xp += eventXp(e, e.kind === "done" && e.cwd ? score(rootOf(e.cwd), e.at) : null);
    days.set(key, day);
  }
  return days;
}

export interface Streak {
  current: number;
  best: number;
  // Streak freezes in hand: one earned every 7 days in a row, at most MAX_FREEZES. A missed day
  // spends one instead of ending the streak.
  freezes: number;
  // Days a freeze covered, so the cloth can show them.
  frozen: string[];
  // Nothing done yet today, so the streak ends tonight unless you ship something (or a freeze covers it).
  atRisk: boolean;
  // The day each streak length in STREAK_MARKS was first reached, for the streak badges' dates.
  reached: Record<number, string>;
}

export const STREAK_MARKS = [3, 7, 30, 100, 365, 1000];

export const MAX_FREEZES = 2;
export const FREEZE_EVERY = 7;

// Walks every day from the first active one to today. Today being empty doesn't break anything yet.
export function streakOf(active: Set<string>, today: string): Streak {
  const first = [...active].sort()[0];
  const streak: Streak = { current: 0, best: 0, freezes: 0, frozen: [], atRisk: false, reached: {} };
  if (!first) return streak;
  for (let day = first; day <= today; day = addDays(day, 1)) {
    if (active.has(day)) {
      streak.current += 1;
      if (streak.current % FREEZE_EVERY === 0) streak.freezes = Math.min(MAX_FREEZES, streak.freezes + 1);
      if (STREAK_MARKS.includes(streak.current)) streak.reached[streak.current] ??= day;
    } else if (day === today) {
      streak.atRisk = streak.current > 0;
    } else if (streak.freezes > 0) {
      streak.freezes -= 1;
      streak.frozen.push(day);
    } else {
      streak.current = 0;
    }
    streak.best = Math.max(streak.best, streak.current);
  }
  return streak;
}

// Days that count toward a streak: any day you started, worked on or shipped a card.
export function activeDays(days: Map<string, DayTally>): Set<string> {
  return new Set([...days].filter(([, d]) => d.cards + d.turns + d.done > 0).map(([k]) => k));
}

export interface Stitch {
  day: string;
  xp: number;
  // 0 (nothing) to 4 (a big day); -1 for a day a freeze covered.
  tone: number;
}

// The last `weeks` weeks, Monday-first columns, ending with this week: the heatmap drawn as cloth.
export function cloth(days: Map<string, DayTally>, frozen: string[], today: string, weeks = 26): Stitch[] {
  const start = addDays(weekOf(today), -7 * (weeks - 1));
  const peak = Math.max(1, ...[...days.values()].map((d) => d.xp));
  const out: Stitch[] = [];
  for (let day = start; out.length < weeks * 7; day = addDays(day, 1)) {
    const xp = day > today ? 0 : (days.get(day)?.xp ?? 0);
    const tone = frozen.includes(day) ? -1 : xp === 0 ? 0 : Math.min(4, Math.ceil((xp / peak) * 4));
    out.push({ day, xp, tone });
  }
  return out;
}

export interface Records {
  // The day you started the most cards, and how many.
  biggestDay: { day: string; cards: number } | null;
  mostShipped: { day: string; done: number } | null;
  maxRunning: number;
  // Fastest card from created to Done, in ms. Under a minute is an imported session, not a real ship.
  fastest: number | null;
  // Cheapest shipped card that cost anything, in USD.
  cheapest: number | null;
}

export const MIN_SHIP_MS = 60_000;

function best<T>(items: T[], score: (t: T) => number): T | null {
  return items.reduce<T | null>((a, b) => (a === null || score(b) > score(a) ? b : a), null);
}

export function records(events: ActivityEvent[], days: Map<string, DayTally>): Records {
  const list = [...days].map(([day, d]) => ({ day, ...d }));
  const big = best(list, (d) => d.cards);
  const shipped = best(list, (d) => d.done);
  const created = new Map(events.filter((e) => e.kind === "created").map((e) => [e.card, e.at]));
  const done = events.filter((e) => e.kind === "done");
  // A backfilled Done ("done:<card>") is dated by the card's last change, so only live ones time a ship.
  const spans = done.filter((e) => !e.id.startsWith("done:")).flatMap((e) => {
    const start = created.get(e.card);
    return start !== undefined && e.at - start >= MIN_SHIP_MS ? [e.at - start] : [];
  });
  const costs = done.flatMap((e) => (e.cost && e.cost > 0 ? [e.cost] : []));
  return {
    biggestDay: big && big.cards > 0 ? { day: big.day, cards: big.cards } : null,
    mostShipped: shipped && shipped.done > 0 ? { day: shipped.day, done: shipped.done } : null,
    maxRunning: Math.max(0, ...events.map((e) => e.running ?? 0)),
    fastest: spans.length ? Math.min(...spans) : null,
    cheapest: costs.length ? Math.min(...costs) : null,
  };
}

function weekSum(days: Map<string, DayTally>, today: string, key: "xp" | "done"): number {
  const monday = weekOf(today);
  return [...days].filter(([day]) => day >= monday && day <= today).reduce((n, [, d]) => n + d[key], 0);
}

// XP earned this week so far: the score your league ranks you by.
export const weekXp = (days: Map<string, DayTally>, today: string) => weekSum(days, today, "xp");

// Cards shipped this week so far, shown beside your XP in the league.
export const weekShipped = (days: Map<string, DayTally>, today: string) => weekSum(days, today, "done");

// The league ladder, lowest first (lib/league.ts, supabase/migrations/20261017162000_leagues.sql).
export const LEAGUES = ["Cotton", "Linen", "Wool", "Silk", "Cashmere", "Gold Thread"] as const;
