import { clearModelLimit, modelLimits } from "./model-limit";
import { usageWindow } from "./turn";
import type { PlanRateLimits } from "./limit-kind";

// Detecting that the user upgraded their Claude plan.
//
// The per-model store (lib/model-limit.ts) remembers "Opus ran out, until Tuesday". It is cleared
// when the window's own reset passes, but nothing clears it when the PLAN changes: after an upgrade
// Anthropic gives the account more room, the SDK's answer reports the per-model weekly windows with
// room again, and Weft carries on saying the model is at its limit. The card stays parked and the
// model picker still shows "— at its limit", so the upgrade looks like it did nothing.
//
// This module is the join: it compares the CLI's latest answer about a model's weekly window with
// what Weft believes about that model, and frees the ones whose window has room again.
//
// Two things have to be true for a cap to be "released":
//
//   - the CLI reports a weekly window for that model's family, and that window has room (used < 100);
//   - the cap Weft holds is not one whose window is still running. A cap with no known end (the
//     message named no reset) is not released by a reading, because the reading may be about a
//     different window than the one that capped it.
//
// The release is per model, and the model Weft stored the cap under is the card's own model id
// ("claude-opus-5-5"), while the SDK names the family ("opus"). So the family is matched against the
// stored id the same way lib/limit-kind.ts matches it — the cap belongs to the model whose id
// contains the family.

// The windows the SDK's answer carries, per family: "opus" and "sonnet" by name, plus the server's
// own rows (model_scoped[]), whose display_name names the bucket (e.g. "Fable").
//
// The server's rows are keyed by their display name, and Weft's model ids carry the family in their
// own text ("claude-opus-5-5"), so a row matches a stored id when the id contains the row's name.
function familyWindows(limits: PlanRateLimits): Array<{ family: string; used: number; resetsAt?: number }> {
  const out: Array<{ family: string; used: number; resetsAt?: number }> = [];
  const scopes: Array<[string, { utilization: number | null; resets_at: string | null } | null | undefined]> = [
    ["opus", limits.seven_day_opus],
    ["sonnet", limits.seven_day_sonnet],
  ];
  for (const row of limits.model_scoped ?? []) {
    scopes.push([row.display_name.toLowerCase(), { utilization: row.utilization, resets_at: row.resets_at }]);
  }
  for (const [family, window] of scopes) {
    const read = usageWindow(window);
    if (!read) continue;
    out.push({ family, used: read.used, ...(read.resetsAt !== undefined && { resetsAt: read.resetsAt }) });
  }
  return out;
}

// The models whose caps the CLI's answer releases: the models Weft holds a cap on whose family the
// CLI now reports with room.
//
// A cap whose window has already passed is not here (the store drops those on its own), and a cap
// with no known end is only released when the CLI reports that family's window with room AND that
// window is the one that is open — a window that has already reset is not evidence of anything.
export function releasedModels(limits: PlanRateLimits, now = Date.now()): string[] {
  const held = modelLimits(now);
  if (!held.length) return [];
  const windows = familyWindows(limits);
  if (!windows.length) return [];
  const released: string[] = [];
  for (const cap of held) {
    const id = cap.model.toLowerCase();
    const window = windows.find((w) => id.includes(w.family));
    if (!window) continue;
    // Still full: the cap stands.
    if (window.used >= 100) continue;
    // A window that has already reset says nothing about the cap (the store's own TTL handles that).
    if (window.resetsAt !== undefined && window.resetsAt * 1000 <= now) continue;
    released.push(cap.model);
  }
  return released;
}

// Frees the caps the CLI's answer releases, and says which models were freed.
//
// This is the store's own "forget a model" (lib/model-limit.ts), called when the PLAN changed rather
// than when the model's window ran out. It returns the models it freed, so the caller can wake the
// cards parked on them.
export function releaseUpgradedModels(limits: PlanRateLimits, now = Date.now()): string[] {
  const released = releasedModels(limits, now);
  for (const model of released) clearModelLimit(model);
  return released;
}
