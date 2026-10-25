# 031 — a puku card showed Claude's plan limits

**Date:** 2026-10-23 · **Severity:** Medium (no crash; the numbers on screen were another CLI's, so a card could read `5hr:0%` for hours after a reset it had never seen)

## Symptom

A puku card's status strip read `[opus-4-8] 5hr:0% reset 9:30pm` while Claude Code's own card, opened
beside it, read `5hr:84% reset 2:30am`. The footer, with no card open, flipped between the two on its
own: it showed whichever card had changed last, and the model chip changed with it. The hover chart for
the puku card drew a flat week.

## Root cause

Three things carried one CLI's numbers into another's strip:

1. **A CLI switch kept the card's stats.** `lib/backend-switch.ts` `switchPatch` changed the card's
   backend and left `stats` alone, so a card switched with **Run on puku** after hitting Claude's
   5-hour limit kept `fiveHour: { used: 100, resetsAt: 21:30 }` and a Claude model until puku finished
   a turn. 37 puku cards on the board carried Claude's reset times.
2. **Readings were logged under the card's current backend.** `lib/runner-turn.ts` `updateLimits` called
   `recordLimits(getCard(id).backend, …)`, so a reading a Claude session sent after the switch landed in
   `~/.weft/limits.jsonl` as puku's.
3. **The footer borrowed.** `footerFor` / `latestLimits` showed the stats of the card with the newest
   `updatedAt` when no card was open.

## What the 19:45 rows turned out to be

An earlier version of this fix read the two `"backend":"puku"` samples at 2026-10-23 19:45 as proof that
"the limits are one pool per account, shared by every CLI", and then as proof that they were mislabeled.
Neither follows from two rows, and the second reading was wrong.

They were **a Claude reading logged under the card's new backend** — the misattribution in point 2 above.
The fix in this card (`lib/backend-switch.ts` `switchPatch` drops the old session's numbers, and
`lib/runner-turn.ts` `updateLimits` records under `session.spec.backend`) is what stops it happening
again. Commit `bcabb72` later read the same two rows as proof of a shared account and re-introduced the
pool; see bug-fix 038 for why that was wrong and what it cost.

## Fix

- `lib/backend-switch.ts` `switchPatch` keeps only `branch`, `added` and `removed`: the old session's
  model, context, cache, tokens and limits go.
- `lib/runner-turn.ts` `updateLimits(id, backend, patch)` records under the session's own backend
  (`session.spec.backend`) and leaves the card's stats alone once the card has moved to another CLI.
- `lib/plan-limits.ts` `planLimits()` gives each CLI that has reported its **own** newest window (see
  below), each as its own copy; the strip shows the open card's CLI's plan, or each CLI's by name
  with no card open (`footerFor` no longer borrows).

## Key rule

A **reading** belongs to the CLI whose session sent it: never log a reading under a backend other than
the session's, and never carry a card's old session's numbers across a CLI switch.

A **window** belongs to the plan, and each CLI has its own plan: Claude Code reads Anthropic's account
windows, puku-cli reads Puku's. So a card's numbers are its CLI's numbers, whichever CLI it runs on.
Conflating a reading with a plan is what produced this bug — the switch leak above, and the chart that
never looked back (docs/bug-fixes/037-limits-chart-never-reached-back-into-last-week.md).

`lib/plan-pools.ts` is where the pool mapping lives, so nothing has to work it out again.

## Files

`lib/backend-switch.ts`, `lib/runner-turn.ts`, `lib/plan-pools.ts`, `lib/plan-limits.ts`,
`lib/use-plan-limits.ts`, `lib/use-start-gate.ts`, `lib/board-derive.ts`, `app/api/limits/route.ts`,
`app/api/limits/plans/route.ts`, `components/StatusStrip.tsx`, `components/LimitBurndown.tsx`.
