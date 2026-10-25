import type { Backend, CardStats } from "./types";

// The status strip's limits chart (components/LimitBurndown.tsx), worked out from the limit history
// (lib/limit-history.ts): the week from one weekly reset to the next as 672 15-minute slots of the
// 5-hour limit left (4 per hour) and 7 day slots of the weekly limit left, each day with its burn-down
// edge, plus where either limit was hit and where the 5-hour windows and the week reset. In a week's
// first days it reaches back over the last days of the week before. Pure: times in unix ms, shares 0-100.

export type LimitKind = "five_hour" | "seven_day";

// One reading: when (unix ms), which CLI and window, the share used (0-100) and its reset (unix seconds).
export interface LimitSample {
  at: number;
  backend: Backend;
  kind: LimitKind;
  used: number;
  resetsAt?: number;
}

export const HOUR = 60 * 60 * 1000;
export const QUARTER_HOUR = 15 * 60_000;
export const FIVE_HOURS = 5 * HOUR;
export const DAY = 24 * HOUR;
export const WEEK = 7 * DAY;
// Within this long of a weekly reset, the chart also shows the last LOOKBACK_DAYS of the week before.
export const NEW_WEEK = 3 * DAY;
export const LOOKBACK_DAYS = 3;

// A slot's share left: a number, "unknown" (a window was open but nothing was logged, or before the log
// began), or null (the slot hasn't happened yet).
export type Level = number | "unknown" | null;

export interface Slot {
  from: number;
  to: number;
  left: Level;
}

// [time, share left].
export type Point = [number, number];

// A day, with the weekly level at each hour it has seen so far: the top of its bar. past: a day of the
// week before, shown in a new week's first days.
export interface DaySlot extends Slot {
  edge: Point[];
  past?: boolean;
}

// A vertical line: a 5-hour reset (light), the next one (next), the weekly reset (week), or a hit.
export type MarkKind = "light" | "next" | "week" | "hit";

export interface Mark {
  at: number;
  kind: MarkKind;
}

export interface LimitsChart {
  start: number;
  // The weekly reset this week began at; equal to start unless the chart reaches back into last week.
  weekStart: number;
  end: number;
  now: number;
  hours: Slot[];
  days: DaySlot[];
  marks: Mark[];
  // The 5-hour window open at now: the share left in it and when it opened and resets. Undefined when
  // nothing is known about the window (no reading yet, or its reset has passed).
  fiveHourNow?: { left: number; from: number; to: number };
}

// A reset in unix ms, to the minute: the CLI reports one reset a few hundred ms apart from call to call.
export function resetMs(resetsAt?: number): number | undefined {
  return resetsAt === undefined ? undefined : Math.round(resetsAt / 60) * 60_000;
}

// The weekly reset after now: the latest one known, rolled on a week at a time when it has passed.
export function weekEnd(rows: LimitSample[], stats: CardStats, now: number): number | undefined {
  let end = resetMs(stats.sevenDay?.resetsAt) ?? resetMs(rows.findLast((s) => s.kind === "seven_day" && s.resetsAt)?.resetsAt);
  if (end === undefined) return undefined;
  while (end <= now) end += WEEK;
  return end;
}

// The share left in a window from its used share: 0-100, never below 0.
export function shareLeft(used: number): number {
  return Math.max(0, 100 - used);
}

// The share left at time t: the last reading at or before it, back to full once its window has reset. A
// 5-hour window that had opened by t (a later reading's reset minus 5 hours) with nothing logged is unknown.
export function leftAt(rows: LimitSample[], kind: LimitKind, t: number): number | "unknown" {
  const last = rows.findLast((r) => r.kind === kind && r.at <= t);
  if (!last) return "unknown";
  const reset = resetMs(last.resetsAt);
  if (reset === undefined || reset > t) return shareLeft(last.used);
  const next = rows.find((r) => r.kind === kind && r.at > t && r.resetsAt !== undefined);
  const opened = next && (resetMs(next.resetsAt) ?? 0) - FIVE_HOURS <= t;
  return kind === "five_hour" && opened ? "unknown" : 100;
}

// n equal slots from start; a slot reads its level at its end, or at now while it's running.
function slots(rows: LimitSample[], kind: LimitKind, start: number, size: number, n: number, now: number): Slot[] {
  return Array.from({ length: n }, (_, i) => {
    const from = start + i * size;
    const to = from + size;
    return { from, to, left: from >= now ? null : leftAt(rows, kind, to > now ? now : to - 1) };
  });
}

// The day's weekly level at each hour it has seen, and at its end or now: the burn-down top of its bar.
function dayEdge(rows: LimitSample[], day: Slot, now: number): Point[] {
  const out: Point[] = [];
  const last = Math.min(day.to - 1, now);
  for (let t = day.from; t <= last; t += HOUR) {
    const left = leftAt(rows, "seven_day", t);
    if (left !== "unknown") out.push([t, left]);
  }
  const end = leftAt(rows, "seven_day", last);
  if (end !== "unknown") out.push([last, end]);
  return out;
}

// Where a window ran out: its first reading at 100% used.
export function hitMarks(rows: LimitSample[]): Mark[] {
  const seen = new Set<string>();
  const out: Mark[] = [];
  for (const s of rows) {
    const id = `${s.kind}:${resetMs(s.resetsAt) ?? ""}`;
    if (s.used < 100 || seen.has(id)) continue;
    seen.add(id);
    out.push({ at: s.at, kind: "hit" });
  }
  return out;
}

// The green lines: every past 5-hour reset the history saw, the next one, every 5 hours after it to the
// week's end, and the week's end itself (and its start, when the chart reaches back past it). A line
// within half an hour of one already drawn is dropped.
export function resetMarks(rows: LimitSample[], next: number | undefined, start: number, end: number, now: number, weekStart = start): Mark[] {
  const out: Mark[] = [];
  const add = (at: number, kind: MarkKind) => {
    if (at < start || at > end || out.some((m) => Math.abs(m.at - at) < 30 * 60 * 1000)) return;
    out.push({ at, kind });
  };
  add(end, "week");
  if (weekStart > start) add(weekStart, "week");
  if (next !== undefined && next > now) {
    add(next, "next");
    for (let at = next + FIVE_HOURS; at < end; at += FIVE_HOURS) add(at, "light");
  }
  for (const s of rows) {
    const r = resetMs(s.resetsAt);
    if (s.kind === "five_hour" && r !== undefined && r <= now) add(r, "light");
  }
  return out.sort((a, b) => a.at - b.at);
}

// Whether a card's window adds to the history. A card's stats can be hours old: a window that has
// already reset, or one older than the history's latest, is left out, and so is a repeat of the latest.
function addsReading(w: CardStats["fiveHour"], last: LimitSample | undefined, now: number): w is NonNullable<CardStats["fiveHour"]> {
  if (!w) return false;
  const reset = resetMs(w.resetsAt);
  const lastReset = resetMs(last?.resetsAt);
  if (reset !== undefined && (reset <= now || (lastReset ?? 0) > reset)) return false;
  return !last || last.used !== w.used || lastReset !== reset;
}

// The card's current windows as readings at now, when they add anything to the history.
//
// The reading is the card's own, so it carries the card's CLI's name. It used to fall back to "claude"
// when the history had no reading of that kind yet, which put a puku card's reading under Claude's
// name — the very mislabeling docs/bug-fixes/031-puku-cards-showed-claudes-limits.md is about.
export function withCurrent(rows: LimitSample[], stats: CardStats, now: number, backend: Backend): LimitSample[] {
  const out = rows.filter((s) => s.at <= now).sort((a, b) => a.at - b.at);
  const windows: [LimitKind, CardStats["fiveHour"]][] = [["five_hour", stats.fiveHour], ["seven_day", stats.sevenDay]];
  for (const [kind, w] of windows) {
    const last = out.findLast((s) => s.kind === kind);
    if (!addsReading(w, last, now)) continue;
    out.push({ at: now, backend, kind, used: w.used, ...(w.resetsAt !== undefined && { resetsAt: w.resetsAt }) });
  }
  return out;
}

// The 5-hour window open at now: the share left in it, when it opened (five hours before its reset)
// and when it resets. The card's own window is the reading when it has that same reset; else the
// history's last reading, held while its window is open. Undefined when neither is known, and when the
// window's reset has passed (it is full again, and the next reset isn't known yet).
export function fiveHourNow(rows: LimitSample[], stats: CardStats, now: number): LimitsChart["fiveHourNow"] {
  const last = rows.findLast((r) => r.kind === "five_hour");
  const reset = resetMs(stats.fiveHour?.resetsAt) ?? resetMs(last?.resetsAt);
  if (reset === undefined) return undefined;
  // A window whose reset has passed is full again: the header reads it as 100% and so must the plot.
  if (reset <= now) return undefined;
  const card = stats.fiveHour;
  const fromHistory = leftAt(rows, "five_hour", now);
  const level = card && resetMs(card.resetsAt) === reset ? shareLeft(card.used) : fromHistory;
  if (level === "unknown") return undefined;
  // The window it sits in: five hours of usage, ending at its reset.
  return { left: level, from: reset - FIVE_HOURS, to: reset };
}

// The whole chart for the CLI's own history and a card's latest windows. Without a known weekly reset,
// the week is the 7 days ending a 5-hour window from now. In a week's first NEW_WEEK, with history from
// before its reset, it starts LOOKBACK_DAYS earlier so the week before's last days stay in view.
//
// The history is the plan's own (lib/plan-pools.ts): each CLI has its own plan, so the chart draws that
// CLI's readings and no other plan's.
export function limitsChart(samples: LimitSample[], stats: CardStats, now: number, backend: Backend = "claude"): LimitsChart {
  const rows = withCurrent(samples, stats, now, backend);
  const end = weekEnd(rows, stats, now) ?? now + FIVE_HOURS;
  const weekStart = end - WEEK;
  const back = now - weekStart < NEW_WEEK && rows.some((s) => s.at < weekStart) ? LOOKBACK_DAYS : 0;
  const start = weekStart - back * DAY;
  const span = end - start;
  const days = slots(rows, "seven_day", start, DAY, span / DAY, now).map((d): DaySlot => ({
    ...d,
    edge: d.left === null ? [] : dayEdge(rows, d, now),
    ...(d.from < weekStart && { past: true }),
  }));
  const next = resetMs(stats.fiveHour?.resetsAt) ?? resetMs(rows.findLast((s) => s.kind === "five_hour")?.resetsAt);
  const shown = rows.filter((s) => s.at >= start);
  return {
    start,
    weekStart,
    end,
    now,
    hours: slots(rows, "five_hour", start, QUARTER_HOUR, span / QUARTER_HOUR, now),
    days,
    marks: [...resetMarks(shown, next, start, end, now, weekStart), ...hitMarks(shown)],
    fiveHourNow: fiveHourNow(rows, stats, now),
  };
}
