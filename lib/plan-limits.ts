import type { LimitSample } from "./limit-chart";
import type { Backend, LimitWindow } from "./types";

// The plan limits as the status strip shows them: the newest 5-hour and weekly reading, from the log
// every thread and the background poll write (lib/limit-history.ts).
//
// The plan limits are ONE pool per account: Claude Code and puku-cli report the same 5-hour and weekly
// windows, with the same reset times, because they draw from the same plan. On this machine puku read
// five_hour used=100 resetsAt 21:30 at 19:45, and Claude Code read used=99 at 19:43 and used=100 at
// 19:47 against that same 21:30 reset — one climbing counter, not two.
//
// So the pool's newest reading is the account's, whichever CLI reported it, and every CLI's entry
// carries it. A CLI's entry is keyed by that CLI because it is the one that reports: a card on puku
// shows puku's plan, and the strip names it. But the number in it is the pool's.

export interface PlanReading {
  fiveHour?: LimitWindow;
  sevenDay?: LimitWindow;
  // When each window's number was read (unix ms), the pool's own reading time.
  //
  // The windows are the account's, so their times are the pool's: the moment the reading that
  // produced them was taken, whichever CLI took it. Without this a consumer can only stamp a
  // window with a time it was not read at.
  fiveHourAt?: number;
  sevenDayAt?: number;
  // When this CLI last reported (unix ms).
  //
  // Not when the numbers above were read: those are the pool's. This field says which CLI is the
  // one that reports, so the strip can name the plan.
  reportedAt: number;
}

export type PlanLimits = Partial<Record<Backend, PlanReading>>;

// The order the strip lists plans in when no card is open.
export const PLAN_ORDER: Backend[] = ["claude", "puku", "codex"];

// The newest reading of each window of the account's one pool, attributed to the CLI that reported it.
//
// Every CLI that has reported gets an entry, and each carries the pool's newest reading of each window
// — so a card on a CLI that stopped reporting still shows the account's real limits instead of a stale
// snapshot of its own. A CLI that has never reported has no entry.
export function planLimits(samples: LimitSample[]): PlanLimits {
  const plans: PlanLimits = {};
  // The pool's newest reading of each window, and when it was read.
  let fiveHour: { window: LimitWindow; at: number } | undefined;
  let sevenDay: { window: LimitWindow; at: number } | undefined;
  for (const s of [...samples].sort((a, b) => a.at - b.at)) {
    const window: LimitWindow = { used: s.used, ...(s.resetsAt !== undefined && { resetsAt: s.resetsAt }) };
    if (s.kind === "five_hour") fiveHour = { window, at: s.at };
    else sevenDay = { window, at: s.at };
    // The CLI that reported gets an entry, so the strip can name it.
    const plan = (plans[s.backend] ??= { reportedAt: s.at });
    plan.reportedAt = Math.max(plan.reportedAt, s.at);
  }
  // Now the pool's newest reading of each window, on every entry: the account shares one pool.
  //
  // Each entry gets its own copy of the window, not the pool's: a consumer that changes one CLI's
  // window (to mark it stale, say) must not quietly change every other CLI's window with it.
  for (const plan of Object.values(plans)) {
    if (fiveHour) {
      plan.fiveHour = { ...fiveHour.window };
      plan.fiveHourAt = fiveHour.at;
    }
    if (sevenDay) {
      plan.sevenDay = { ...sevenDay.window };
      plan.sevenDayAt = sevenDay.at;
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
