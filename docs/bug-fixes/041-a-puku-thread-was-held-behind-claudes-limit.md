# 041 — a puku thread was held behind Claude's limit

**Date:** 2026-10-26 · **Severity:** High (no crash; a thread on a plan with room could not be started at all, and the one escape offered — switching model — did nothing)

## Symptom

The New thread dialog would not let the user send. The Start button read **"Start at 2:30am"** and the
status line said the 5-hour limit was used up. Picking a different model in the composer changed
nothing: still blocked, still "Start at 2:30am".

## Root cause

Two limits were being confused, and the confusion was in the plan mapping rather than in the model
mapping.

**The plan limits were read as one pool per account.** `lib/plan-pools.ts` grouped the CLIs as
`GROUPS = [["claude", "puku"], ["codex"], ["goose"]]`, on the premise that Claude Code and puku-cli read
the same Anthropic subscription's 5-hour and weekly windows. That premise is wrong:

- Claude Code runs on Anthropic's subscription and reads the claude.ai account's windows — the SDK's
  `rate_limits` come from the claude.ai usage endpoint (`sdk.d.ts:4293`), and are **null** for API-key,
  Bedrock and Vertex sessions (`sdk.d.ts:4286`).
- puku-cli bills through Puku's gateway (`lib/puku-proxy.ts` points at `https://api-cli.puku.sh`) and has
  its own allowance. The SDK's `SDKRateLimitInfo` is documented as *"Rate limit information for
  claude.ai subscription users"* (`sdk.d.ts:5674`), and `rateLimitType` can only be `five_hour`,
  `seven_day`, `seven_day_opus`, `seven_day_sonnet`, `seven_day_overage_included` or `overage`
  (`sdk.d.ts:5680`) — there is no reading for a gateway's own allowance. A puku session's own limit
  arrives as Puku's 429 (`lib/puku-proxy.ts`), which carries no window at all.

So the two CLIs read two different counters, and putting them in one pool made each one's window answer
for the other.

**Where it bit.** `lib/limit-reset.ts` `planWindow()` filtered samples by `samePool()`, so Claude Code's
spent 5-hour window came back as the answer for a puku thread. `resetFor()` turned that into
`{ kind: "five_hour" }`, and the New thread dialog's `useStartGate()` drew "5-hour limit used up" on it.
The server's `lib/start-gate.ts` said the same thing, so the card was scheduled for the reset rather
than started. Changing the model could not help: the limit was never the model's.

**Why the premise existed.** Commit `bcabb72` ("the plan limits are one pool per account", 24 Oct
22:12) introduced it, on the strength of two `limits.jsonl` rows tagged `"backend":"puku"` at
2026-10-23 19:45 whose reset epoch matched Claude's to the second. Those rows were a **Claude reading
logged under the card's new backend** after a **Run on puku** switch — the misattribution that bug 031
fixed. The per-CLI reading had already been shipped (`f338d62`, "each CLI's plan limits are its own
again") and was reverted three hours later by the same commit that introduced the pool.

## Fix

- `lib/plan-pools.ts`: `GROUPS` is empty — each CLI has its own plan, so each is its own pool. The
  grouping machinery stays, because it is the one place that answers "whose counter is this?".
- `lib/limit-reset.ts` `planWindow()`: a sample answers only for the CLI that read it.
- `lib/plan-limits.ts` `planLimits()`: each CLI's entry carries its own newest reading, not a copy of
  another's.
- `lib/use-start-gate.ts` `samplesOf()`: one sample per CLI per window.
- `lib/limit-history.ts`: what Weft remembers between two samples is keyed by the CLI's own plan, so a
  puku reading is a sample of its own and not a repeat of Claude's.
- `lib/limit-resume.ts`: Claude's reset no longer releases a card parked on Puku's allowance.
- `app/api/limits/route.ts` and `components/LimitBurndown.tsx`: the chart asks for
  `/api/limits?backend=<cli>`, so it draws that CLI's own history.
- `lib/limit-kind.ts` (new, the same change): sorts a rate-limit hit into the **plan's** window or one
  **model's** own cap. The SDK names which (`five_hour`/`seven_day` are the plan's, `seven_day_opus` /
  `seven_day_sonnet` are a model's), and a per-model cap is kept out of the plan log so it gates that
  model alone — filed as a plan window it gated every model on the plan, and picking another model in
  the composer changed nothing.

## Key rule

**Each CLI has its own plan.** Claude Code reads Anthropic's windows, puku-cli reads Puku's, Codex
reads OpenAI's. A window answers for the CLI that read it and for no other, so one CLI's spent limit
never holds another back.

Two limits are per model, not per CLI: the model's own cap (`lib/model-limit.ts`) and the card's own
snapshot (`card.stats.fiveHour`). A per-model cap gates that model alone; a plan window gates every
model on that plan.

## Files

`lib/plan-pools.ts`, `lib/plan-limits.ts`, `lib/limit-reset.ts`, `lib/limit-history.ts`,
`lib/limit-resume.ts`, `lib/limit-kind.ts`, `lib/use-start-gate.ts`, `lib/runner-turn.ts`,
`app/api/limits/route.ts`, `app/api/limits/plans/route.ts`, `components/LimitBurndown.tsx`,
`components/StatusStrip.tsx`.
