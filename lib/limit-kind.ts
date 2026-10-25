// Which limit a rate-limit event is about: the plan's own window, or one model's own cap.
//
// The SDK names the window it refused on (sdk.d.ts:5680):
//
//   five_hour               the plan's 5-hour window
//   seven_day               the plan's weekly window
//   seven_day_opus          Opus's own weekly cap
//   seven_day_sonnet        Sonnet's own weekly cap
//   seven_day_overage_included, overage
//
// The first two are the ACCOUNT's: every model on that plan is out of room, so the window is
// recorded on the plan (lib/limit-history.ts) and every thread on the pool waits for it.
//
// The per-model ones are the MODEL's: only that model is out of room, and the others still run.
// Recording them as a plan window would gate every model on the pool — which is what the New
// thread dialog reads (lib/limit-reset.ts) — so picking another model would not help, and the
// user would be stuck watching "at its limit" with no way out. A per-model cap belongs in the
// per-model store (lib/model-limit.ts), where it gates that model and only that model.

import { recordModelLimit } from "./model-limit";
import { usageWindow } from "./turn";

// The plan window a rate limit type names, if it names one of the plan's own.
export type PlanWindow = "five_hour" | "seven_day";

// The plan's rate-limit windows, as the SDK's usage answer carries them (sdk.d.ts:4292): the plan's
// own two, and the per-model weekly caps beside them.
//
// The per-model ones are spelled out here rather than taken from the SDK's type, so this file does
// not depend on the SDK's exact shape — and so a field the SDK renames is a type error in one
// place instead of a silent miss in the runner.
export interface PlanRateLimits {
  five_hour?: { utilization: number | null; resets_at: string | null } | null;
  seven_day?: { utilization: number | null; resets_at: string | null } | null;
  seven_day_opus?: { utilization: number | null; resets_at: string | null } | null;
  seven_day_sonnet?: { utilization: number | null; resets_at: string | null } | null;
  // The server's own rows, each naming its model with a display label (e.g. "Fable").
  model_scoped?: { display_name: string; utilization: number | null; resets_at: string | null }[];
}

// The rate limit types that are one model's own weekly cap, and the family each names.
const MODEL_CAP_FAMILIES: Record<string, string> = {
  seven_day_opus: "opus",
  seven_day_sonnet: "sonnet",
};

// The plan window a type names, if any. A per-model cap names no plan window: the plan's weekly
// window is a different counter, and reading the model's utilization as the plan's would mark
// the whole plan spent when only one model is.
export function planWindowOf(rateLimitType: string | undefined): PlanWindow | undefined {
  if (rateLimitType === "five_hour") return "five_hour";
  if (rateLimitType === "seven_day") return "seven_day";
  return undefined;
}

// The model family a type names, if it names one: "opus", "sonnet".
export function modelFamilyOf(rateLimitType: string | undefined): string | undefined {
  if (!rateLimitType) return undefined;
  return MODEL_CAP_FAMILIES[rateLimitType];
}

// The model id Weft stores a cap under, for a card running on `backend`.
//
// The SDK names the cap by the family's name ("opus"), but Weft's model ids are per CLI
// ("claude-opus-5-5" on Claude Code, "opus-4.8" on puku-cli), so the family is matched against
// the card's own model — the model that actually ran out, and the id the store keys on.
//
// The card's model is the one to trust, and it has to be in the family the type names: a card on
// Sonnet that saw a "seven_day_opus" event was told about a cap that isn't its own, and
// recording it against Sonnet would gate a model that still has room.
//
// When the card has no model of its own the CLI's default ran, and Weft doesn't name it — so
// there's nothing to record against, and the cap is left to the plan window.
export function modelCapFor(cardModel: string | undefined, rateLimitType: string | undefined): string | undefined {
  const family = modelFamilyOf(rateLimitType);
  if (!family || !cardModel) return undefined;
  return cardModel.toLowerCase().includes(family) ? cardModel : undefined;
}

// The per-model weekly caps this card's model is in, recorded against that model.
//
// The SDK names the caps by family (seven_day_opus, seven_day_sonnet) and by the server's own
// label (model_scoped[]'s display_name, e.g. "Fable"). A cap is recorded only when the card's
// model is the one it names: a cap on Opus says nothing about a card running Sonnet, and
// recording it against Sonnet would gate a model that still has room.
//
// A cap whose window has room is not a cap, and one whose reset has passed is not a cap either:
// the window is open again, and the store forgets it (lib/model-limit.ts).
export function recordModelCaps(model: string | undefined, limits: PlanRateLimits, now = Date.now()): void {
  if (!model) return;
  const scopes = [
    { family: "opus", window: limits.seven_day_opus },
    { family: "sonnet", window: limits.seven_day_sonnet },
  ];
  // The server's own rows name their model with a display label, which Weft matches the same way.
  for (const row of limits.model_scoped ?? []) {
    scopes.push({ family: row.display_name.toLowerCase(), window: { utilization: row.utilization, resets_at: row.resets_at } });
  }
  for (const scope of scopes) {
    // The card's model has to be the one the cap names, or the cap isn't the card's.
    if (!model.toLowerCase().includes(scope.family)) continue;
    const window = usageWindow(scope.window);
    // A window with room is not a cap.
    if (!window || window.used < 100) continue;
    const resetsAt = window.resetsAt !== undefined ? window.resetsAt * 1000 : undefined;
    if (resetsAt !== undefined && resetsAt <= now) continue;
    recordModelLimit(model, now, resetsAt);
  }
}
