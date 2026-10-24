// The Fastest Burn leaderboard (supabase/migrations/20261024203912_limit_records.sql): what a Mac posts about its plan
// limits, and how the Leagues dialog reads the boards back. Client-safe: no server imports.

export type LimitBoard = "five_hour" | "seven_day" | "five_hour_hits" | "seven_day_hits";

export const LIMIT_BOARDS: { id: LimitBoard; label: string; blurb: string }[] = [
  { id: "five_hour", label: "⚡ Fastest 5-hour", blurb: "Quickest from a 5-hour window opening to its limit" },
  { id: "seven_day", label: "☄️ Fastest week", blurb: "Quickest from a weekly window opening to its limit" },
  { id: "five_hour_hits", label: "⏳ Most 5-hour", blurb: "Most 5-hour limits hit, all time" },
  { id: "seven_day_hits", label: "🗓️ Most weekly", blurb: "Most weekly limits hit, all time" },
];

export const isLimitBoard = (v: string | null): v is LimitBoard => LIMIT_BOARDS.some((b) => b.id === v);

interface Burn {
  ms: number;
  at: number;
}

// What the Mac posts: never prompts, code or project names.
export interface LimitEntry {
  fiveMs: number | null;
  fiveAt: string | null;
  weekMs: number | null;
  weekAt: string | null;
  fiveHits: number;
  weekHits: number;
}

export function limitEntry(hits: { fiveHour: number; sevenDay: number; fastest?: { fiveHour?: Burn; sevenDay?: Burn } }): LimitEntry {
  const iso = (b?: Burn) => (b ? new Date(b.at).toISOString() : null);
  return {
    fiveMs: hits.fastest?.fiveHour ? Math.round(hits.fastest.fiveHour.ms) : null,
    fiveAt: iso(hits.fastest?.fiveHour),
    weekMs: hits.fastest?.sevenDay ? Math.round(hits.fastest.sevenDay.ms) : null,
    weekAt: iso(hits.fastest?.sevenDay),
    fiveHits: hits.fiveHour,
    weekHits: hits.sevenDay,
  };
}

// One row of public.limit_board.
export interface LimitBoardRow {
  rank: number;
  user_id: string;
  name: string | null;
  avatar_url: string | null;
  username: string | null;
  value: number | string;
  at: string | null;
  is_me: boolean;
}

export interface LimitRow {
  rank: number;
  userId: string;
  name: string;
  avatar: string | null;
  username: string | null;
  value: number;
  at: number | null;
  isMe: boolean;
}

export type LimitBoardView =
  | { state: "signed-out" }
  | { state: "error"; error: string }
  | { state: "ready"; board: LimitBoard; rows: LimitRow[] };

export function toLimitBoardView(board: LimitBoard, rows: LimitBoardRow[]): LimitBoardView {
  return {
    state: "ready",
    board,
    rows: rows.map((r) => ({
      rank: r.rank,
      userId: r.user_id,
      name: r.name || "Builder",
      avatar: r.avatar_url,
      username: r.username,
      value: Number(r.value),
      at: r.at ? Date.parse(r.at) : null,
      isMe: r.is_me,
    })),
  };
}

// A burn as "4d 3h", "1h 12m" or "9m".
export function burnLabel(ms: number): string {
  const m = Math.round(ms / 60000);
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  if (d) return h ? `${d}d ${h}h` : `${d}d`;
  if (h) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  return `${m}m`;
}

// A row's score as the board shows it: a burn time, or a count.
export const boardValue = (board: LimitBoard, value: number) => (board.endsWith("_hits") ? value.toLocaleString("en-US") : burnLabel(value));
