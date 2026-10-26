import type { Card, LimitWindow, ScheduledMessage } from "./types";

// Sent this long after a window resets, so the message lands in the new window.
export const RESET_GRACE_MS = 60_000;

// The weekly window counts as close to blocking from this share used (0-100); at 100 it is blocking.
export const WEEKLY_NEAR = 90;

// The latest window still ahead that a Claude thread has seen, for one of the plan's limits.
// Every future reset is the same window's, so the latest one is the safest to trust; its share used
// is the highest any thread saw, the freshest reading.
function latestWindow(cards: Card[], pick: (card: Card) => LimitWindow | undefined, now: number) {
  let best: { at: number; used: number } | undefined;
  for (const card of cards) {
    if (card.backend !== "claude") continue;
    const window = pick(card);
    if (!window?.resetsAt) continue;
    const at = window.resetsAt * 1000;
    if (at <= now) continue;
    if (!best || at > best.at) best = { at, used: window.used };
    else if (at === best.at) best.used = Math.max(best.used, window.used);
  }
  return best;
}

// When the plan's 5-hour window resets (unix ms), if a Claude thread has seen one that's still ahead.
export function nextFiveHourReset(cards: Card[], now = Date.now()): number | undefined {
  return latestWindow(cards, (card) => card.stats?.fiveHour, now)?.at;
}

// When the plan's weekly window resets (unix ms) and how much of it is used (0-100), if known.
export function nextWeeklyReset(cards: Card[], now = Date.now()): { at: number; used: number } | undefined {
  return latestWindow(cards, (card) => card.stats?.sevenDay, now);
}

// The plan's next resets the reply box offers to send at.
export interface PlanResets {
  fiveHour?: number;
  weekly?: { at: number; used: number };
}

export function planResets(cards: Card[], now = Date.now()): PlanResets {
  return { fiveHour: nextFiveHourReset(cards, now), weekly: nextWeeklyReset(cards, now) };
}

export interface SendLaterOption {
  label: string;
  at: number;
}

// The times the reply box offers, the default first. On a Claude thread (puku has no plan limit):
// the next 5-hour reset, and the weekly reset when that window is used up or close to it; a used-up
// weekly window goes first, since sending at the 5-hour reset would only hit it again. Then an hour
// from now, then tomorrow morning.
export function sendLaterOptions(backend: Card["backend"], resets: PlanResets, now = Date.now()): SendLaterOption[] {
  const options: SendLaterOption[] = [];
  if (backend === "claude") {
    const { fiveHour, weekly } = resets;
    const fiveHourOption = fiveHour && { label: "At the 5-hour reset", at: fiveHour + RESET_GRACE_MS };
    const weeklyOption = weekly && weekly.used >= WEEKLY_NEAR && { label: "At the weekly reset", at: weekly.at + RESET_GRACE_MS };
    const order = weekly && weekly.used >= 100 ? [weeklyOption, fiveHourOption] : [fiveHourOption, weeklyOption];
    for (const option of order) if (option) options.push(option);
  }
  options.push({ label: "In 1 hour", at: now + 3600_000 });
  const morning = new Date(now);
  morning.setDate(morning.getDate() + 1);
  morning.setHours(9, 0, 0, 0);
  options.push({ label: "Tomorrow morning", at: morning.getTime() });
  return options;
}

// The card's scheduled messages with this one added, soonest first.
export function addScheduled(list: ScheduledMessage[] | undefined, message: ScheduledMessage): ScheduledMessage[] {
  return [...(list ?? []), message].sort((a, b) => a.at - b.at);
}

// The message whose time has come, if any (the soonest). A message held for a free slot isn't timed: it goes when
// one frees (lib/thread-slots.ts), not when the scheduler finds it due.
export function dueMessage(card: Card, now = Date.now()): ScheduledMessage | undefined {
  const first = card.scheduled?.find((m) => !m.forSlot);
  return first && first.at <= now ? first : undefined;
}

// When a scheduled message goes, as its chip says it: "after restart", "after this turn" or its time.
export function sendsWhen(m: ScheduledMessage, now = Date.now()) {
  if (m.afterRestart) return "after restart";
  if (m.forSlot) return "when a slot frees";
  return m.afterTurn ? "after this turn" : formatAt(m.at, now);
}

// "11:41pm", or "sat 9:00am" when it isn't today.
export function formatAt(at: number, now = Date.now()) {
  const d = new Date(at);
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).replace(" ", "").toLowerCase();
  const today = d.toDateString() === new Date(now).toDateString();
  return today ? time : `${d.toLocaleDateString("en-US", { weekday: "short" }).toLowerCase()} ${time}`;
}

// The value a datetime-local input wants for a time: "2026-10-10T23:41", in local time.
export function toLocalInput(at: number) {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
