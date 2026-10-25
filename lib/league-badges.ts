// The league badges: the weekly ladder on weft.zip (lib/league.ts, the league_weeks table) and the
// social side of it — the builders your workspaces referred and your biggest team. Pure.
import { atLeast, def, first, noon, type Def, type Result } from "./badge-kit";
import { addDays, LEAGUES } from "./game";
import type { GameFacts, LeagueWeek } from "./game-badges";

// The weeks you played, oldest first.
const weeks = (f: GameFacts): LeagueWeek[] => f.leagueWeeks ?? [];

// Two weeks in a row, exactly seven days apart.
const isNextWeek = (a: LeagueWeek, b: LeagueWeek) => addDays(a.week, 7) === b.week;

// The Sunday a finished week ended on, at noon.
const endedAt = (w: LeagueWeek) => noon(addDays(w.week, 6));

// The first week you moved up a league in: its tier sits above the week before it.
export function promotedAt(f: GameFacts): number | undefined {
  const list = weeks(f);
  const up = list.find((w, i) => i > 0 && w.tier > (list[i - 1]?.tier ?? w.tier));
  return up ? noon(up.week) : undefined;
}

// The first week you reached the top league in.
export function goldAt(f: GameFacts): number | undefined {
  const hit = weeks(f).find((w) => w.tier >= LEAGUES.length - 1);
  return hit ? noon(hit.week) : undefined;
}

// The first finished week you won your league in.
export function wonAt(f: GameFacts): number | undefined {
  const hit = weeks(f).find((w) => w.done && w.rank === 1 && w.size >= 2);
  return hit ? endedAt(hit) : undefined;
}

// The first finished week you finished on the podium in.
export function podiumAt(f: GameFacts): number | undefined {
  const hit = weeks(f).find((w) => w.done && w.rank <= 3 && w.size >= 4);
  return hit ? endedAt(hit) : undefined;
}

// The first week you came back up after being dropped: a, b, c in a row, down then up again.
export function comebackAt(f: GameFacts): number | undefined {
  const list = weeks(f);
  const back = list.find((c, i) => {
    const [a, b] = [list[i - 2], list[i - 1]];
    return !!a && !!b && isNextWeek(a, b) && isNextWeek(b, c) && b.tier < a.tier && c.tier > b.tier;
  });
  return back ? noon(back.week) : undefined;
}

// Ten weeks played in the leagues, dated by the tenth.
export function seasonTicket(f: GameFacts): Result {
  const tenth = weeks(f)[9];
  return { unlocked: !!tenth, have: Math.min(weeks(f).length, 10), need: 10, at: tenth ? noon(tenth.week) : undefined };
}

// The builders your workspaces referred.
const referrals = (f: GameFacts) => f.referrals ?? 0;

// The size of your biggest team.
const teamSize = (f: GameFacts) => f.teamSize ?? 0;

export const LEAGUE_DEFS: Def[] = [
  def("Leagues", "promoted", "🆙", "Promoted", "Move up a league", first(promotedAt)),
  def("Leagues", "gold-thread", "👑", "Gold Thread", "Reach the top league", first(goldAt)),
  def("Leagues", "week-winner", "🥇", "Week winner", "Finish #1 in your league", first(wonAt)),
  def("Leagues", "podium", "🥉", "Podium", "Finish in the top 3 of your league", first(podiumAt)),
  def("Leagues", "comeback", "🔄", "Comeback", "Promoted the week after you were dropped", first(comebackAt)),
  def("Leagues", "season-ticket", "📆", "Season ticket", "Play 10 weeks in the leagues", seasonTicket),
  def("Social", "recruiter-1", "✉️", "Recruiter", "Refer a builder who signs up", atLeast(referrals, 1)),
  def("Social", "recruiter-5", "📨", "Talent scout", "Refer 5 builders who sign up", atLeast(referrals, 5)),
  def("Social", "recruiter-25", "📯", "Headhunter", "Refer 25 builders who sign up", atLeast(referrals, 25)),
  def("Social", "crew", "👥", "Crew", "Be on a team of 5", atLeast(teamSize, 5)),
];
