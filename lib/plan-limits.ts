import type { LimitSample } from "./limit-chart";
import type { Backend, LimitWindow } from "./types";

// Each CLI's plan limits as the status strip shows them: the newest 5-hour and weekly reading that CLI
// reported, from the log every thread and the background poll write (lib/limit-history.ts). Each CLI
// has its own plan (Claude Code on Anthropic's, puku-cli on Puku's, Codex on OpenAI's), so a card's
// limits are its CLI's, not the card's own last snapshot, and every card on one CLI shows the same.

export interface PlanReading {
  fiveHour?: LimitWindow;
  sevenDay?: LimitWindow;
  // When the newest of the two was read (unix ms).
  at: number;
}

export type PlanLimits = Partial<Record<Backend, PlanReading>>;

// The order the strip lists plans in when no card is open.
export const PLAN_ORDER: Backend[] = ["claude", "puku", "codex"];

// The newest reading of each window, per CLI.
export function planLimits(samples: LimitSample[]): PlanLimits {
  const plans: PlanLimits = {};
  for (const s of [...samples].sort((a, b) => a.at - b.at)) {
    const plan = (plans[s.backend] ??= { at: s.at });
    const window: LimitWindow = { used: s.used, ...(s.resetsAt !== undefined && { resetsAt: s.resetsAt }) };
    if (s.kind === "five_hour") plan.fiveHour = window;
    else plan.sevenDay = window;
    plan.at = Math.max(plan.at, s.at);
  }
  return plans;
}

// A window as of now: once its reset has passed it is full again, and the next reset isn't known yet.
export function liveWindow(window: LimitWindow | undefined, now: number): LimitWindow | undefined {
  if (!window) return undefined;
  if (window.resetsAt !== undefined && now && window.resetsAt * 1000 <= now) return { used: 0 };
  return window;
}
