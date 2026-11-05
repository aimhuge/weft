import { cronFor, describeCron, nextRuns, parseCron, presetOf, type CronPick } from "./cron-schedule";
import type { Cron, CronInput, CronMode } from "./cron-types";

// The ⏰ popover's state and what it sends (components/CronPopover.tsx): the repeat preset, the time and days, a
// start date on the mini calendar and an optional end date. Pure, so the popover stays a thin view.

export interface CronForm {
  prompt: string;
  mode: CronMode;
  pick: CronPick;
  // Local midnight of the first day it may run.
  start: number;
  // Local midnight of the last day it may run, or none.
  end?: number;
}

export const PRESETS: { id: CronPick["preset"]; label: string }[] = [
  { id: "hourly", label: "Hourly" },
  { id: "daily", label: "Daily" },
  { id: "weekdays", label: "Weekdays" },
  { id: "weekly", label: "Weekly" },
  { id: "monthly", label: "Monthly" },
  { id: "custom", label: "Custom…" },
];

export const DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];

export function midnight(at: number): number {
  const d = new Date(at);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

// A new cron starts on weekdays at 9:00, from today, with the message it repeats.
export function newForm(prompt: string, mode: CronMode, now = Date.now()): CronForm {
  return { prompt, mode, pick: { preset: "weekdays", hour: 9, minute: 0, days: [1], dom: new Date(now).getDate() }, start: midnight(now) };
}

// An existing cron, opened to edit.
export function formOf(cron: Pick<Cron, "prompt" | "mode" | "expr" | "startsAt" | "endsAt" | "createdAt">): CronForm {
  return { prompt: cron.prompt, mode: cron.mode, pick: presetOf(cron.expr), start: midnight(cron.startsAt ?? cron.createdAt), ...(cron.endsAt ? { end: midnight(cron.endsAt) } : {}) };
}

// "09:30" from the time input.
export function withTime(pick: CronPick, value: string): CronPick {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value);
  return m ? { ...pick, hour: Math.min(23, Number(m[1])), minute: Math.min(59, Number(m[2])) } : pick;
}

export function timeValue(pick: CronPick): string {
  return `${String(pick.hour).padStart(2, "0")}:${String(pick.minute).padStart(2, "0")}`;
}

export function toggleDay(pick: CronPick, day: number): CronPick {
  const days = pick.days.includes(day) ? pick.days.filter((d) => d !== day) : [...pick.days, day].sort();
  return { ...pick, days: days.length ? days : pick.days };
}

// The cron string, or why it can't be one yet (a Custom field mid-typing).
export function exprOf(form: CronForm): { expr: string; error?: string } {
  const expr = cronFor(form.pick);
  try {
    parseCron(expr);
    return { expr };
  } catch (err) {
    return { expr, error: (err as Error).message };
  }
}

// The runs to come, from the start date on and up to the end date: the "Next:" line and the calendar's dots.
export function upcoming(form: CronForm, now: number, count: number): number[] {
  const { expr, error } = exprOf(form);
  if (error) return [];
  const runs = nextRuns(expr, Math.max(now, form.start - 60_000), count);
  const end = form.end;
  return end === undefined ? runs : runs.filter((at) => at < end + 86_400_000);
}

export function readback(form: CronForm): string {
  const { expr, error } = exprOf(form);
  return error ?? describeCron(expr);
}

// What the popover sends, or an error to show instead.
export function inputOf(form: CronForm, base: Partial<CronInput>, now = Date.now()): CronInput | { error: string } {
  const prompt = form.prompt.trim();
  if (!prompt) return { error: "Write what each run should do." };
  const { expr, error } = exprOf(form);
  if (error) return { error };
  if (form.end !== undefined && form.end < form.start) return { error: "It ends before it starts." };
  return {
    ...base,
    prompt,
    expr,
    mode: form.mode,
    ...(form.start > midnight(now) ? { startsAt: form.start } : {}),
    // The whole last day counts.
    ...(form.end !== undefined ? { endsAt: form.end + 86_400_000 - 1 } : {}),
  };
}

// The mini calendar's weeks for a month, Monday first, as local-midnight times (null pads the first and last week).
export function monthGrid(year: number, month: number): (number | null)[][] {
  const first = new Date(year, month, 1);
  const days = new Date(year, month + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7;
  const cells: (number | null)[] = [...Array<null>(lead).fill(null), ...Array.from({ length: days }, (_, i) => new Date(year, month, i + 1).getTime())];
  while (cells.length % 7) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
}

export function sameDay(a: number, b: number): boolean {
  return midnight(a) === midnight(b);
}

// "Tue 27 Oct, 9:00" for the Next: line and the drawer.
export function runLabel(at: number, now = Date.now()): string {
  const d = new Date(at);
  const time = `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (sameDay(at, now)) return `today ${time}`;
  if (sameDay(at, now + 86_400_000)) return `tomorrow ${time}`;
  return `${d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}, ${time}`;
}

// "in 5m", "in 3h", "in 2d": how long until the next run. The board's crons say it this way; the
// list view's ⏰ badge and the Crons band in the sheet use it, and the drawer says runLabel's way.
export function untilNext(at: number, now: number): string {
  const m = Math.max(1, Math.round((at - now) / 60_000));
  if (m < 60) return `in ${m}m`;
  const h = Math.round(m / 60);
  return h < 48 ? `in ${h}h` : `in ${Math.round(h / 24)}d`;
}
