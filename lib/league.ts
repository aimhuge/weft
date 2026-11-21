import { dayKey, LEAGUES, weekOf } from "./game";
import type { Badge } from "./game-badges";

// Weekly leagues (supabase/migrations/20261017162000_leagues.sql): what a Mac posts about its week, and how
// the League tab reads the standings back. Client-safe: no server imports.

export interface LeagueBadge {
  icon: string;
  name: string;
}

// What the Mac posts each week: never prompts, code or project names.
export interface LeagueEntry {
  week: string;
  xp: number;
  shipped: number;
  streak: number;
  level: number;
  badges: LeagueBadge[];
}

export interface LeagueRow {
  rank: number;
  userId: string;
  name: string;
  avatar: string | null;
  // Their weft.zip/@username (profiles.username, else their GitHub login).
  username: string | null;
  xp: number;
  shipped: number;
  streak: number;
  level: number;
  badges: LeagueBadge[];
  isMe: boolean;
  // Their own tier: in the open league (below) builders of different tiers share one table.
  tier?: number;
}

export type LeagueView =
  | { state: "signed-out" }
  | { state: "error"; error: string }
  | { state: "ready"; week: string; tier: number; league: string; rows: LeagueRow[]; up: number; down: number; pooled?: boolean };

// The open league (supabase/migrations/20261121003415_league_pool.sql): while a week has fewer than this many
// builders in all, they share one league instead of each sitting alone in their tier.
export const POOL_SIZE = 30;

export const MAX_BADGES = 12;
export const PROFILE_BASE = "https://weft.zip/@";

// The badges earned since this week's Monday, newest first.
export function weekBadges(badges: Badge[], week: string): LeagueBadge[] {
  return badges
    .filter((b) => b.unlocked && b.at !== undefined && dayKey(b.at) >= week)
    .sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
    .slice(0, MAX_BADGES)
    .map((b) => ({ icon: b.icon, name: b.name }));
}

export function leagueEntry(
  game: { weekXp: number; weekShipped: number; streak: { current: number }; level: { level: number }; badges: Badge[] },
  now: number,
): LeagueEntry {
  const week = weekOf(dayKey(now));
  return {
    week,
    xp: game.weekXp,
    shipped: game.weekShipped,
    streak: game.streak.current,
    level: game.level.level,
    badges: weekBadges(game.badges, week),
  };
}

// How many move up and down in a league of n (the migration's private.league_moves): 7 and 5 in a full 30.
export function leagueMoves(n: number): { up: number; down: number } {
  return { up: Math.min(7, Math.ceil((n * 7) / 30)), down: Math.min(5, Math.floor((n * 5) / 30)) };
}

// Where a rank sits this week: in the move-up zone, the move-down zone, or safe. Gold Thread has nowhere up
// and Cotton nowhere down; an only builder, or one with no XP, doesn't move up.
export function zoneOf(row: { rank: number; xp: number }, size: number, tier: number): "up" | "down" | null {
  const { up, down } = leagueMoves(size);
  if (size > 1 && row.xp > 0 && row.rank <= up && tier < LEAGUES.length - 1) return "up";
  if (row.rank > size - down && tier > 0) return "down";
  return null;
}

export const profileUrl = (username: string | null) => (username ? `${PROFILE_BASE}${encodeURIComponent(username)}` : null);

export const leagueName = (tier: number) => LEAGUES[Math.min(Math.max(tier, 0), LEAGUES.length - 1)] ?? LEAGUES[0];

// One row of public.league_standings.
export interface StandingRow {
  rank: number;
  user_id: string;
  name: string | null;
  avatar_url: string | null;
  username: string | null;
  xp: number;
  shipped: number;
  streak: number;
  level: number;
  badges: unknown;
  is_me: boolean;
  tier: number;
  size: number;
  // The week is one open league (an older server leaves it out).
  pooled?: boolean;
}

const toBadges = (raw: unknown): LeagueBadge[] =>
  Array.isArray(raw)
    ? raw.flatMap((b: unknown) => {
        const { icon, name } = (b ?? {}) as Record<string, unknown>;
        return typeof icon === "string" && typeof name === "string" ? [{ icon, name }] : [];
      })
    : [];

const toRow = (r: Omit<StandingRow, "tier">): LeagueRow => ({
  rank: r.rank,
  userId: r.user_id,
  name: r.name || "Builder",
  avatar: r.avatar_url,
  username: r.username,
  xp: r.xp,
  shipped: r.shipped,
  streak: r.streak,
  level: r.level,
  badges: toBadges(r.badges),
  isMe: r.is_me,
});

export function toLeagueView(week: string, rows: StandingRow[]): LeagueView {
  const tier = (rows.find((r) => r.is_me) ?? rows[0])?.tier ?? 0;
  const { up, down } = leagueMoves(rows.length);
  const pooled = rows.some((r) => r.pooled);
  return {
    state: "ready",
    week,
    tier,
    league: leagueName(tier),
    up,
    down,
    rows: rows.map((r) => (pooled ? { ...toRow(r), tier: r.tier } : toRow(r))),
    ...(pooled ? { pooled } : {}),
  };
}

// One row of public.league_browse (supabase/migrations/20261018175456_league_browse.sql): a builder in one of a tier's leagues.
export interface BrowseRow extends Omit<StandingRow, "tier"> {
  cohort: number;
}

export interface TierLeague {
  cohort: number;
  rows: LeagueRow[];
  up: number;
  down: number;
}

// Every league of one tier this week, for the Leagues dialog; yours, when you're in this tier, comes first.
export type TierView =
  | { state: "signed-out" }
  | { state: "error"; error: string }
  | { state: "ready"; week: string; tier: number; league: string; leagues: TierLeague[] };

export function toTierView(week: string, tier: number, rows: BrowseRow[]): TierView {
  const byCohort = new Map<number, LeagueRow[]>();
  for (const r of rows) byCohort.set(r.cohort, [...(byCohort.get(r.cohort) ?? []), toRow(r)]);
  const leagues = [...byCohort].map(([cohort, list]) => ({ cohort, rows: list, ...leagueMoves(list.length) }));
  const mine = (l: TierLeague) => (l.rows.some((r) => r.isMe) ? 0 : 1);
  leagues.sort((a, b) => mine(a) - mine(b) || a.cohort - b.cohort);
  return { state: "ready", week, tier, league: leagueName(tier), leagues };
}
