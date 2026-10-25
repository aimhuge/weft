// The Time badges: how fast a card went from idea to Done, how much you turned the loom over, and
// when in the week, month and year you shipped. Pure; the Speed and Calendar badges read live ships
// only (a backfilled Done is dated by the card's last change, so it can't time anything).
import { byDay, createdAt, crossing, DAY, def, first, HOUR, liveShipped, MIN, shipped, type Def, type Result } from "./badge-kit";
import { dayKey, MIN_SHIP_MS, type ActivityEvent } from "./game";
import type { GameFacts } from "./game-badges";

// The card a done event belongs to.
const cardOf = (e: ActivityEvent) => e.card ?? e.id;

// Each live ship's card and how long it took from created to Done, oldest first.
function spans(f: GameFacts): [number, number][] {
  const created = createdAt(f);
  return liveShipped(f).flatMap((e) => {
    const start = e.card ? created.get(e.card) : undefined;
    return start === undefined ? [] : [[e.at - start, e.at] as [number, number]];
  });
}

// The first live ship that took under `ms` from created to Done, ignoring spans under a minute.
const shippedWithin = (ms: number) => (f: GameFacts): Result => {
  const hit = spans(f).filter(([took]) => took >= MIN_SHIP_MS && took < ms).sort((a, b) => a[1] - b[1])[0];
  return { unlocked: hit !== undefined, at: hit?.[1] };
};

// The nth live ship within a window of `ms`, dated by that ship.
function shipsWithinWindow(n: number, ms: number) {
  return (f: GameFacts): Result => {
    const at = liveShipped(f)
      .map((e) => e.at)
      .sort((a, b) => a - b)
      .flatMap((start, i, all) => {
        const nth = all[i + n - 1];
        return nth !== undefined && nth - start < ms ? [nth] : [];
      })[0];
    return { unlocked: at !== undefined, at };
  };
}

// Each card's first live ship, when it was made and shipped the same local day.
function sameDayCards(f: GameFacts): ActivityEvent[] {
  const created = createdAt(f);
  return liveShipped(f).filter((e) => {
    const start = e.card ? created.get(e.card) : undefined;
    return start !== undefined && dayKey(start) === dayKey(e.at);
  });
}

// The nth card made and shipped on the same local day, dated by that ship.
const sameDayShip = (n: number) => (f: GameFacts): Result => {
  const days = [...byDay(sameDayCards(f)).values()];
  const at = days.flatMap((list) => list.slice(n - 1, n).map((e) => e.at)).sort((a, b) => a - b)[0];
  return { unlocked: at !== undefined, at };
};

// The first live ship whose card sat for 30+ days before it shipped.
function betterLate(f: GameFacts): number | undefined {
  const created = createdAt(f);
  return liveShipped(f).find((e) => {
    const start = e.card ? created.get(e.card) : undefined;
    return start !== undefined && e.at - start >= 30 * DAY;
  })?.at;
}

// The nth shipped card, dated by it.
const nthShip = (n: number) => (f: GameFacts): Result => {
  const list = shipped(f).map((e) => e.at).sort((a, b) => a - b);
  return { unlocked: list.length >= n, at: list[n - 1], have: Math.min(list.length, n), need: n };
};

// Each turn event and how many turns it carried.
const turnEvents = (f: GameFacts): [number, number][] =>
  f.events.filter((e) => e.kind === "turn").map((e) => [e.at, e.turns ?? 1] as [number, number]);

// The first card whose turns reach n, dated by the turn event that crossed it.
function cardWithTurns(n: number) {
  return (f: GameFacts): Result => {
    const sums = new Map<string, number>();
    const events = f.events.filter((e) => e.kind === "turn").sort((a, b) => a.at - b.at);
    for (const e of events) {
      const key = cardOf(e);
      const sum = (sums.get(key) ?? 0) + (e.turns ?? 1);
      sums.set(key, sum);
      if (sum >= n) return { unlocked: true, at: e.at, have: n, need: n };
    }
    return { unlocked: false, have: Math.max(0, ...sums.values()), need: n };
  };
}

// The first live ship whose card turned exactly once before it shipped.
function oneShot(f: GameFacts): number | undefined {
  const turns = new Map<string, ActivityEvent[]>();
  for (const t of f.events) if (t.kind === "turn") turns.set(cardOf(t), [...(turns.get(cardOf(t)) ?? []), t]);
  for (const e of liveShipped(f)) {
    const sum = (turns.get(cardOf(e)) ?? []).filter((t) => t.at <= e.at).reduce((n, t) => n + (t.turns ?? 1), 0);
    if (sum === 1) return e.at;
  }
  return undefined;
}

// The first live ship on a Saturday and the Sunday right after it, dated by that Sunday ship.
function weekendWarrior(f: GameFacts): number | undefined {
  const ships = liveShipped(f).map((e) => e.at).sort((a, b) => a - b);
  for (const at of ships) {
    const d = new Date(at);
    if (d.getDay() !== 6) continue;
    const sunday = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
    const hit = ships.find((other) => other >= sunday && other < sunday + DAY);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

// The first live ship on a Friday after 5pm.
const livingDangerously = (f: GameFacts): number | undefined =>
  liveShipped(f).find((e) => {
    const d = new Date(e.at);
    return d.getDay() === 5 && d.getHours() >= 17;
  })?.at;

// The first live ship at 3am.
const witchingHour = (f: GameFacts): number | undefined =>
  liveShipped(f).find((e) => new Date(e.at).getHours() === 3)?.at;

// The first live ship at 3:14 or 15:14 on March 14.
const piDay = (f: GameFacts): number | undefined =>
  liveShipped(f).find((e) => {
    const d = new Date(e.at);
    if (d.getMonth() !== 2 || d.getDate() !== 14) return false;
    return (d.getHours() === 3 && d.getMinutes() === 14) || (d.getHours() === 15 && d.getMinutes() === 14);
  })?.at;

// The first live ship on a fixed month and day.
const onDate = (month: number, day: number) => (f: GameFacts): number | undefined =>
  liveShipped(f).find((e) => {
    const d = new Date(e.at);
    return d.getMonth() === month && d.getDate() === day;
  })?.at;

// The season a month belongs to: Dec-Feb, Mar-May, Jun-Aug, Sep-Nov.
const seasonOf = (month: number) => Math.floor(((month + 1) % 12) / 3);

// The first calendar year with a ship in each of the four seasons, dated by the ship that completed it.
function fourSeasons(f: GameFacts): number | undefined {
  const years = new Map<number, Set<number>>();
  const ships = liveShipped(f).map((e) => e.at).sort((a, b) => a - b);
  for (const at of ships) {
    const d = new Date(at);
    const seasons = years.get(d.getFullYear()) ?? new Set<number>();
    seasons.add(seasonOf(d.getMonth()));
    years.set(d.getFullYear(), seasons);
    if (seasons.size === 4) return at;
  }
  return undefined;
}

// The first event of a local day that reaches 14 hours of span, dated by that event.
function dawnToDusk(f: GameFacts): number | undefined {
  const days = byDay(f.events.filter((e) => e.kind === "created" || e.kind === "turn" || e.kind === "done"));
  for (const list of days.values()) {
    const times = list.map((e) => e.at).sort((a, b) => a - b);
    const first = Math.min(...times);
    const hit = times.find((at) => at - first >= 14 * HOUR);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

export const TIME_DEFS: Def[] = [
  def("Speed", "blink", "👁️", "Blink", "Idea to Done in under 5 minutes", shippedWithin(5 * MIN)),
  def("Speed", "sprinter", "🏃", "Sprinter", "Idea to Done in under 15 minutes", shippedWithin(15 * MIN)),
  def("Speed", "assembly-line", "🏭", "Assembly line", "Ship 10 cards in one hour", shipsWithinWindow(10, HOUR)),
  def("Speed", "same-day", "📬", "Same-day delivery", "Start and ship 20 cards on the same day", sameDayShip(20)),
  def("Speed", "better-late", "🐢", "Better late", "Ship a card that sat 30+ days", first(betterLate)),
  def("Milestones", "shipped-1000", "🌍", "Armada", "Take 1,000 cards to Done", nthShip(1000)),
  def("Milestones", "shipped-2500", "🌌", "Constellation", "Take 2,500 cards to Done", nthShip(2500)),
  def("Milestones", "turns-1k", "🔁", "Thousand turns", "1,000 turns across your threads", crossing(turnEvents, 1000)),
  def("Milestones", "turns-10k", "🔂", "Ten thousand turns", "10,000 turns across your threads", crossing(turnEvents, 10_000)),
  def("Milestones", "turns-100k", "♾️", "Hundred thousand turns", "100,000 turns across your threads", crossing(turnEvents, 100_000)),
  def("Milestones", "marathon", "🧵", "Marathon thread", "One card with 100+ turns", cardWithTurns(100)),
  def("Milestones", "one-shot", "🪡", "One-shot", "Ship a card in a single turn", first(oneShot)),
  def("Calendar", "weekend-warrior", "🏖️", "Weekend warrior", "Ship on a Saturday and the Sunday after it", first(weekendWarrior)),
  def("Calendar", "living-dangerously", "😈", "Living dangerously", "Ship on a Friday after 5pm", first(livingDangerously)),
  def("Calendar", "witching-hour", "🌙", "Witching hour", "Ship a card at 3am", first(witchingHour)),
  def("Calendar", "dawn-to-dusk", "🌅", "Dawn to dusk", "Active across 14 hours of one day", first(dawnToDusk)),
  def("Calendar", "pi-day", "🥧", "Pi day", "Ship at 3:14 on March 14", first(piDay)),
  def("Calendar", "new-year", "🎆", "New Year's ship", "Ship a card on January 1", first(onDate(0, 1))),
  def("Calendar", "spooky", "🎃", "Spooky ship", "Ship a card on Halloween", first(onDate(9, 31))),
  def("Calendar", "holiday-shift", "🎄", "Holiday shift", "Ship a card on December 25", first(onDate(11, 25))),
  def("Calendar", "four-seasons", "🍂", "Four seasons", "Ship in every season of one year", first(fourSeasons)),
  def("Calendar", "leap", "🐸", "Leap of faith", "Ship a card on February 29", first(onDate(1, 29))),
];
