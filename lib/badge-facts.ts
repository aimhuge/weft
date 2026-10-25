import fs from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LeagueWeek } from "./game-badges";
import { safeClient, signedIn } from "./signed-in-client";
import { DATA_DIR } from "./store";

// What the league and social badges need from weft.zip (lib/league-badges.ts): your league weeks with their rank,
// the builders your workspaces referred and your biggest team, read with one RPC (supabase/migrations/
// 20261025075041_badge_facts.sql) on the league sync's timer and kept in ~/.weft/badge-facts.json, so the game
// reads them without a network call. Signed out, or before the migration is on the server, there's nothing.

export interface BadgeFacts {
  leagueWeeks: LeagueWeek[];
  referrals: number;
  teamSize: number;
}

export const BADGE_FACTS_FILE = path.join(DATA_DIR, "badge-facts.json");

interface Raw {
  weeks?: { week?: unknown; tier?: unknown; rank?: unknown; size?: unknown; done?: unknown }[];
  referrals?: unknown;
  team?: unknown;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

// The RPC's answer as badge facts; anything malformed reads as nothing.
export function toBadgeFacts(raw: unknown): BadgeFacts {
  const r = (raw && typeof raw === "object" ? raw : {}) as Raw;
  const weeks = Array.isArray(r.weeks) ? r.weeks : [];
  return {
    leagueWeeks: weeks
      .filter((w) => typeof (w as { week?: unknown } | null)?.week === "string")
      .map((w) => ({ week: String(w.week), tier: num(w.tier), rank: num(w.rank), size: num(w.size), done: w.done === true })),
    referrals: num(r.referrals),
    teamSize: num(r.team),
  };
}

// Reads them fresh when signed in and saves them. False when there was nobody to read as or the RPC isn't deployed.
export async function syncBadgeFacts({ client = safeClient }: { client?: () => SupabaseClient | null } = {}): Promise<boolean> {
  const c = client();
  if (!c || !(await signedIn(c))) return false;
  const { data, error } = (await c.rpc("badge_facts")) as { data: unknown; error: { message: string; code?: string } | null };
  if (error?.code === "PGRST202") return false;
  if (error) throw new Error(error.message);
  fs.mkdirSync(path.dirname(BADGE_FACTS_FILE), { recursive: true });
  // Saved as the RPC sent it; readBadgeFacts reads it the same way.
  fs.writeFileSync(BADGE_FACTS_FILE, JSON.stringify(data));
  return true;
}

// What the last sync saved, or nothing.
export function readBadgeFacts(): Partial<BadgeFacts> {
  try {
    return toBadgeFacts(JSON.parse(fs.readFileSync(BADGE_FACTS_FILE, "utf8")));
  } catch {
    return {};
  }
}
