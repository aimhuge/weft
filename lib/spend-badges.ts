// The Tokens & spend badges: how many tokens your threads moved (every Claude Code and puku-cli transcript,
// lib/usage-scan.ts) and what your shipped cards cost (the activity log's Done events). Pure.
import { crossing, def, first, noon, shipped, type Def, type Result } from "./badge-kit";
import type { GameFacts } from "./game-badges";

const days = (f: GameFacts) => [...(f.tokens ?? new Map<string, [number, number]>())].sort((a, b) => (a[0] < b[0] ? -1 : 1));

// Each day's tokens in and out together, dated at its noon.
const dayTotals = (f: GameFacts): [number, number][] => days(f).map(([day, [i, o]]) => [noon(day), i + o]);

// Each shipped card's cost then, once per card.
const costs = (f: GameFacts): [number, number][] => shipped(f).flatMap((e) => (e.cost && e.cost > 0 ? [[e.at, e.cost] as [number, number]] : []));

const monthOf = (at: number) => {
  const d = new Date(at);
  return d.getFullYear() * 12 + d.getMonth();
};

// The average cost per shipped card fell 30% or more from one calendar month to the next, both with 5+ priced cards.
export function leanMonth(f: GameFacts): Result {
  const months = new Map<number, { sum: number; n: number; last: number }>();
  for (const [at, cost] of costs(f)) {
    const m = months.get(monthOf(at)) ?? { sum: 0, n: 0, last: at };
    months.set(monthOf(at), { sum: m.sum + cost, n: m.n + 1, last: Math.max(m.last, at) });
  }
  for (const [month, m] of [...months].sort((a, b) => a[0] - b[0])) {
    const prev = months.get(month - 1);
    if (prev && prev.n >= 5 && m.n >= 5 && m.sum / m.n <= 0.7 * (prev.sum / prev.n)) return { unlocked: true, at: m.last };
  }
  return { unlocked: false };
}

const M = 1_000_000;

export const SPEND_DEFS: Def[] = [
  def("Tokens & spend", "tokens-1m", "🔢", "Million", "1,000,000 tokens through your threads", crossing(dayTotals, M)),
  def("Tokens & spend", "tokens-10m", "🔟", "Ten million", "10,000,000 tokens through your threads", crossing(dayTotals, 10 * M)),
  def("Tokens & spend", "tokens-100m", "💯", "Hundred million", "100,000,000 tokens through your threads", crossing(dayTotals, 100 * M)),
  def("Tokens & spend", "tokens-1b", "💰", "Billionaire", "1,000,000,000 tokens through your threads", crossing(dayTotals, 1000 * M)),
  def("Tokens & spend", "tidal-wave", "🌊", "Tidal wave", "10,000,000 tokens in a single day",
    first((f) => dayTotals(f).find(([, n]) => n >= 10 * M)?.[0])),
  def("Tokens & spend", "chatterbox", "🗣️", "Chatterbox", "A day your threads wrote more than they read",
    first((f) => {
      const day = days(f).find(([, [i, o]]) => o > i)?.[0];
      return day ? noon(day) : undefined;
    })),
  def("Tokens & spend", "penny-pincher", "🤏", "Penny pincher", "Ship a card for under $0.10", first((f) => costs(f).find(([, c]) => c < 0.1)?.[0])),
  def("Tokens & spend", "whale", "🐋", "Whale", "Ship a card that cost $20 or more", first((f) => costs(f).find(([, c]) => c >= 20)?.[0])),
  def("Tokens & spend", "patron-100", "🎟️", "Patron", "$100 of model time on shipped work", crossing(costs, 100)),
  def("Tokens & spend", "patron-1000", "🎭", "Benefactor", "$1,000 of model time on shipped work", crossing(costs, 1000)),
  def("Tokens & spend", "lean-month", "📉", "Lean month", "Your average cost per shipped card drops 30% in a month", leanMonth),
];

