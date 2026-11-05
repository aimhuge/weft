# Copilot check-ins (the copilot speaks first)

The copilot is a product partner, not a status feed: the swim lanes already say what's running, waiting on you or
finished. So it never counts cards, and when it speaks first it brings one idea: what to build next, or a refactor worth
doing now. Weft starts these turns ("check-ins") itself, at a few moments worth a thought, and a check-in the copilot has
nothing for is taken back out of the chat.

## Overview

- **Morning**: once a day, the first tick after 7:00 when a card did something in the last hour (you're at work). The
  copilot reads the projects (roadmap, recent commits, issues) and, if it can, their analytics, and names the one thing it
  would build or fix next.
- **Landed**: a busy project's `HEAD` moved and stayed put for `SETTLE_MS` (10 min, so a burst of commits is one check-in).
  The commits since the last baseline, minus changelog/release/merge bookkeeping, plus the refactor scout's open findings
  there, and the copilot names one refactor worth doing now.
- **Limits** (`blocked`): quiet from 21:00 to 7:00, at most `MAX_PER_DAY` (3), `MIN_GAP_MS` (2 h) apart, never while the
  copilot is busy, and never while its last check-in is still unanswered (one idea waits at a time, never a stack).
- **QUIET**: the check-in tells the copilot to reply exactly `QUIET` when nothing clears the bar. `watchForQuiet` then
  drops the check-in and its answer from the thread (`dropThreadFrom` in `lib/store.ts`), unless you wrote in between.
- **The dot**: the launcher shows a dot, not a number, when the copilot's latest reply (a check-in's idea or an answer)
  came after you last looked (`hasUnread`, the `weft-copilot-read` cookie). Seeing the peek or the chat marks it read.
  The peek shows that reply; a QUIET one never counts (`isQuiet`).
- **Off switch**: "Checks in on its own" in the copilot's name menu (`GET`/`POST /api/copilot/check-ins`), stored as
  `off` in `~/.weft/copilot-initiative.json`.

## Key files

- `lib/copilot-initiative.ts`: the pure rules. `InitiativeState`, `blocked`, `waitingIdea`, `settledMove` / `markLanded`
  (HEAD baselines; a project Weft hasn't seen is only recorded), `counted`, `morningDue`, `morningText` / `landedText`
  (what the CLI gets), `shownText` / `isCheckIn` (the short line the thread shows), `worthALook`.
- `lib/copilot-initiative-run.ts`: the clock. `tick` (reads each active project's HEAD, applies the rules, sends),
  `sendCheckIn` (`sendUserMessage` with the short text shown and the full ask as `cli`), `watchForQuiet`, `readState` /
  `writeState`, `checkInsOn` / `setCheckInsOn`, `startCheckIns` (every 5 min, from `prewarm` in `lib/copilot.ts`).
- `lib/copilot-lane.ts`: `lastReplyAt`, `hasUnread`, `isQuiet`, `lastReply` (skips QUIET). `lib/use-copilot-unread.ts`
  is the launcher's hook; `components/CopilotHider.tsx` draws the dot, `components/CopilotPeek.tsx` the latest idea.
- `lib/board-tools-trust.ts` `COPILOT_PROMPT`: who the copilot is (the four jobs, refactors, analytics), that board updates
  are context only, and how to answer a check-in. `lib/copilot-digest.ts` labels its board note "context only".
- `components/CopilotPersonaMenu.tsx`: the switch. `app/api/copilot/check-ins/route.ts`, `api.copilotCheckIns` /
  `api.setCopilotCheckIns`.

## Patterns

- A check-in is a real copilot turn on the copilot's own model, so it can use every tool it has (analytics MCPs, `gh`,
  reading code). Its cost is bounded by the daily cap, not by a cheap pre-filter.
- The check-in's text asks the copilot not to open the browser pane or start, stop or message cards: you decide.
- The CLI keeps a QUIET check-in in its session context; only the thread on screen drops it.
