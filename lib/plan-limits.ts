import type { LimitSample } from "./limit-chart";
import { BACKEND_IDS } from "./new-thread";
import { poolKey } from "./plan-pools";
import type { Backend, LimitWindow } from "./types";

// The plan limits as the status strip shows them: the 5-hour and weekly windows of the plan the CLI
// reads, from the log every thread and the background poll write (lib/limit-history.ts).
//
// Each CLI has its OWN plan (lib/plan-pools.ts): Claude Code runs on Anthropic's subscription and reads
// the claude.ai account's windows (sdk.d.ts:4293), puku-cli bills through Puku's gateway and has no
// Anthropic plan limit, Codex runs OpenAI's. So a CLI's entry holds ITS OWN newest reading, and the
// strip names the plan the card is actually on.
//
// A CLI that has never reported has no entry: there is nothing to show for a plan nobody has read.

export interface PlanReading {
  fiveHour?: LimitWindow;
  sevenDay?: LimitWindow;
  // When this CLI read each window (unix ms).
  fiveHourAt?: number;
  sevenDayAt?: number;
  // When this CLI last reported (unix ms).
  reportedAt: number;
}

export type PlanLimits = Partial<Record<Backend, PlanReading>>;

// The order the strip lists plans in when no card is open. Every CLI, so a CLI that reports
// a plan gets a place in the strip (lib/new-thread.ts's list, so a new CLI comes with it).
export const PLAN_ORDER: Backend[] = BACKEND_IDS;

// The newest reading of each window, per plan: the window as it stands and when it was read.
type PlanWindow = { window: LimitWindow; at: number };

// Each CLI's entry, carrying ITS OWN newest reading of each window.
//
// Every CLI that has reported gets an entry, carrying the plan's own newest reading — so a card on a CLI
// that stopped reporting still shows its real limits instead of a stale snapshot. A CLI that has never
// reported has no entry.
export function planLimits(samples: LimitSample[]): PlanLimits {
  const plans: PlanLimits = {};
  // The plan's newest reading of each window, and when it was read.
  const planWindows = new Map<string, PlanWindow>();
  for (const s of [...samples].sort((a, b) => a.at - b.at)) {
    const window: LimitWindow = { used: s.used, ...(s.resetsAt !== undefined && { resetsAt: s.resetsAt }) };
    // The plan's window is the newest reading of it (the CLI's own plan — lib/plan-pools.ts).
    const key = `${poolKey(s.backend)}:${s.kind}`;
    const prev = planWindows.get(key);
    if (!prev || s.at >= prev.at) planWindows.set(key, { window, at: s.at });
    // The CLI that reported gets an entry, so the strip can name it.
    const plan = (plans[s.backend] ??= { reportedAt: s.at });
    plan.reportedAt = Math.max(plan.reportedAt, s.at);
  }
  // Now the plan's newest reading of each window, on its CLI's entry.
  //
  // Each entry gets its own copy of the window: a consumer that changes one CLI's window (to mark it
  // stale, say) must not quietly change another CLI's window with it.
  for (const [backend, plan] of Object.entries(plans) as [Backend, PlanReading][]) {
    const five = planWindows.get(`${poolKey(backend)}:five_hour`);
    if (five) {
      plan.fiveHour = { ...five.window };
      plan.fiveHourAt = five.at;
    }
    const seven = planWindows.get(`${poolKey(backend)}:seven_day`);
    if (seven) {
      plan.sevenDay = { ...seven.window };
      plan.sevenDayAt = seven.at;
    }
  }
  return plans;
}

// A window as of now: once its reset has passed it is full again, and the next reset isn't known yet.
export function liveWindow(window: LimitWindow | undefined, now: number): LimitWindow | undefined {
  if (!window) return undefined;
  if (window.resetsAt !== undefined && now && window.resetsAt * 1000 <= now) return { used: 0 };
  return window;
}
