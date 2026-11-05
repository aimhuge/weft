# 048 — a plan upgrade was never noticed

**Date:** 2026-10-29 · **Severity:** High (no crash; the user paid for more room and Weft kept acting as if they had none — models stayed marked exhausted, new threads were scheduled hours away, and parked cards never woke up)

## Symptom

The user upgraded their Claude plan. Weft carried on as if nothing had changed: the model picker still read
**"— at its limit"**, the New thread dialog said **"Start at 2:30am"**, and a card parked on Opus stayed in
**Needs you**. From the user's side the upgrade had done nothing.

## Root cause

Weft holds three limit stores, and the per-model one had no way out.

**The per-model store only knew how to expire.** `lib/model-limit.ts` remembers a hit as "Opus ran out, until
Tuesday". `modelLimits()` drops it once that window's own reset passes — but nothing cleared it when the **plan**
changed. After an upgrade the account has more room, yet the stale cap kept gating the model until Tuesday.

```ts
// before — lib/limit-history.ts, the only automatic release path
for (const s of fresh) {
  const prev = l.last.get(key(s.backend, s.kind));
  if (prev && prev.used >= 100 && s.used < 100) {
    try { l.onReset?.(s); } catch { /* the hook must never break the chart */ }
  }
}
```

That hook fires on a **transition** from `used >= 100` to `used < 100`. An upgrade never produces one: utilization
stays at 100 (or the window is renamed), so the transition never happens. `clearModelLimit()` already existed — it
had **no production caller**.

**The answer was already arriving, uncompared.** The CLI's own usage call
(`query.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET`) carries the per-model weekly windows:
`rate_limits.seven_day_opus`, `rate_limits.seven_day_sonnet`, and `rate_limits.model_scoped[]`. Weft recorded the
plan's `five_hour` and `seven_day` windows from that answer but never compared the per-model windows against the caps
it held.

## Why it was hard to find

The fix was easy to draw and hard to test.

- **A `vi.mock` factory captured a stale mock reference across `vi.resetModules()`.** The factory closed over one mock
  instance; after the module registry was reset, the module under test got the new instance while the test still
  asserted on the old one. The result looked like the release logic never ran, when in fact the test was talking to a
  different object.
- **A partial `importOriginal()` mock of `./runner-state` broke `lib/backend-switch.ts`.** `runner-state` exports
  `hooks`, and `backend-switch.ts` imports it. Replacing the module with only the pieces the test needed removed
  `hooks`, so an unrelated module failed to import — a failure in the wrong place, pointing away from the limit logic.

Both were test-harness traps, not product bugs: the mocking had to be arranged so each module graph saw the mock it
expected, with the original module's exports still intact.

## Fix

**New module `lib/limit-upgrade.ts` joins the CLI's answer to the caps Weft holds.** It reads the per-model weekly
windows (`seven_day_opus`, `seven_day_sonnet`, `model_scoped[]`), matches each to the model family in the stored cap
(`claude-opus-5-5` → `opus`), and frees the caps whose window has room again.

```ts
// after — lib/limit-upgrade.ts
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
```

Two guards keep it honest. `used < 100` means the cap only goes when the CLI says there is room. And the window's
reset must **not already have passed** — a rolled-over window is not evidence of an upgrade, so that cap stands.

**Called from both places Weft learns the limits.** The 15-minute poll (`lib/limit-poll.ts`) and the thread-start path
(`lib/runner-turn.ts`'s `refreshLimits`), so an upgrade is noticed whether or not a card happens to start.

**The poll wakes the cards that were parked on the freed models.** `lib/limit-resume.ts` gains
`resumeParkedOnModels()`: it finds cards in **Needs you** whose *own* model was released (a card on Sonnet was never
parked by Opus's cap), clears the parked state and replays its last user message.

**The card says why it woke up.** `autoResumedReason: "upgrade"` (`lib/types-card-detail.ts`) is recorded on the card,
and `components/CardMarks.tsx` shows a **"Resumed · plan upgraded"** chip — distinct from the ordinary
"Auto-resumed · <time>" chip that marks a normal window reset.

## Key rule

**A limit's end is not only its reset time — the plan can change under it.** Any cap we hold must have a path out for
the case where the underlying allowance changes, and the CLI's own answer is the evidence.

## Files

- `lib/limit-upgrade.ts` (new) — `releasedModels`, `releaseUpgradedModels`: frees caps whose weekly window has room
- `lib/limit-poll.ts` — the 15-minute poll calls `releaseUpgradedModels()` and wakes parked cards
- `lib/runner-turn.ts` — `refreshLimits()` releases stale caps on thread start
- `lib/limit-resume.ts` — `resumeParkedOnModels()` wakes cards parked on the freed models
- `lib/types-card-detail.ts` — `autoResumedReason: "reset" | "upgrade"`
- `components/CardMarks.tsx` — the "Resumed · plan upgraded" chip
- `lib/model-limit.ts` — `clearModelLimit()`, the store's own forget (now with a production caller)
- `lib/limit-history.ts` — the reset hook that only fires on a `used >= 100 → used < 100` transition
