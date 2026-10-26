import { describeCron } from "./cron-schedule";
import type { Cron, CronRun } from "./cron-types";
import type { Card } from "./types";

// How the rail's ⏰ Crons drawer reads (components/CronsDrawer.tsx). Pure, so it's testable and safe in the browser.

// The ones that will run, soonest first, then the ones turned off or finished.
export function sortCrons(crons: readonly Cron[]): Cron[] {
  return [...crons].sort((a, b) => (a.nextAt ?? Infinity) - (b.nextAt ?? Infinity) || a.name.localeCompare(b.name));
}

// Whether a cron will run again: it's on, and it has a next run ahead of it. A cron past its end has
// no next run, so it counts as off however it is switched.
export function isLiveCron(cron: Cron): boolean {
  return cron.enabled && cron.nextAt !== undefined;
}

// The rail's count: crons that will run again.
export function activeCount(crons: readonly Cron[]): number {
  return crons.filter(isLiveCron).length;
}

export function cronsTitle(crons: readonly Cron[]): string {
  const on = activeCount(crons);
  if (!crons.length) return "Crons: run a thread again on a schedule (⏰ in a thread's header)";
  return `Crons: ${on} on${crons.length > on ? `, ${crons.length - on} off` : ""}`;
}

export type RunTone = "running" | "needs_you" | "review" | "done" | "failed" | "gone";

// A run's dot: what its card is doing now, or that it failed to start or was deleted.
export function runTone(run: CronRun, cards: readonly Pick<Card, "id" | "column" | "error">[]): RunTone {
  if (run.error) return "failed";
  const card = cards.find((c) => c.id === run.cardId);
  if (!card) return "gone";
  if (card.error) return "failed";
  if (card.column === "running") return "running";
  if (card.column === "needs_you") return "needs_you";
  if (card.column === "done") return "done";
  return "review";
}

export const TONE_CLASS: Record<RunTone, string> = {
  running: "bg-[var(--cron)] animate-pulse",
  needs_you: "bg-warn",
  review: "bg-accent",
  done: "bg-ok",
  failed: "bg-danger",
  gone: "bg-line-strong",
};

export const TONE_LABEL: Record<RunTone, string> = {
  running: "running",
  needs_you: "needs you",
  review: "to review",
  done: "done",
  failed: "failed",
  gone: "card deleted",
};

// One line under the cron's name: its schedule, what each run does and who made it.
export function cronSummary(cron: Cron, sourceTitle?: string): string {
  const what = cron.mode === "fork" ? `forks “${sourceTitle ?? cron.name}”` : "fresh thread";
  return `${describeCron(cron.expr)} · ${what}${cron.by === "thread" ? " · made by a thread" : ""}`;
}
