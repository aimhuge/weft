// What every badge family module builds on: the Def shape lib/game-badges.ts merges into its list,
// and the small counting helpers they share. Pure.
import { dayKey, type ActivityEvent } from "./game";
import type { Badge, BadgeGroup, GameFacts } from "./game-badges";

export type Result = Pick<Badge, "unlocked" | "at" | "have" | "need">;
export type Def = Omit<Badge, keyof Result> & { test: (f: GameFacts) => Result };

export const MIN = 60 * 1000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

// Cards a refactor scout finding starts ("Long Function: Board.tsx") or that say they refactor.
export function isRefactor(title = "") {
  return /refactor|extract|dedupe|split .*(file|module|component)|^[A-Z][a-z]+(?: [A-Za-z]+)*: [\w.-]+\.[a-z]+$/i.test(title);
}

// A badge of a group. `secret` hides it as ❓ until it's earned (components/LoomBadges.tsx).
export const def = (group: BadgeGroup, id: string, icon: string, name: string, desc: string, test: Def["test"], extra: Partial<Badge> = {}): Def => ({
  group, id, icon, name, desc, test, ...extra,
});

export const flag = (test: (f: GameFacts) => boolean) => (f: GameFacts): Result => ({ unlocked: test(f) });

// A counted badge: unlocked once the count reaches n.
export function atLeast(value: (f: GameFacts) => number, n: number) {
  return (f: GameFacts): Result => {
    const have = value(f);
    return { unlocked: have >= n, have: Math.min(have, n), need: n };
  };
}

// The first time something happened: unlocked and dated by it.
export function first(find: (f: GameFacts) => number | undefined) {
  return (f: GameFacts): Result => {
    const at = find(f);
    return { unlocked: at !== undefined, at };
  };
}

// A running total crossing n, dated by the item that crossed it. Items are [at, amount], any order.
export function crossing(items: (f: GameFacts) => [number, number][], n: number) {
  return (f: GameFacts): Result => {
    let sum = 0;
    for (const [at, amount] of [...items(f)].sort((a, b) => a[0] - b[0])) {
      sum += amount;
      if (sum >= n) return { unlocked: true, at, have: n, need: n };
    }
    return { unlocked: false, have: Math.floor(sum), need: n };
  };
}

// Noon local time on a "2026-10-11" day, for badges a day earned.
export function noon(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, 12).getTime();
}

// Each card's first Done, oldest first: a card moved back and shipped again counts once.
export function shipped(f: GameFacts): ActivityEvent[] {
  const seen = new Set<string>();
  return f.events
    .filter((e) => e.kind === "done")
    .sort((a, b) => a.at - b.at)
    .filter((e) => {
      const key = e.card ?? e.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

// Done events a live Weft board saw: a backfilled one ("done:<card>") is dated by the card's last change.
export const liveShipped = (f: GameFacts) => shipped(f).filter((e) => !e.id.startsWith("done:"));

// When each card was created.
export const createdAt = (f: GameFacts) => new Map(f.events.filter((e) => e.kind === "created").map((e) => [e.card, e.at]));

// Events grouped by their local day.
export function byDay(events: ActivityEvent[]): Map<string, ActivityEvent[]> {
  const out = new Map<string, ActivityEvent[]>();
  for (const e of events) out.set(dayKey(e.at), [...(out.get(dayKey(e.at)) ?? []), e]);
  return out;
}

// The nth item of the first day that holds n, dated by it.
export function nthInADay(events: (f: GameFacts) => ActivityEvent[], n: number) {
  return first((f) => [...byDay(events(f)).values()].flatMap((list) => list.slice(n - 1, n).map((e) => e.at)).sort((a, b) => a - b)[0]);
}

// How a badge shows: a secret one is ❓ "Secret badge" until it's earned (components/LoomBadges.tsx).
export function shown<B extends Pick<Badge, "secret" | "unlocked" | "icon" | "name" | "desc">>(badge: B): B {
  return badge.secret && !badge.unlocked ? { ...badge, icon: "❓", name: "Secret badge", desc: "Keep building to find it" } : badge;
}
