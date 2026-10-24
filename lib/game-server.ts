import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readActivity, record, trackActivity } from "./activity";
import { craftHabits, scanCraft } from "./craft";
import { startLimitPoll } from "./limit-poll";
import {
  activeDays, cloth, dayKey, LEAGUES, levelFor, records, streakOf, tallyDays, weekShipped, weekXp,
  type DayTally, type Level, type Records, type Stitch, type Streak,
} from "./game";
import { attributes, classFor, stackSkills, type Attribute, type Skill } from "./game-attributes";
import { badges, coverageClimbed, isRefactor, type Badge } from "./game-badges";
import { fastestBurn, liveHit } from "./limit-badges";
import type { GithubProfile } from "./github-profile";
import { globalSingleton } from "./global-singleton";
import type { ProjectReport } from "./project-badges";
import { sessionFiles } from "./import";
import { checkProject, detectStack } from "./project-checks";
import { projectRoot } from "./quality";
import { listCards } from "./store";
import { countsAt, welcome } from "./welcome";
import { distinctHits, usageDays, type LimitHit, type UsageDay } from "./usage";
import { scanUsage, transcriptUsage } from "./usage-scan";

// Puts the game together for /api/game: the activity log, the board's cards and the projects'
// production-ready trees. Measuring a project reads its files, so reports are cached for a while and
// the header chip's light request only uses what's cached; opening the dialog measures.

export interface GameState {
  name: string;
  xp: number;
  level: Level;
  weekXp: number;
  weekShipped: number;
  // Every card started and taken to Done, for the public builder card (lib/profile-card.ts).
  totals: { started: number; shipped: number };
  streak: Streak;
  today: DayTally;
  cloth: Stitch[];
  records: Records;
  attributes: Attribute[];
  className: string;
  skills: Skill[];
  badges: Badge[];
  projects: ProjectReport[];
  // The root of the project in view, when it was measured.
  inView: string | null;
  leagues: readonly string[];
  // The last 30 days' tokens and limit hits, for the wefter card's chart, and every hit's count.
  usage: UsageDay[];
  limitHits: { fiveHour: number; sevenDay: number; fastest?: { fiveHour?: Burn; sevenDay?: Burn } };
  // Your GitHub profile, added by /api/game when gh is signed in.
  github?: GithubProfile | null;
}

// Your fastest burn of a plan window (lib/limit-badges.ts): how long it lasted and when.
export interface Burn {
  ms: number;
  at: number;
}

export const REPORT_TTL = 10 * 60 * 1000;
// How many of your busiest projects (by cards in the last 30 days) the dialog measures.
export const MEASURED = 6;

interface Cache {
  roots: Map<string, string>;
  stacks: Map<string, string[]>;
  reports: Map<string, { at: number; report: ProjectReport }>;
  name: string | null;
}

const cache = () => globalSingleton<Cache>("__weftGame", () => ({ roots: new Map(), stacks: new Map(), reports: new Map(), name: null }));

function rootOf(cwd: string): string {
  const roots = cache().roots;
  let root = roots.get(cwd);
  if (root === undefined) {
    root = fs.existsSync(cwd) ? projectRoot(cwd) : cwd;
    roots.set(cwd, root);
  }
  return root;
}

function stackOf(cwd: string): string[] {
  const root = rootOf(cwd);
  const stacks = cache().stacks;
  let stack = stacks.get(root);
  if (!stack) {
    stack = isRepo(root) ? detectStack(root) : [];
    stacks.set(root, stack);
  }
  return stack;
}

const isRepo = (root: string) => root !== os.homedir() && fs.existsSync(path.join(root, ".git"));

function userName(): string {
  const c = cache();
  if (c.name === null) {
    try {
      c.name = execFileSync("git", ["config", "--global", "user.name"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch {
      c.name = "";
    }
    c.name ||= os.userInfo().username;
  }
  return c.name;
}

// Measures a project (or returns its fresh cached report) and logs one quality snapshot per day.
function measure(root: string, now: number): ProjectReport {
  const cached = cache().reports.get(root);
  if (cached && now - cached.at < REPORT_TTL) return cached.report;
  const report = checkProject(root);
  cache().reports.set(root, { at: now, report });
  const today = dayKey(now);
  const logged = readActivity().some((e) => e.kind === "quality" && e.cwd === root && dayKey(e.at) === today);
  if (!logged && report.score !== null) {
    record({ at: now, kind: "quality", cwd: root, score: report.score, ...(report.coverage === null ? {} : { coverage: report.coverage }) });
  }
  return report;
}

// Your busiest repos lately, plus the one in view.
export function rootsToMeasure(cards: { cwd: string; createdAt: number }[], inView: string | null, now: number): string[] {
  const since = now - 30 * 24 * 60 * 60 * 1000;
  const counts = new Map<string, number>();
  for (const c of cards) if (c.createdAt >= since) counts.set(rootOf(c.cwd), (counts.get(rootOf(c.cwd)) ?? 0) + 1);
  const busiest = [...counts].filter(([root]) => isRepo(root)).sort((a, b) => b[1] - a[1]).slice(0, MEASURED).map(([root]) => root);
  return inView && isRepo(inView) && !busiest.includes(inView) ? [inView, ...busiest] : busiest;
}

export function gameState({ cwd, full, now = Date.now() }: { cwd?: string | null; full?: boolean; now?: number }): GameState {
  trackActivity();
  // The limits chart needs samples between thread turns, so a 15-minute background poll runs
  // alongside the activity log (lib/limit-poll.ts).
  startLimitPoll();
  // With history opted out (lib/welcome.ts), what happened before the welcome doesn't count.
  const w = welcome();
  const events = readActivity().filter((e) => countsAt(w, e.at));
  const cards = listCards().filter((c) => c.role !== "copilot" && countsAt(w, c.createdAt));
  // Craft reads what the last scan found; the scan catches up in the background.
  void scanCraft(cards, sessionFiles()).catch(() => {});
  // So does usage: every transcript's tokens and limit hits, plus the hits Weft's threads logged live.
  void scanUsage(now).catch(() => {});
  const scanned = transcriptUsage();
  const live = events.flatMap((e): LimitHit[] => (e.kind === "limit" && e.limit ? [liveHit(e.id, e.at, e.limit)] : []));
  const hits = distinctHits([...scanned.hits, ...live]);
  const inView = cwd ? rootOf(cwd) : null;
  const projects = full
    ? rootsToMeasure(cards, inView, now).map((root) => measure(root, now))
    : [...cache().reports.values()].map((r) => r.report);
  const today = dayKey(now);
  const days = tallyDays(events, rootOf);
  const streak = streakOf(activeDays(days), today);
  const recs = records(events, days);
  const cardsPerRoot = new Map<string, number>();
  for (const c of cards) cardsPerRoot.set(rootOf(c.cwd), (cardsPerRoot.get(rootOf(c.cwd)) ?? 0) + 1);
  const busyRoots = [...cardsPerRoot].filter(([, n]) => n >= 3).map(([root]) => root);
  const stacks = new Set(busyRoots.flatMap((root) => stackOf(root)));
  const attrs = attributes({ events, days, today, bestStreak: streak.best, projects, projectCount: busyRoots.length, stacks: stacks.size, habits: craftHabits(cards) });
  const xp = [...days.values()].reduce((n, d) => n + d.xp, 0);
  const facts = {
    events,
    bestStreak: streak.best,
    streakReached: streak.reached,
    records: recs,
    projects,
    projectCount: busyRoots.length,
    refactors: events.filter((e) => e.kind === "done" && isRefactor(e.title)).length,
    climbed: coverageClimbed(events),
    limitHits: hits,
  };
  return {
    name: userName(),
    xp,
    level: levelFor(xp),
    weekXp: weekXp(days, today),
    weekShipped: weekShipped(days, today),
    totals: {
      started: new Set(events.filter((e) => e.kind === "created").map((e) => e.card)).size,
      shipped: new Set(events.filter((e) => e.kind === "done").map((e) => e.card)).size,
    },
    streak,
    today: days.get(today) ?? { cards: 0, turns: 0, done: 0, xp: 0 },
    cloth: cloth(days, streak.frozen, today),
    usage: usageDays(scanned.tokens, hits, today),
    limitHits: {
      fiveHour: hits.filter((h) => h.kind === "five_hour").length,
      sevenDay: hits.filter((h) => h.kind === "seven_day").length,
      fastest: { fiveHour: fastestBurn(hits, "five_hour"), sevenDay: fastestBurn(hits, "seven_day") },
    },
    records: recs,
    attributes: attrs,
    className: classFor(attrs),
    skills: stackSkills(events, stackOf).slice(0, 8),
    badges: badges(facts),
    projects,
    inView: inView && projects.some((p) => p.root === inView) ? inView : null,
    leagues: LEAGUES,
  };
}
