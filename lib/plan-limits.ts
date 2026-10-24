import type { LimitSample } from "./limit-chart";
import { BACKEND_IDS } from "./new-thread";
import { poolKey } from "./plan-pools";
import type { Backend, LimitWindow } from "./types";

// The plan limits as the status strip shows them: the 5-hour and weekly windows of the plan the account
// reads, from the log every thread and the background poll write (lib/limit-history.ts).
//
// The plan limits are ONE pool per account. Claude Code and puku-cli both run the Anthropic Agent SDK
// against a claude.ai account session, and the SDK's rate_limits come from the claude.ai usage endpoint
// (sdk.d.ts:4293) — null for API-key sessions (sdk.d.ts:4286), so a session that reported one had a
// claude.ai account. They read the SAME windows, with the same reset times: puku read five_hour used=100
// resetsAt 21:30 at 19:45 on 2026-10-23, between Claude Code's used=99 at 19:43 and used=100 at 19:47,
// against that same 21:30 reset. One climbing counter, not two.
//
// So a CLI's entry holds the POOL's newest reading, and the CLI only says which plan the strip should name
// and who last reported. A CLI that has never reported has no entry (lib/plan-pools.ts says which CLIs
// share a plan).

export interface PlanReading {
  fiveHour?: LimitWindow;
  sevenDay?: LimitWindow;
  // When the pool read each window (unix ms).
  //
  // The windows are the account's, so their times are the pool's: the moment the reading that produced
  // them was taken, whichever CLI took it.
  fiveHourAt?: number;
  sevenDayAt?: number;
  // When this CLI last reported (unix ms).
  //
  // Not when the numbers above were read: those are the pool's. This field says which CLI is the one
  // that reports, so the strip can name the plan.
  reportedAt: number;
}

export type PlanLimits = Partial<Record<Backend, PlanReading>>;

// The order the strip lists plans in when no card is open. Every CLI, so a CLI that reports
// a plan gets a place in the strip (lib/new-thread.ts's list, so a new CLI comes with it).
export const PLAN_ORDER: Backend[] = BACKEND_IDS;

// The newest reading of each window, per pool: the window as it stands and when it was read.
type PoolWindow = { window: LimitWindow; at: number };

// Each CLI's entry, carrying the POOL's newest reading of each window.
//
// Every CLI that has reported gets an entry, and each carries the pool's newest reading — so a card on a
// CLI that stopped reporting still shows the account's real limits instead of a stale snapshot of its own.
// A CLI that has never reported has no entry.
export function planLimits(samples: LimitSample[]): PlanLimits {
  const plans: PlanLimits = {};
  // The pool's newest reading of each window, and when it was read.
  const poolWindows = new Map<string, PoolWindow>();
  for (const s of [...samples].sort((a, b) => a.at - b.at)) {
    const window: LimitWindow = { used: s.used, ...(s.resetsAt !== undefined && { resetsAt: s.resetsAt }) };
    // The pool's window is the newest reading from ANY CLI on that plan.
    const key = `${poolKey(s.backend)}:${s.kind}`;
    const prev = poolWindows.get(key);
    if (!prev || s.at >= prev.at) poolWindows.set(key, { window, at: s.at });
    // The CLI that reported gets an entry, so the strip can name it.
    const plan = (plans[s.backend] ??= { reportedAt: s.at });
    plan.reportedAt = Math.max(plan.reportedAt, s.at);
  }
  // Now the pool's newest reading of each window, on every entry of that pool.
  //
  // Each entry gets its own copy of the window, not the pool's: a consumer that changes one CLI's window
  // (to mark it stale, say) must not quietly change every other CLI's window with it.
  for (const [backend, plan] of Object.entries(plans) as [Backend, PlanReading][]) {
    const five = poolWindows.get(`${poolKey(backend)}:five_hour`);
    if (five) {
      plan.fiveHour = { ...five.window };
      plan.fiveHourAt = five.at;
    }
    const seven = poolWindows.get(`${poolKey(backend)}:seven_day`);
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
