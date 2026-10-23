import { readSamples } from "./limit-history";
import { modelLimits } from "./model-limit";
import { resetFor, type ResetAnswer } from "./limit-reset";
import type { Backend } from "./types";

// Whether a new thread can start right now, and when it can if not.
//
// A thread started on a spent model fails on its first turn and lands in Needs you with a rate-limit
// error — the user waits for nothing and the card dies. Weft knows before the turn starts: the model
// has its own cap (lib/model-limit.ts) and the CLI has a plan window (lib/limit-history.ts). So the
// New thread dialog asks first, and the card waits for the reset instead of failing.
//
// This is the server's answer, because the plan log and the model store live on disk. The dialog reads
// the same numbers from /api/limits/plans to label the button before the card is made (lib/use-start-gate.ts);
// this decides what actually happens.

// The reset a new thread on this model and CLI has to wait for, if any.
export function startGate(
  backend: Backend,
  model: string | undefined,
  now = Date.now(),
): ResetAnswer | undefined {
  return resetFor(backend, model, readSamples(now), modelLimits(now), now);
}
