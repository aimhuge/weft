// Crons in the list view (docs/architecture/crons.md): the ⏰ badge a row carries. A cron's run says which run it
// is; the card its runs fold under (the forked thread, or a fresh cron's first run) says when the next run is, or
// that the cron is off. Runs already nest under that card (lib/list-tree.ts), and "⏰ cron" is a value in the Tags
// filter (lib/list-sheet.ts), so the sheet can be cut down to the crons and the threads they come from. Pure.
import { describeCron } from "./cron-schedule";
import type { Cron } from "./cron-types";
import { sortCrons } from "./crons-view";
import { matches } from "@aimhuge/sheet";
import type { Card } from "./types";

export interface CronBadge {
  text: string;
  tip: string;
  // A cron that won't run again: switched off, or past its end.
  off?: boolean;
}

// "in 5m", "in 3h", "in 2d": how long until the next run.
export function untilNext(at: number, now: number): string {
  const m = Math.max(1, Math.round((at - now) / 60_000));
  if (m < 60) return `in ${m}m`;
  const h = Math.round(m / 60);
  return h < 48 ? `in ${h}h` : `in ${Math.round(h / 24)}d`;
}

// The crons whose runs fold under this card: the ones forked from it, or a fresh cron whose first run it is.
export function cronsHeldBy(card: Card, crons: readonly Cron[]): Cron[] {
  return crons.filter((c) => (c.sourceId ? c.sourceId === card.id : card.cronId === c.id && card.cronOf === card.id));
}

export function cronBadge(card: Card, crons: readonly Cron[], now: number): CronBadge | null {
  const held = cronsHeldBy(card, crons);
  if (held.length) {
    // The one that runs soonest speaks for the card; the tip lists them all.
    const soonest = held.flatMap((c) => (c.enabled && c.nextAt !== undefined ? [c.nextAt] : [])).sort((a, b) => a - b);
    const tip = held.map((c) => `${c.name}: ${describeCron(c.expr)}, ${c.count} ${c.count === 1 ? "run" : "runs"}${c.enabled ? "" : " (off)"}`).join("\n");
    const next = soonest.at(0);
    return next !== undefined ? { text: `next ${untilNext(next, now)}`, tip } : { text: "off", tip, off: true };
  }
  if (card.cronId && card.cronRun !== undefined) {
    const cron = crons.find((c) => c.id === card.cronId);
    return { text: `run ${card.cronRun}`, tip: cron ? `Run ${card.cronRun} of “${cron.name}”` : `Run ${card.cronRun} of a cron` };
  }
  return null;
}

export interface CronRow {
  cron: Cron;
  // Its runs' cards still on the board, newest first.
  runs: Card[];
}

// The ⏰ Crons band at the sheet's foot: every cron whose name has the words of the title search, the ones that
// will run soonest first, then the ones that are off, each with the cards its runs made.
export function cronRows(crons: readonly Cron[], cards: readonly Card[], query: string): CronRow[] {
  return sortCrons(crons)
    .filter((cron) => matches(cron.name, query))
    .map((cron) => ({
      cron,
      runs: cards.filter((c) => c.cronId === cron.id).sort((a, b) => (b.cronRun ?? 0) - (a.cronRun ?? 0)),
    }));
}
