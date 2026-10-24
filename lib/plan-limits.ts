import type { LimitSample } from "./limit-chart";
import { BACKEND_IDS } from "./new-thread";
import type { Backend, LimitWindow } from "./types";

// The plan limits as the status strip shows them: each CLI's newest 5-hour and weekly reading, from the
// log every thread and the background poll write (lib/limit-history.ts).
//
// Each CLI has its OWN plan: Claude Code on Anthropic's, puku-cli on Puku's, Codex on OpenAI's. So a CLI's
// entry holds only what that CLI's own sessions read, and every card on one CLI shows the same numbers.
//
// On 2026-10-23 the log seemed to say otherwise: two "puku" samples at 19:45 matched Claude Code's to the
// minute (five_hour used=100, resetsAt 21:30). They were Claude's. A card hit Claude's 5-hour limit, was
// switched with Run on puku, and the reading its Claude session still had coming was logged under the
// card's new backend (lib/runner-turn.ts updateLimits now takes the session's own). Treating those two
// lines as proof of one shared pool put Claude's numbers on puku cards (docs/architecture/limits-burndown.md).

export interface PlanReading {
  fiveHour?: LimitWindow;
  sevenDay?: LimitWindow;
  // When this CLI read each window (unix ms).
  fiveHourAt?: number;
  sevenDayAt?: number;
  // When this CLI last reported either window (unix ms).
  reportedAt: number;
}

export type PlanLimits = Partial<Record<Backend, PlanReading>>;

// The order the strip lists plans in when no card is open. Every CLI, so a CLI that reports
// a plan gets a place in the strip (lib/new-thread.ts's list, so a new CLI comes with it).
export const PLAN_ORDER: Backend[] = BACKEND_IDS;

// Each CLI's newest reading of each window. A CLI that has never reported has no entry.
export function planLimits(samples: LimitSample[]): PlanLimits {
  const plans: PlanLimits = {};
  for (const s of [...samples].sort((a, b) => a.at - b.at)) {
    const plan = (plans[s.backend] ??= { reportedAt: s.at });
    const window: LimitWindow = { used: s.used, ...(s.resetsAt !== undefined && { resetsAt: s.resetsAt }) };
    if (s.kind === "five_hour") {
      plan.fiveHour = window;
      plan.fiveHourAt = s.at;
    } else {
      plan.sevenDay = window;
      plan.sevenDayAt = s.at;
    }
    plan.reportedAt = s.at;
  }
  return plans;
}

// A window as of now: once its reset has passed it is full again, and the next reset isn't known yet.
export function liveWindow(window: LimitWindow | undefined, now: number): LimitWindow | undefined {
  if (!window) return undefined;
  if (window.resetsAt !== undefined && now && window.resetsAt * 1000 <= now) return { used: 0 };
  return window;
}
