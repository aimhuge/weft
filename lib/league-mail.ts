import { XP } from "./game";
import { leagueMoves, leagueName, POOL_SIZE, zoneOf } from "./league";

// League emails (docs/architecture/gamification.md): which builder gets which email on a daily run, from the
// league_weeks rows of this week and last, their profiles and the log of what already went out. Pure: the run
// (lib/league-mail-send.ts) reads the rows and sends; the words are lib/league-mail-copy.ts.
//
// The series, at most one email per builder per run:
//   welcome  any day, to an account that signed up in the last few days: your league, who's in it, the rules
//   midweek  Thursday, only when a move is in play: in a zone, or close enough to the up zone to reach it
//   final    Sunday, the same rule with the day it ends on
//   results  Monday, about the week that just ended: up, held or down, the podium, this week's league
// Days are UTC; the run goes at 13:00 UTC, after every time zone has finished Sunday, so Monday's results are final.

export type LeagueMailKind = "welcome" | "midweek" | "final" | "results";

// One row of public.league_weeks.
export interface WeekRow {
  user_id: string;
  week: string;
  tier: number;
  cohort: number;
  xp: number;
  shipped: number;
  streak: number;
}

// The profile fields the emails need.
export interface Builder {
  id: string;
  email: string | null;
  name: string;
  optedIn: boolean;
  createdAt: number;
}

export interface SentMail {
  user_id: string;
  kind: string;
  week: string;
}

export interface Standing {
  rank: number;
  name: string;
  xp: number;
  isMe: boolean;
}

export interface LeagueFacts {
  name: string;
  league: string;
  week: string;
  rank: number;
  size: number;
  xp: number;
  // How many move up and down in this league.
  up: number;
  down: number;
  // Days left in the week, today included.
  daysLeft: number;
  top: Standing[];
}

export interface StandingFacts extends LeagueFacts {
  zone: "up" | "down" | null;
  // XP to pass the last builder in the up zone, or to climb out of the down zone; 0 when it doesn't apply.
  gap: number;
  // Your lead over the first builder outside the up zone (0 when nobody's behind it).
  lead: number;
}

export interface ResultFacts extends LeagueFacts {
  shipped: number;
  move: "up" | "down" | "stay";
  next: string;
}

export type LeagueMail =
  | { kind: "welcome"; userId: string; to: string; week: string; facts: LeagueFacts }
  | { kind: "midweek" | "final"; userId: string; to: string; week: string; facts: StandingFacts }
  | { kind: "results"; userId: string; to: string; week: string; facts: ResultFacts };

export const DAY_MS = 86_400_000;
// A welcome goes to accounts this new; older ones joined before the emails did.
export const WELCOME_WINDOW_MS = 3 * DAY_MS;
// How far from the up zone a builder is still worth a nudge: about six shipped cards.
export const REACH_XP = 6 * XP.done;
export const TOP_N = 5;

const pad = (n: number) => String(n).padStart(2, "0");
const utcDay = (t: number) => {
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};

// The Monday of a time's UTC week, "2026-10-12".
export function utcWeek(t: number): string {
  const weekday = (new Date(t).getUTCDay() + 6) % 7;
  return utcDay(t - weekday * DAY_MS);
}

// Days left in the UTC week, today included: 7 on Monday, 1 on Sunday.
export const daysLeft = (t: number) => 7 - ((new Date(t).getUTCDay() + 6) % 7);

// Each league of a week (same tier and cohort), best first, ranked the way league_standings ranks: ties share a rank.
// With `pooled` (a week under POOL_SIZE builders) the whole week is one open league, under the key "pool".
export function leaguesOf(rows: WeekRow[], pooled = false): Map<string, { row: WeekRow; rank: number }[]> {
  const groups = new Map<string, WeekRow[]>();
  for (const row of rows) {
    const key = pooled ? "pool" : `${row.tier}:${row.cohort}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const ranked = new Map<string, { row: WeekRow; rank: number }[]>();
  for (const [key, list] of groups) {
    const sorted = [...list].sort((a, b) => b.xp - a.xp);
    ranked.set(key, sorted.map((row) => ({ row, rank: 1 + sorted.filter((o) => o.xp > row.xp).length })));
  }
  return ranked;
}

// Where a week's rank sends a builder next week: private.league_tier_for's rule.
export function moveOf(rank: number, xp: number, size: number, tier: number): "up" | "down" | "stay" {
  const { up, down } = leagueMoves(size);
  if (size > 1 && xp > 0 && rank <= up && tier < 5) return "up";
  if (rank > size - down && tier > 0) return "down";
  return "stay";
}

type Ranked = { row: WeekRow; rank: number }[];

function baseFacts(me: WeekRow, league: Ranked, builders: Map<string, Builder>, now: number): LeagueFacts {
  const { up, down } = leagueMoves(league.length);
  const mine = league.find((e) => e.row.user_id === me.user_id);
  return {
    name: builders.get(me.user_id)?.name ?? "Builder",
    league: leagueName(me.tier),
    week: me.week,
    rank: mine?.rank ?? league.length,
    size: league.length,
    xp: me.xp,
    up,
    down,
    daysLeft: daysLeft(now),
    top: league.slice(0, TOP_N).map((e) => ({
      rank: e.rank,
      name: builders.get(e.row.user_id)?.name ?? "Builder",
      xp: e.row.xp,
      isMe: e.row.user_id === me.user_id,
    })),
  };
}

// This week's standing, or null when nothing is in play: alone, or neither in a zone nor within reach of the up zone.
export function standingFacts(me: WeekRow, league: Ranked, builders: Map<string, Builder>, now: number): StandingFacts | null {
  const base = baseFacts(me, league, builders, now);
  if (base.size < 2) return null;
  const zone = zoneOf({ rank: base.rank, xp: me.xp }, base.size, me.tier);
  const xpAt = (rank: number) => league[rank - 1]?.row.xp ?? 0;
  if (zone === "up") return { ...base, zone, gap: 0, lead: base.up < base.size ? me.xp - xpAt(base.up + 1) : 0 };
  if (zone === "down") return { ...base, zone, gap: xpAt(base.size - base.down) - me.xp + 1, lead: 0 };
  if (me.tier >= 5) return null;
  const gap = xpAt(base.up) - me.xp + 1;
  return gap <= REACH_XP ? { ...base, zone, gap, lead: 0 } : null;
}

// Last week's result, or null when nothing happened: no XP and no move.
export function resultFacts(me: WeekRow, league: Ranked, builders: Map<string, Builder>, now: number): ResultFacts | null {
  const base = baseFacts(me, league, builders, now);
  const move = moveOf(base.rank, me.xp, base.size, me.tier);
  if (me.xp === 0 && move === "stay") return null;
  const next = leagueName(me.tier + (move === "up" ? 1 : move === "down" ? -1 : 0));
  return { ...base, shipped: me.shipped, move, next };
}

export interface MailInput {
  now: number;
  thisWeek: WeekRow[];
  lastWeek: WeekRow[];
  builders: Builder[];
  sent: SentMail[];
}

// What the three kinds of mail share: who can be reached, each row's league, and the one-per-builder offer.
interface Plan {
  now: number;
  byId: Map<string, Builder>;
  leagueFor: (leagues: Map<string, Ranked>, row: WeekRow) => Ranked;
  reachable: (id: string) => Builder | null;
  offer: (mail: LeagueMail) => void;
}

// Monday: last week's results to everyone who played it.
function offerResults(plan: Plan, lastWeek: WeekRow[]) {
  const previous = leaguesOf(lastWeek, lastWeek.length < POOL_SIZE);
  for (const row of lastWeek) {
    const b = plan.reachable(row.user_id);
    const facts = b && resultFacts(row, plan.leagueFor(previous, row), plan.byId, plan.now);
    if (b?.email && facts) plan.offer({ kind: "results", userId: b.id, to: b.email, week: row.week, facts });
  }
}

// A welcome to a builder who joined in the last WELCOME_WINDOW_MS, once ever.
function offerWelcomes(plan: Plan, thisWeek: WeekRow[], current: Map<string, Ranked>, sent: SentMail[]) {
  for (const row of thisWeek) {
    const b = plan.reachable(row.user_id);
    if (!b?.email || plan.now - b.createdAt > WELCOME_WINDOW_MS) continue;
    if (sent.some((s) => s.user_id === b.id && s.kind === "welcome")) continue;
    plan.offer({ kind: "welcome", userId: b.id, to: b.email, week: row.week, facts: baseFacts(row, plan.leagueFor(current, row), plan.byId, plan.now) });
  }
}

// Thursday's midweek and Sunday's final nudge: where each builder stands.
function offerNudges(plan: Plan, thisWeek: WeekRow[], current: Map<string, Ranked>, nudge: "midweek" | "final") {
  for (const row of thisWeek) {
    const b = plan.reachable(row.user_id);
    const facts = b && standingFacts(row, plan.leagueFor(current, row), plan.byId, plan.now);
    if (b?.email && facts) plan.offer({ kind: nudge, userId: b.id, to: b.email, week: row.week, facts });
  }
}

// Every email this run should send, one per builder at most: results, then welcome, then the day's nudge.
export function planLeagueMails({ now, thisWeek, lastWeek, builders, sent }: MailInput): LeagueMail[] {
  const byId = new Map(builders.map((b) => [b.id, b]));
  const done = new Set(sent.map((s) => `${s.user_id}:${s.kind}:${s.week}`));
  const weekday = new Date(now).getUTCDay();
  const current = leaguesOf(thisWeek, thisWeek.length < POOL_SIZE);
  const mails = new Map<string, LeagueMail>();
  const plan: Plan = {
    now,
    byId,
    leagueFor: (leagues, row) => leagues.get("pool") ?? leagues.get(`${row.tier}:${row.cohort}`) ?? [],
    reachable: (id) => {
      const b = byId.get(id);
      return b?.optedIn && b.email ? b : null;
    },
    offer: (mail) => {
      if (mails.has(mail.userId) || done.has(`${mail.userId}:${mail.kind}:${mail.week}`)) return;
      mails.set(mail.userId, mail);
    },
  };
  if (weekday === 1) offerResults(plan, lastWeek);
  offerWelcomes(plan, thisWeek, current, sent);
  const nudge = weekday === 4 ? "midweek" : weekday === 0 ? "final" : null;
  if (nudge) offerNudges(plan, thisWeek, current, nudge);
  return [...mails.values()];
}
