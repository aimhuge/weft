// The Limits badges: ladders for how many times you ran each plan window dry, how fast you burned one,
// and how often in a row. Pure; lib/game-badges.ts files them under "Limits".
// "Burn" is how long a window lasted: from when it opened (its reset minus its length) to the hit.
import type { Badge } from "./game-badges";
import { WINDOW_MS, type LimitHit, type LimitKind } from "./usage";

type Result = Pick<Badge, "unlocked" | "at" | "have" | "need">;
export interface LimitDef {
  id: string;
  icon: string;
  name: string;
  desc: string;
  test: (hits: LimitHit[]) => Result;
}

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// What one wall-clock time in a time zone is in UTC ms; an unknown zone reads as the Mac's own.
export function zonedTime(y: number, mo: number, d: number, h: number, mi: number, zone?: string): number {
  const guess = Date.UTC(y, mo, d, h, mi);
  if (!zone) return new Date(y, mo, d, h, mi).getTime();
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric",
    }).formatToParts(guess);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const shown = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
    return guess - (shown - guess);
  } catch {
    return new Date(y, mo, d, h, mi).getTime();
  }
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

// When a limit message's reset falls: an epoch ("1729…"), or "4:10am (Asia/Bangkok)" / "Oct 20, 9pm (…)",
// taken as the first such moment after the hit.
export function resetTime(reset: string, at: number): number | undefined {
  if (/^\d{10}$/.test(reset)) return Number(reset) * 1000;
  const m = /^(?:([A-Za-z]{3})[a-z]* (\d{1,2}),? )?(\d{1,2})(?::(\d{2}))? ?([ap]m)(?: \(([^)]+)\))?$/i.exec(reset.trim());
  if (!m) return undefined;
  const [, mon, day, hh, mm, ampm, zone] = m;
  const hour = (Number(hh) % 12) + (ampm?.toLowerCase() === "pm" ? 12 : 0);
  const month = mon ? MONTHS.indexOf(mon.toLowerCase()) : -1;
  if (mon && month < 0) return undefined;
  const from = new Date(at - DAY);
  const tries = mon
    ? [0, 1].map((i) => zonedTime(from.getFullYear() + i, month, Number(day), hour, Number(mm ?? 0), zone))
    : [0, 1, 2].map((i) => zonedTime(from.getFullYear(), from.getMonth(), from.getDate() + i, hour, Number(mm ?? 0), zone));
  return tries.find((t) => t > at);
}

// A hit a live Weft thread logged: its id carries the reset the CLI gave (lib/activity.ts recordLimit),
// in seconds from the SDK, or ms.
export function liveHit(id: string, at: number, kind: LimitKind): LimitHit {
  const n = Number(/^limit:[a-z_]+:(\d+(?:\.\d+)?)$/.exec(id)?.[1] ?? NaN);
  return Number.isFinite(n) ? { at, kind, resetAt: n < 1e12 ? n * 1000 : n } : { at, kind };
}

// How long the window lasted before this hit, when its reset is known and makes sense (inside one window).
export function burnMs(hit: LimitHit): number | undefined {
  const reset = hit.resetAt ?? (hit.reset ? resetTime(hit.reset, hit.at) : undefined);
  if (reset === undefined) return undefined;
  const burn = hit.at - (reset - WINDOW_MS[hit.kind]);
  return burn > 0 && burn <= WINDOW_MS[hit.kind] ? burn : undefined;
}

// Your fastest burn of a window: how long it lasted and when.
export function fastestBurn(hits: LimitHit[], kind: LimitKind): { ms: number; at: number } | undefined {
  let best: { ms: number; at: number } | undefined;
  for (const h of hits) {
    if (h.kind !== kind) continue;
    const ms = burnMs(h);
    if (ms !== undefined && (!best || ms < best.ms)) best = { ms, at: h.at };
  }
  return best;
}

const ofKind = (hits: LimitHit[], kind: LimitKind) => hits.filter((h) => h.kind === kind).sort((a, b) => a.at - b.at);

// The nth hit of a window: unlocked at n, dated by the nth.
function nthHit(kind: LimitKind, n: number) {
  return (hits: LimitHit[]): Result => {
    const list = ofKind(hits, kind);
    return { unlocked: list.length >= n, at: list[n - 1]?.at, have: Math.min(list.length, n), need: n };
  };
}

// The first window burned in under `ms`.
function burnedWithin(kind: LimitKind, ms: number) {
  return (hits: LimitHit[]): Result => {
    const hit = ofKind(hits, kind).find((h) => (burnMs(h) ?? Infinity) < ms);
    return { unlocked: !!hit, at: hit?.at };
  };
}

const dayOf = (at: number) => new Date(at).toDateString();

// n 5-hour limits on one local day, dated by the nth.
function inOneDay(n: number) {
  return (hits: LimitHit[]): Result => {
    const byDay = new Map<string, number[]>();
    for (const h of ofKind(hits, "five_hour")) byDay.set(dayOf(h.at), [...(byDay.get(dayOf(h.at)) ?? []), h.at]);
    const at = [...byDay.values()].flatMap((list) => list.slice(n - 1, n)).sort((a, b) => a - b)[0];
    return { unlocked: at !== undefined, at };
  };
}

// A 5-hour limit on n days in a row, dated by the day the run reached n.
function daysInARow(n: number) {
  return (hits: LimitHit[]): Result => {
    const firsts = new Map<string, number>();
    for (const h of ofKind(hits, "five_hour")) if (!firsts.has(dayOf(h.at))) firsts.set(dayOf(h.at), h.at);
    let run = 0;
    let best = 0;
    let prev = "";
    for (const [day, at] of firsts) {
      const d = new Date(at);
      run = prev === new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1).toDateString() ? run + 1 : 1;
      best = Math.max(best, run);
      prev = day;
      if (run >= n) return { unlocked: true, at, have: n, need: n };
    }
    return { unlocked: false, have: best, need: n };
  };
}

// Both windows hit within a day of each other.
const doubleDip = (hits: LimitHit[]): Result => {
  const weekly = ofKind(hits, "seven_day");
  const hit = ofKind(hits, "five_hour").find((h) => weekly.some((w) => Math.abs(w.at - h.at) < DAY));
  const pair = hit && weekly.find((w) => Math.abs(w.at - hit.at) < DAY);
  return { unlocked: !!hit, at: hit && pair ? Math.max(hit.at, pair.at) : undefined };
};

export const LIMIT_LADDER = [1, 2, 5, 10, 20, 50, 100, 250, 500, 1000];

// [count, icon, name] per rung. The first rungs keep their old ids (limit-5h, limit-7d), so nobody's
// earned badge pops up again.
const FIVE: [number, string, string][] = [
  [1, "⏳", "Hit the ceiling"], [2, "🔁", "Back for more"], [5, "🖐️", "High five"], [10, "🧱", "Wall climber"],
  [20, "🪜", "Ceiling regular"], [50, "🌀", "Limit lifer"], [100, "💯", "Century of ceilings"],
  [250, "🏗️", "Load-bearing"], [500, "🛰️", "Escape velocity"], [1000, "👑", "Thousand ceilings"],
];
const WEEK: [number, string, string][] = [
  [1, "🗓️", "Ran the week dry"], [2, "📆", "Dry spell"], [5, "🏜️", "Desert run"], [10, "🐪", "Camel"],
  [20, "🌵", "Cactus"], [50, "☀️", "Year of drought"], [100, "🏺", "Dust bowl"], [250, "🦴", "Fossil"],
  [500, "🪐", "Decade dry"], [1000, "♾️", "Eternal drought"],
];

const times = (n: number) => (n === 1 ? "" : n === 2 ? " twice" : ` ${n.toLocaleString("en-US")} times`);
const rung = (kind: LimitKind, n: number) => `limit-${kind === "five_hour" ? "5h" : "7d"}${n === 1 ? "" : `-${n}`}`;

export const LIMIT_DEFS: LimitDef[] = [
  ...FIVE.map(([n, icon, name]) => ({ id: rung("five_hour", n), icon, name, desc: `Use up your 5-hour plan limit${times(n)}`, test: nthHit("five_hour", n) })),
  ...WEEK.map(([n, icon, name]) => ({ id: rung("seven_day", n), icon, name, desc: `Use up your weekly plan limit${times(n)}`, test: nthHit("seven_day", n) })),
  { id: "burn-5h-2h", icon: "🏎️", name: "Redline", desc: "Burn a 5-hour limit in under 2 hours", test: burnedWithin("five_hour", 2 * HOUR) },
  { id: "burn-5h-1h", icon: "🚀", name: "Afterburner", desc: "Burn a 5-hour limit in under an hour", test: burnedWithin("five_hour", HOUR) },
  { id: "burn-5h-30m", icon: "⚡", name: "Speedrun", desc: "Burn a 5-hour limit in under 30 minutes", test: burnedWithin("five_hour", 30 * MIN) },
  { id: "burn-5h-15m", icon: "☢️", name: "Meltdown", desc: "Burn a 5-hour limit in under 15 minutes", test: burnedWithin("five_hour", 15 * MIN) },
  { id: "burn-7d-3d", icon: "🌪️", name: "Long weekend", desc: "Burn a weekly limit in under 3 days", test: burnedWithin("seven_day", 3 * DAY) },
  { id: "burn-7d-1d", icon: "☄️", name: "Week in a day", desc: "Burn a weekly limit in under 24 hours", test: burnedWithin("seven_day", DAY) },
  { id: "limit-day-2", icon: "✌️", name: "Double shift", desc: "Hit your 5-hour limit twice in one day", test: inOneDay(2) },
  { id: "limit-day-3", icon: "🎩", name: "Hat trick", desc: "Hit your 5-hour limit three times in one day", test: inOneDay(3) },
  { id: "limit-day-4", icon: "🌗", name: "Round the clock", desc: "Hit your 5-hour limit four times in one day", test: inOneDay(4) },
  { id: "limit-row-3", icon: "📈", name: "Three-peat", desc: "Hit your 5-hour limit 3 days in a row", test: daysInARow(3) },
  { id: "limit-row-7", icon: "🗞️", name: "Every single day", desc: "Hit your 5-hour limit 7 days in a row", test: daysInARow(7) },
  { id: "limit-double", icon: "🥢", name: "Double dip", desc: "Hit your 5-hour and weekly limits within a day", test: doubleDip },
];
