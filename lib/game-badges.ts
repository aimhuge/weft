// The achievements: what each one asks for and whether you have it, from the activity log, your
// records and the projects' production-ready trees. Pure (see lib/game.ts).
import { isRefactor } from "./badge-kit";
import type { Habit } from "./craft-types";
import { EXTRA_DEFS } from "./extra-badges";
import type { ActivityEvent, Records } from "./game";
import { LIMIT_DEFS } from "./limit-badges";
import type { DayTokens, LimitHit } from "./usage";
import { BRANCHES, branchComplete, CHECKS, productionReady, type BranchId, type CheckDef, type ProjectReport } from "./project-badges";

// Kept here too: lib/game-server.ts and the tests import it from the badges.
export { isRefactor };

export const BADGE_GROUPS = [
  "Milestones", "Streaks", "Speed", "Calendar", "Habits", "Parallel", "Tokens & spend", "Limits", "Craft", "Board", "Projects",
  "Leagues", "Social", "Weft explorer", "Secret", "Code health", "Production-ready",
] as const;
export type BadgeGroup = (typeof BADGE_GROUPS)[number];

export interface Badge {
  id: string;
  icon: string;
  name: string;
  desc: string;
  group: BadgeGroup;
  unlocked: boolean;
  // When it was earned, when the log can tell.
  at?: number;
  // Progress toward it, for counted badges.
  have?: number;
  need?: number;
  // What a locked code badge's "Set it up" starts: a check of the tree, or the weakest check of a branch.
  fix?: { check?: string; branch?: BranchId };
  // Shown as ❓ "Secret badge" until it's earned (components/LoomBadges.tsx).
  secret?: boolean;
}

// One finished or running league week of yours on weft.zip (lib/badge-facts.ts): its ladder tier (0 is Cotton),
// your rank in it and how many were in it.
export interface LeagueWeek {
  week: string;
  tier: number;
  rank: number;
  size: number;
  // The week is over, so its rank is final.
  done: boolean;
}

export interface GameFacts {
  events: ActivityEvent[];
  bestStreak: number;
  // The day each streak length was first reached (lib/game.ts streakOf).
  streakReached?: Record<number, string>;
  records: Records;
  projects: ProjectReport[];
  // Projects with 3 or more cards.
  projectCount: number;
  // Refactor cards shipped (see isRefactor).
  refactors: number;
  // Some project's line coverage rose 10 points or more within a week.
  climbed: boolean;
  // Each plan limit you ran into, one per window (lib/usage.ts distinctHits).
  limitHits?: LimitHit[];
  // Each day's tokens in and out across every transcript (lib/usage-scan.ts).
  tokens?: Map<string, DayTokens>;
  // Days a streak freeze covered (lib/game.ts streakOf).
  frozen?: string[];
  // The board now: cards in Backlog, and cards that carry a tag.
  board?: { backlog: number; tagged: number };
  // Each card's craft habits, by card id (lib/craft.ts).
  habits?: ReadonlyMap<string, ReadonlySet<Habit>>;
  // Each card folder's project root, and how many stacks the projects you shipped in use (lib/project-checks.ts).
  roots?: ReadonlyMap<string, string>;
  shippedStacks?: number;
  // From weft.zip when you're signed in (lib/badge-facts.ts): your league weeks, oldest first, the
  // builders your workspaces referred, and your biggest team.
  leagueWeeks?: LeagueWeek[];
  referrals?: number;
  teamSize?: number;
}

type Result = Pick<Badge, "unlocked" | "at" | "have" | "need">;
type Def = Omit<Badge, keyof Result> & { test: (f: GameFacts) => Result };


const times = (f: GameFacts, kind: ActivityEvent["kind"]) =>
  f.events.filter((e) => e.kind === kind).map((e) => e.at).sort((a, b) => a - b);

// The nth event of a kind: unlocked when there are n, earned at the nth.
function nth(kind: ActivityEvent["kind"], n: number) {
  return (f: GameFacts): Result => {
    const list = times(f, kind);
    return { unlocked: list.length >= n, at: list[n - 1], have: Math.min(list.length, n), need: n };
  };
}

function atLeast(value: (f: GameFacts) => number, n: number) {
  return (f: GameFacts): Result => {
    const have = value(f);
    return { unlocked: have >= n, have: Math.min(have, n), need: n };
  };
}

// A streak of n days: dated by the day it was first reached, at noon local time.
function streakBadge(n: number) {
  return (f: GameFacts): Result => {
    const day = f.streakReached?.[n];
    const [y, m, d] = (day ?? "").split("-").map(Number);
    return { ...atLeast((g) => g.bestStreak, n)(f), at: day ? new Date(y ?? 0, (m ?? 1) - 1, d ?? 1, 12).getTime() : undefined };
  };
}

const flag = (test: (f: GameFacts) => boolean) => (f: GameFacts): Result => ({ unlocked: test(f) });
const anyProject = (test: (p: ProjectReport) => boolean) => flag((f) => f.projects.some(test));

// The first turn or shipped card in an hour range of the day, local time.
function hourly(from: number, to: number) {
  return (f: GameFacts): Result => {
    const hit = f.events.find((e) => (e.kind === "turn" || e.kind === "done") && new Date(e.at).getHours() >= from && new Date(e.at).getHours() < to);
    return { unlocked: !!hit, at: hit?.at };
  };
}

const def = (group: BadgeGroup, id: string, icon: string, name: string, desc: string, test: Def["test"], fix?: Badge["fix"]): Def => ({
  group, id, icon, name, desc, test, fix,
});

const DEFS: Def[] = [
  def("Milestones", "first-card", "🧵", "First thread", "Start your first card", nth("created", 1)),
  def("Milestones", "cards-10", "🪡", "Ten threads", "Start 10 cards", nth("created", 10)),
  def("Milestones", "cards-100", "🧶", "Spool", "Start 100 cards", nth("created", 100)),
  def("Milestones", "cards-500", "🪢", "Bolt of cloth", "Start 500 cards", nth("created", 500)),
  def("Milestones", "cards-1000", "🏭", "Mill", "Start 1,000 cards", nth("created", 1000)),
  def("Milestones", "shipped-1", "📦", "Shipped", "Take a card to Done", nth("done", 1)),
  def("Milestones", "shipped-100", "🚚", "Hundred shipped", "Take 100 cards to Done", nth("done", 100)),
  def("Milestones", "shipped-500", "🚢", "Fleet", "Take 500 cards to Done", nth("done", 500)),
  def("Streaks", "streak-3", "🔥", "Warming up", "A 3-day streak", streakBadge(3)),
  def("Streaks", "streak-7", "🔥", "Week on the loom", "A 7-day streak (earns a streak freeze)", streakBadge(7)),
  def("Streaks", "streak-30", "☄️", "Month of making", "A 30-day streak", streakBadge(30)),
  def("Streaks", "streak-100", "🌋", "Unbroken", "A 100-day streak", streakBadge(100)),
  def("Parallel", "parallel-5", "🕸️", "Many hands", "5 cards running at once", atLeast((f) => f.records.maxRunning, 5)),
  def("Parallel", "parallel-10", "🐙", "Octopus", "10 cards running at once", atLeast((f) => f.records.maxRunning, 10)),
  def("Habits", "big-day", "⚡", "Big day", "Start 25 cards in one day", atLeast((f) => f.records.biggestDay?.cards ?? 0, 25)),
  def("Habits", "huge-day", "🌩️", "Storm", "Start 50 cards in one day", atLeast((f) => f.records.biggestDay?.cards ?? 0, 50)),
  def("Habits", "night-owl", "🦉", "Night owl", "Work between midnight and 4am", hourly(0, 4)),
  def("Habits", "early-bird", "🐦", "Early bird", "Work between 5 and 7am", hourly(5, 7)),
  def("Projects", "polymath", "🧭", "Polymath", "Work in 5 projects (3+ cards each)", atLeast((f) => f.projectCount, 5)),
  def("Habits", "thrifty", "🪙", "Thrifty", "Ship a card for under $0.50", flag((f) => (f.records.cheapest ?? Infinity) < 0.5)),
  def("Craft", "refactor-5", "🧹", "Tidy", "Ship 5 refactor cards", atLeast((f) => f.refactors, 5)),
  def("Craft", "refactor-25", "🧽", "Refactorer", "Ship 25 refactor cards", atLeast((f) => f.refactors, 25)),
  ...EXTRA_DEFS,
  ...LIMIT_DEFS.map(({ test, ...d }) => ({ ...d, group: "Limits" as const, test: (f: GameFacts) => test(f.limitHits ?? []) })),
  def("Code health", "tested", "🧪", "Tested", "A project with a coverage report", anyProject((p) => !!p.ok.coverage), { check: "coverage" }),
  def("Code health", "covered-80", "🥈", "Well covered", "80% of lines covered in a project", anyProject((p) => (p.coverage ?? 0) >= 80), { check: "covered80" }),
  def("Code health", "covered-95", "🥇", "Thoroughly covered", "95% of lines covered in a project", anyProject((p) => (p.coverage ?? 0) >= 95), { check: "covered80" }),
  def("Code health", "covered-100", "💎", "Full coverage", "100% of lines covered in a project", anyProject((p) => (p.coverage ?? 0) >= 99.95), { check: "covered80" }),
  def("Code health", "climber", "📈", "Coverage climber", "Raise a project's coverage 10 points in a week", flag((f) => f.climbed), { check: "covered80" }),
  def("Code health", "guarded", "🛡️", "Guarded", "Pre-commit hook and CI that lint, type-check and test", anyProject((p) => !!p.ok.guarded), { check: "guarded" }),
  def("Code health", "strict", "🔒", "Strict", "Strict types and a strict linter", anyProject((p) => !!p.ok.strict), { check: "strict" }),
  def("Code health", "slim", "✂️", "Slim files", "No source file over 300 lines", anyProject((p) => !!p.ok.slim), { check: "slim" }),
  def("Code health", "clean-tree", "🌿", "Clean tree", "Nothing uncommitted in a project", anyProject((p) => p.clean)),
  def("Code health", "perfect", "💯", "As good as it gets", "Every quality check passes in a project", anyProject((p) => p.perfect), { branch: "testing" }),
  ...BRANCHES.map((b) =>
    def("Production-ready", `branch-${b.id}`, b.icon, `${b.label} complete`, `Every ${b.label.toLowerCase()} check passes in a project`,
      anyProject((p) => branchComplete(p, b.id)), { branch: b.id }),
  ),
  def("Production-ready", "production-ready", "🚀", "Production-ready", "All five branches complete in one project", anyProject(productionReady), { branch: "security" }),
];

export function badges(facts: GameFacts): Badge[] {
  return DEFS.map(({ test, ...rest }) => ({ ...rest, ...test(facts) }));
}

// Line coverage rose 10+ points between two snapshots of one project less than a week apart.
export function coverageClimbed(events: ActivityEvent[]): boolean {
  const week = 7 * 24 * 60 * 60 * 1000;
  const snaps = events.filter((e) => e.kind === "quality" && e.coverage !== undefined && e.cwd);
  return snaps.some((a) => snaps.some((b) => b.cwd === a.cwd && b.at > a.at && b.at - a.at <= week && (b.coverage ?? 0) - (a.coverage ?? 0) >= 10));
}

// The check a locked badge's "Set it up" starts a card for in a project: its own check while that
// still fails, else the first failing check of its branch. Null when there's nothing left to set up.
export function fixFor(badge: Badge, project: ProjectReport | null): CheckDef | null {
  if (badge.unlocked || !badge.fix || !project) return null;
  const own = CHECKS.find((ch) => ch.id === badge.fix?.check);
  if (own && !project.ok[own.id]) return own;
  const branch = badge.fix.branch ?? own?.branch;
  return CHECKS.find((ch) => ch.branch === branch && !project.ok[ch.id]) ?? null;
}

// What the header chip remembers between loads: badges already announced and the last level seen.
export interface Announced {
  badges: string[];
  level: number;
}

// What's new since the chip last looked: the badges just earned and the level reached, if it went up.
export interface Announcement {
  next: Announced;
  text: string | null;
  fresh: Badge[];
  levelUp: number | null;
}

// The badges and level-up to announce since last time. The first load announces nothing, so the
// badges your history already earned don't arrive as a burst of popups.
export function toAnnounce(prev: Announced | null, list: Badge[], level: number): Announcement {
  const ids = list.filter((b) => b.unlocked).map((b) => b.id);
  if (!prev) return { next: { badges: ids, level }, text: null, fresh: [], levelUp: null };
  const fresh = list.filter((b) => b.unlocked && !prev.badges.includes(b.id));
  const next = { badges: [...new Set([...prev.badges, ...ids])], level: Math.max(prev.level, level) };
  const parts: string[] = [];
  if (level > prev.level) parts.push(`⬆️ Level ${level}`);
  if (fresh.length === 1 && fresh[0]) parts.push(`🏅 Badge unlocked: ${fresh[0].icon} ${fresh[0].name}`);
  if (fresh.length > 1) {
    const names = fresh.slice(0, 3).map((b) => `${b.icon} ${b.name}`).join(", ");
    parts.push(`🏅 ${fresh.length} badges unlocked: ${names}${fresh.length > 3 ? "…" : ""}`);
  }
  return { next, text: parts.length ? parts.join(" · ") : null, fresh, levelUp: level > prev.level ? level : null };
}
