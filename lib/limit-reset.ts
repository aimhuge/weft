import { samePool } from "./plan-pools";
import type { Backend, LimitWindow } from "./types";

// When a limit frees up. One answer for every place that has to decide "can this run now, or should it
// wait?" — the reply box (which already knows its own card's window), the New thread dialog (which has
// no card yet) and the model pickers (which only know the model).
//
// The reset time lives in three stores, and they answer different questions:
//
//   - the plan log (lib/limit-history.ts → ~/.weft/limits.jsonl): per reading, per plan. "The 5-hour
//     window is at 100%, and it resets at 2:30am." A new thread needs this: the limit is the PLAN's,
//     not the model's. The log says which CLI reported a reading; the window is the plan's, so any CLI
//     on that plan answers for it (lib/plan-pools.ts).
//   - the card's own reading (card.stats.fiveHour): one card's last snapshot of its window.
//   - the per-model store (lib/model-limit.ts → ~/.weft/model-limits.json): per model. "Opus ran out on
//     its own weekly cap, until 2:30am." A model can be spent while the plan's 5-hour window has room,
//     so this one comes first when the model is known.
//
// A limit that has no reset time (a weekly cap whose end Weft never learned) has no answer here: the
// caller falls back to "wait an hour" rather than pretending it knows.
//
// Pure, so a client file can use it: the model limits come in as data, not read off disk.

export interface ResetAnswer {
  // When the limit frees up (unix ms).
  at: number;
  // Which window is spent: the CLI's 5-hour window, its weekly one, or the model's own cap.
  kind: "five_hour" | "seven_day" | "model";
  // What is spent: the CLI, or the model the thread would run on.
  subject: string;
}

// One reading of a plan window, as the log keeps it: which CLI, which window, how much is used (0-100)
// and when it resets (unix seconds).
export interface PlanSample {
  backend: Backend;
  kind: "five_hour" | "seven_day";
  used: number;
  resetsAt?: number;
  at: number;
}

// A model that has hit its own cap, and when it frees up (unix ms).
export interface ModelLimitView {
  model: string;
  at: number;
  resetsAt: number;
}

// The plan's own window for a CLI, as the newest reading of it: the window as it stands now, and when it
// resets.
//
// The window is the PLAN's, so any CLI on that plan reports it: Claude Code and puku-cli read one
// account's windows (lib/plan-pools.ts). That is what keeps the server's answer (the raw log, here) and
// the client's (the /api/limits/plans payload, lib/plan-limits.ts) in agreement about one account.
export function planWindow(
  samples: PlanSample[],
  backend: Backend,
  kind: "five_hour" | "seven_day",
  now: number,
): LimitWindow | undefined {
  let best: { used: number; resetsAt?: number; at: number } | undefined;
  for (const s of samples) {
    if (!samePool(s.backend, backend) || s.kind !== kind) continue;
    if (!best || s.at >= best.at) {
      best = { used: s.used, ...(s.resetsAt !== undefined && { resetsAt: s.resetsAt }), at: s.at };
    }
  }
  if (!best) return undefined;
  // A window whose reset has passed is full again, and the next one isn't known yet (lib/plan-limits.ts).
  if (best.resetsAt !== undefined && best.resetsAt * 1000 <= now) return undefined;
  return { used: best.used, ...(best.resetsAt !== undefined && { resetsAt: best.resetsAt }) };
}

// When this model's own cap frees up (unix ms), if the model has hit one and Weft knows when it ends.
export function modelResetsAt(
  model: string | undefined,
  limits: ModelLimitView[],
  now = Date.now(),
): number | undefined {
  if (!model) return undefined;
  const limit = limits.find((l) => l.model === model);
  return limit && limit.resetsAt > now ? limit.resetsAt : undefined;
}

// The answer for a thread that would run on `model` on `backend`: when it can next run, and what is spent.
//
// The model's own cap comes first: it is the tighter limit, and it is the one the user picked. Then the
// CLI's weekly window, then its 5-hour window — the weekly cap is the one that blocks for days, so it is
// the one worth knowing about.
//
// Returns undefined when nothing is known to be spent: the thread can start now.
export function resetFor(
  backend: Backend,
  model: string | undefined,
  samples: PlanSample[],
  limits: ModelLimitView[] = [],
  now = Date.now(),
): ResetAnswer | undefined {
  const modelAt = modelResetsAt(model, limits, now);
  if (modelAt !== undefined) return { at: modelAt, kind: "model", subject: model as string };

  const weekly = planWindow(samples, backend, "seven_day", now);
  if (weekly && weekly.used >= 100 && weekly.resetsAt !== undefined && weekly.resetsAt * 1000 > now) {
    return { at: weekly.resetsAt * 1000, kind: "seven_day", subject: backend };
  }

  const five = planWindow(samples, backend, "five_hour", now);
  if (five && five.used >= 100 && five.resetsAt !== undefined && five.resetsAt * 1000 > now) {
    return { at: five.resetsAt * 1000, kind: "five_hour", subject: backend };
  }

  return undefined;
}

// The line a picker shows for a spent model: "limit until 2:30am".
export function limitNote(model: string | undefined, limits: ModelLimitView[], now = Date.now()): string | undefined {
  const at = modelResetsAt(model, limits, now);
  if (at === undefined) return undefined;
  return `limit until ${new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

// The reset a thread that is already running has to wait for.
//
// A thread carries its own last reading of its CLI's window (card.stats.fiveHour), which is the
// freshest number it has: it saw the window fill up in this very conversation. The shared plan log
// knows the CLI's windows for every thread, and the model store knows a model's own cap — neither
// of which the card's snapshot can see. So the card's own reading wins when it is the one that says
// the window is spent, and the shared stores fill in the rest.
//
// The plan's next 5-hour reset is the fallback: when the card's snapshot says the window is spent
// but carries no reset time, the plan log knows when the next window opens.
export function threadReset(
  window: LimitWindow | undefined,
  planReset: number | undefined,
  backend: Backend,
  model: string | undefined,
  samples: PlanSample[],
  limits: ModelLimitView[] = [],
  now = Date.now(),
): ResetAnswer | undefined {
  // The model's own cap is the tightest limit, so it comes first (resetFor's own order).
  const shared = resetFor(backend, model, samples, limits, now);
  if (shared?.kind === "model") return shared;

  // The card's own snapshot: spent, and it knows when it frees up.
  if (window && window.used >= 100) {
    const own = window.resetsAt !== undefined ? window.resetsAt * 1000 : undefined;
    if (own !== undefined && own > now) return { at: own, kind: "five_hour", subject: backend };
    if (planReset !== undefined && planReset > now) return { at: planReset, kind: "five_hour", subject: backend };
  }

  return shared;
}

// Why a thread has to wait: "5-hour limit used up", "weekly limit used up", or the model's own name
// when the model is what ran out. The dialog shows it next to the reset time.
export function gateNote(gate: ResetAnswer | undefined, modelLabel?: string): string | undefined {
  if (!gate) return undefined;
  if (gate.kind === "five_hour") return "5-hour limit used up";
  if (gate.kind === "seven_day") return "weekly limit used up";
  return `${modelLabel ?? gate.subject} hit its limit`;
}
