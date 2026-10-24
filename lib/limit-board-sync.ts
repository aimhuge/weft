import type { SupabaseClient } from "@supabase/supabase-js";
import { gameState } from "./game-server";
import { limitEntry, toLimitBoardView, type LimitBoard, type LimitBoardRow, type LimitBoardView, type LimitEntry } from "./limit-board";
import { safeClient, signedIn } from "./signed-in-client";

// Your limit records on the Fastest Burn leaderboard: while you're signed in, this Mac posts them on the league's
// timer (lib/league-sync.ts startLeagueSync) and whenever a board opens, then reads the board back (/api/league?board=).

export interface LimitDeps {
  client?: () => SupabaseClient | null;
  entry?: () => LimitEntry;
}

const ownEntry = () => limitEntry(gameState({}).limitHits);

// PostgREST's "no such function": the limit records migration isn't on this Supabase yet.
export const NOT_DEPLOYED = "The limit leaderboard isn't on Weft's server yet. It opens once its database is updated.";

const rpcError = (error: { message: string; code?: string }) => new Error(error.code === "PGRST202" ? NOT_DEPLOYED : error.message);

async function submit(client: SupabaseClient, e: LimitEntry): Promise<void> {
  const { error } = await client.rpc("limit_submit", {
    p_five_ms: e.fiveMs,
    p_five_at: e.fiveAt,
    p_week_ms: e.weekMs,
    p_week_at: e.weekAt,
    p_five_hits: e.fiveHits,
    p_week_hits: e.weekHits,
  });
  if (error) throw rpcError(error);
}

// Posts your records, when signed in. Returns false when there was nobody to post as.
export async function syncLimits({ client = safeClient, entry = ownEntry }: LimitDeps = {}): Promise<boolean> {
  const c = client();
  if (!c || !(await signedIn(c))) return false;
  await submit(c, entry());
  return true;
}

// One board: post first, so your row is fresh, then read the top 50 and your own rank.
export async function limitBoardView(board: LimitBoard, { client = safeClient, entry = ownEntry }: LimitDeps = {}): Promise<LimitBoardView> {
  const c = client();
  if (!c || !(await signedIn(c))) return { state: "signed-out" };
  try {
    await submit(c, entry());
    const res: unknown = await c.rpc("limit_board", { p_board: board });
    const { data, error } = res as { data: LimitBoardRow[] | null; error: { message: string; code?: string } | null };
    if (error) throw rpcError(error);
    return toLimitBoardView(board, data ?? []);
  } catch (err) {
    return { state: "error", error: err instanceof Error ? err.message : String(err) };
  }
}
