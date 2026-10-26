// One account's activity as the admin Users drawer shows it: the per-day rows `admin_user_activity` returns
// (supabase/migrations/20261025181950_user_active_days.sql), read defensively, and what the drawer works out from them:
// active days, streaks, a lifecycle label and the calendar's week columns.

export interface ActivityDay {
  day: string; // YYYY-MM-DD, UTC
  active: boolean;
  cards: number; // cards with synced thread items that day (cloud sync users only)
  items: number;
}

export interface UserActivity {
  days: ActivityDay[];
  firstActiveDay: string | null;
  cards: number;
  sessions: number;
  workspaces: number;
  shares: number;
  apps: number;
  invitesSent: number;
  pukuRequests: number;
}

export interface ActivitySummary {
  active7: number;
  active30: number;
  streak: number;
  longest: number;
  peakCards: number;
}

export type Lifecycle = "never" | "new" | "active" | "dormant" | "gone";

const DAY_MS = 86_400_000;

function count(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0;
}

function toDay(v: unknown): ActivityDay | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  if (typeof r.day !== "string") return null;
  return { day: r.day.slice(0, 10), active: r.active === true, cards: count(r.cards), items: count(r.items) };
}

// The RPC answers jsonb; Postgres bigints can arrive as strings, and a missing account answers null days.
export function toUserActivity(raw: unknown): UserActivity {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const days = Array.isArray(r.days) ? r.days.map(toDay).filter((d): d is ActivityDay => d !== null) : [];
  return {
    days,
    firstActiveDay: typeof r.firstActiveDay === "string" ? r.firstActiveDay : null,
    cards: count(r.cards),
    sessions: count(r.sessions),
    workspaces: count(r.workspaces),
    shares: count(r.shares),
    apps: count(r.apps),
    invitesSent: count(r.invitesSent),
    pukuRequests: count(r.pukuRequests),
  };
}

// Days are oldest first and end today. Today counts toward a streak once it's active, and doesn't break it before.
export function summarize(days: ActivityDay[]): ActivitySummary {
  const recent = (n: number) => days.slice(-n).filter((d) => d.active).length;
  let streak = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i]?.active) streak++;
    else if (i < days.length - 1) break;
  }
  let longest = 0;
  let run = 0;
  for (const d of days) {
    run = d.active ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  return { active7: recent(7), active30: recent(30), streak, longest, peakCards: Math.max(0, ...days.map((d) => d.cards)) };
}

// Where an account stands: never came, joined this week, using it, slipping, or gone a month.
export function lifecycle(lastSeenAt: string | null, createdAt: string | null, now: number): Lifecycle {
  if (!lastSeenAt) return "never";
  const idle = now - Date.parse(lastSeenAt);
  if (createdAt && now - Date.parse(createdAt) < 7 * DAY_MS) return "new";
  if (idle < 3 * DAY_MS) return "active";
  if (idle < 30 * DAY_MS) return "dormant";
  return "gone";
}

// The calendar's columns: one per week, Monday at the top, with nulls before the first day and after the last.
export function weekColumns(days: ActivityDay[]): Array<Array<ActivityDay | null>> {
  const first = days[0];
  if (!first) return [];
  const mondayOffset = (new Date(`${first.day}T00:00:00Z`).getUTCDay() + 6) % 7;
  const cells: Array<ActivityDay | null> = [...Array<null>(mondayOffset).fill(null), ...days];
  while (cells.length % 7) cells.push(null);
  const weeks: Array<Array<ActivityDay | null>> = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}
