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
   `~/.weft/limits.jsonl` as puku's. This is the likeliest origin of the two `"backend":"puku"` samples at
   2026-10-23 19:45 (`five_hour used=100 resetsAt 21:30`, between Claude Code's 99 at 19:43 and 100 at
   19:47). It is not proven: a puku-cli session that relayed the same windows would write the same rows.
3. **The footer borrowed.** `footerFor` / `latestLimits` showed the stats of the card with the newest
   `updatedAt` when no card was open.

An earlier version of this fix read those two rows as proof that "the limits are one pool per account,
shared by every CLI", and then as proof that they were mislabeled. Neither follows from two rows. Claude
Code runs on Anthropic's plan and puku-cli on Puku's, so the numbers are kept per CLI, which is right
whichever way the 19:45 rows came about: if puku reported them they are puku's, and if they were a
misattributed Claude reading, the log now records readings under the session that sent them.

## Fix

- `lib/backend-switch.ts` `switchPatch` keeps only `branch`, `added` and `removed`: the old session's
  model, context, cache, tokens and limits go.
- `lib/runner-turn.ts` `updateLimits(id, backend, patch)` records under the session's own backend
  (`session.spec.backend`) and leaves the card's stats alone once the card has moved to another CLI.
- `lib/plan-limits.ts` `planLimits()` keeps each CLI's own newest reading of each window; the strip shows
  the open card's CLI's plan, or each CLI's by name with no card open (`footerFor` no longer borrows).
- The chart asks `/api/limits?backend=<cli>` and draws that CLI's plan, titled with it.

**Key rule:** a plan limit belongs to the CLI whose session read it. Never copy one CLI's reading onto
another's entry, and never log a reading under a backend other than the session's.

## Files

`lib/backend-switch.ts`, `lib/runner-turn.ts`, `lib/plan-limits.ts`, `lib/use-plan-limits.ts`,
`lib/use-start-gate.ts`, `lib/board-derive.ts`, `app/api/limits/route.ts`, `app/api/limits/plans/route.ts`,
`components/StatusStrip.tsx`, `components/LimitBurndown.tsx`.
