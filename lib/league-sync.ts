import type { SupabaseClient } from "@supabase/supabase-js";
import { gameState } from "./game-server";
import { globalSingleton } from "./global-singleton";
import { LEAGUES } from "./game";
import { leagueEntry, toLeagueView, toTierView, type BrowseRow, type LeagueEntry, type LeagueView, type StandingRow, type TierView } from "./league";
import { syncChangelog, watchChangelog } from "./changelog-sync";
import { syncProfileCard } from "./profile-card-sync";
import { NOT_DEPLOYED as LIMITS_NOT_DEPLOYED, syncLimits } from "./limit-board-sync";
import { safeClient, signedIn } from "./signed-in-client";

// Your week in your league: while you're signed in to Weft, this Mac posts its week (XP, cards shipped, streak,
// level, the badges earned since Monday) every SYNC_MS and whenever the League tab opens, and reads the league
// back for the tab (/api/league). supabase/migrations/20261017162000_leagues.sql settles tiers and leagues.

export const SYNC_MS = 10 * 60 * 1000;
// The first post waits for the board to settle after a start.
export const FIRST_SYNC_MS = 60 * 1000;

export interface LeagueDeps {
  // null = signed out or accounts not set up in this build.
  client?: () => SupabaseClient | null;
  entry?: (now: number) => LeagueEntry;
  now?: () => number;
}

const ownEntry = (now: number) => leagueEntry(gameState({ now }), now);

// PostgREST's "no such function": the leagues migration isn't on this Supabase yet.
export const NOT_DEPLOYED = "Leagues aren't on Weft's server yet. They open once its database is updated.";

function rpcError(error: { message: string; code?: string }): Error {
  return new Error(error.code === "PGRST202" ? NOT_DEPLOYED : error.message);
}

async function submit(client: SupabaseClient, entry: LeagueEntry): Promise<void> {
  const { error } = await client.rpc("league_submit", {
    p_week: entry.week,
    p_xp: entry.xp,
    p_shipped: entry.shipped,
    p_streak: entry.streak,
    p_level: entry.level,
    p_badges: entry.badges,
  });
  if (error) throw rpcError(error);
}

// Posts this week, when signed in. Returns false when there was nobody to post as.
export async function syncWeek({ client = safeClient, entry = ownEntry, now = Date.now }: LeagueDeps = {}): Promise<boolean> {
  const c = client();
  if (!c || !(await signedIn(c))) return false;
  await submit(c, entry(now()));
  return true;
}

// The League tab: post first, so your row is fresh (and you've joined this week), then read the league.
export async function leagueView({ client = safeClient, entry = ownEntry, now = Date.now }: LeagueDeps = {}): Promise<LeagueView> {
  const c = client();
  if (!c || !(await signedIn(c))) return { state: "signed-out" };
  try {
    const mine = entry(now());
    await submit(c, mine);
    const res: unknown = await c.rpc("league_standings", { p_week: mine.week });
    const { data, error } = res as { data: StandingRow[] | null; error: { message: string; code?: string } | null };
    if (error) throw rpcError(error);
    return toLeagueView(mine.week, data ?? []);
  } catch (err) {
    return { state: "error", error: err instanceof Error ? err.message : String(err) };
  }
}

// The Leagues dialog: every league of one tier this week, read only (your own post happens in leagueView).
export async function tierView(tier: number, { client = safeClient, entry = ownEntry, now = Date.now }: LeagueDeps = {}): Promise<TierView> {
  if (!Number.isInteger(tier) || tier < 0 || tier >= LEAGUES.length) return { state: "error", error: "No such league." };
  const c = client();
  if (!c || !(await signedIn(c))) return { state: "signed-out" };
  try {
    const { week } = entry(now());
    const res: unknown = await c.rpc("league_browse", { p_week: week, p_tier: tier });
    const { data, error } = res as { data: BrowseRow[] | null; error: { message: string; code?: string } | null };
    if (error) throw rpcError(error);
    return toTierView(week, tier, data ?? []);
  } catch (err) {
    return { state: "error", error: err instanceof Error ? err.message : String(err) };
  }
}

// Once per server (lib/copilot.ts prewarm), and the limit records, the public builder card and the changelog mirror ride the same timer. A failed post
// just waits for the next one.
export function startLeagueSync(deps: LeagueDeps = {}): () => void {
  const state = globalSingleton("__weftLeagueSync", () => ({ timers: [] as ReturnType<typeof setTimeout>[] }));
  if (state.timers.length) return () => {};
  const tick = () => {
    void syncWeek(deps).catch((err: unknown) => {
      if (!(err instanceof Error && err.message === NOT_DEPLOYED)) console.warn("[weft] league sync failed:", err);
    });
    void syncLimits({ client: deps.client }).catch((err: unknown) => {
      if (!(err instanceof Error && err.message === LIMITS_NOT_DEPLOYED)) console.warn("[weft] limit records sync failed:", err);
    });
    void syncProfileCard({ client: deps.client }).catch((err: unknown) => console.warn("[weft] profile card sync failed:", err));
    void syncChangelog({ client: deps.client }).catch((err: unknown) => console.warn("[weft] changelog sync failed:", err));
  };
  const unwatch = watchChangelog({ client: deps.client });
  state.timers.push(setTimeout(tick, FIRST_SYNC_MS), setInterval(tick, SYNC_MS));
  return () => {
    for (const t of state.timers) clearTimeout(t);
    state.timers = [];
    unwatch();
  };
}
