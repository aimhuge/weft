# Limits chart

Hovering the status strip's `5hr` / `7d` opens a chart of the week, from one weekly reset to the next.
One plot, two axes:

- **Left axis, green:** the 5-hour limit left, as 672 equal 15-minute bars (4 per hour). Each reads the
  level at the end of its slot (or now). A slot inside a 5-hour window that has opened with nothing
  logged is hatched.
- **Right axis, red:** the weekly limit left, as 7 equal day bars drawn in front of the green at 45% so
  the hours show through. Each bar's top is its burn-down edge, the weekly level hour by hour through
  the day, drawn thick, with the day's end % on top. Days before the first reading say "no log yet".
- **Vertical lines:** red where a window ran out (its first reading at 100% used); green at each 5-hour
  reset (light: the past ones the log saw, then every 5 hours after the next one), the next 5-hour reset
  (strong) and the weekly reset (strongest, the right edge). A dotted line marks now.
- **The level standing right now:** a green line across the 5-hour window open now, at its current share
  left, with a dot and that number ("34%") on it at now. The header's "5-hour 34% left" is then a
  thing you can see in the plot, not a number you have to read off the left axis and guess which bar
  is now.
- **Last week:** in the first days of a week, the days of the week before sit on the left of the plot,
  shaded and dimmed, with a "last week" label. This lookback only fires when the history holds a
  sample older than the week's start (`rows.some(s => s.at < weekStart)` in `lib/limit-chart.ts`).

## Key files

- `lib/limit-history.ts`: `recordLimits(backend, patch)` appends a `LimitSample` (`at` ms, `backend`,
  `kind` `five_hour` | `seven_day`, `used` 0-100, `resetsAt` unix seconds rounded to the minute) to
  `~/.weft/limits.jsonl` when a window's share or reset changes for that **plan**. The CLI reports one
  reset a few hundred ms apart from call to call, so resets are compared to the minute. What Weft
  remembers between two samples is keyed by the plan (`lib/plan-pools.ts` `poolKey()`), and each CLI has
  its own plan, so the memory of a counter is the CLI's own. `readSamples()` returns the last 8 days
  oldest first, skips bad lines, and drops older lines from the file once per process. Never throws.
- `lib/limit-poll.ts`: `startLimitPoll()` runs in the background every `LIMITS_POLL_MS` = 15 minutes. It
  reuses a warm spare (or opens a one-off session the first time) for the user's default CLI in their
  most-recent project folder, asks it for its 5-hour and weekly usage, and pipes the result through
  `recordLimits`. The CLI's `usage_EXPERIMENTAL_*` is a local in-process read of its bookkeeping — no
  network, no tokens — so the cost is one process startup on the first poll if no spare is open yet
  and zero once one is. Codex cards skip it (no equivalent yet); they still get samples from thread
  turns. Booted from `lib/game-server.ts:gameState()` and `app/api/events/route.ts` next to the
  activity log.
- `lib/runner-turn.ts`: `updateLimits(id, backend, patch)` is the per-thread writer (a rate-limit event,
  or the CLI's usage report from `refreshLimits()` after a turn); it updates the card's stats (only while
  the card is still on that CLI) and records the sample under the CLI that reported it.
- `lib/limit-history.ts` `setOnLimitReset(handler)` and the `used >= 100 → used < 100` check inside
  `recordLimits` notify one subscriber when a window just reset. `lib/limit-resume.ts`
  `resumeParkedCards(backend, kind, now)` is the subscriber, installed by `lib/limit-poll.ts` on
  first import: for every non-archived, `needs_you`, `rateLimitHit` card **on that CLI's plan** (the
  filter is `samePool()`, and each CLI is its own pool, so a puku card parked on Puku's allowance is
  untouched by Claude Code's reset), it
  clears the rate-limit flag, stamps `autoResumedAt`, sets
  `lastLine = "Auto-resumed after 5-hour reset"` (or `weekly`), and replays the last user message
  the same way `lib/backend-switch.ts` does for a `rateLimitHit` card. The card's `CardMarks`
  shows an "Auto-resumed · 4:12am" chip with a tip that names the CLI. A busy card is skipped;
  the next poll cycle picks it up. The manual "Run on …" still works as an override when the
  user prefers to switch backends first.
- `lib/limit-chart.ts`: pure chart math, `limitsChart(samples, stats, now)` → `{ start, weekStart,
  end, now, hours, days, marks, fiveHourNow }`. `hours` are 672 15-minute slots of the 5-hour limit
  (`QUARTER_HOUR`); `days` are 7 day slots of the weekly limit with hour-resolution burn-down edges.
  `leftAt()` is the level at a time: the last reading while its window is open, full once it has
  reset, `"unknown"` before the first reading or inside a window that opened unlogged; `null` marks a
  slot that hasn't happened yet. The card's current windows are added at now unless they've already
  reset or are older than the history, stamped with the **card's own** CLI (`withCurrent(rows, stats,
  now, backend)`) — it used to fall back to "claude", which put a puku card's reading under Claude's
  name. `fiveHourNow(rows, stats, now)` is the open window's share
  left and its span (five hours ending at its reset): the card's own reading when it has that same
  reset, else the history's last reading held while its window is open. `undefined` when neither is
  known, and `undefined` once the window has reset (it is full again, as the header reads it), so
  the plot never draws a level the header contradicts. `shareLeft(used)` is the one place a used
  share becomes a share left. The lookback: `const back = now - weekStart < NEW_WEEK &&
  rows.some((s) => s.at < weekStart) ? LOOKBACK_DAYS : 0` — the chart reaches into the week before
  only when the history it was given actually holds those days.
- `app/api/limits/route.ts`: `GET /api/limits` returns every reading, the chart's history; with
  `?backend=claude|puku|codex` it returns that CLI's OWN readings — Claude Code's rows for `claude`,
  Puku's for `puku`.
- `lib/plan-pools.ts`: the mapping, in one place. `GROUPS` is empty — each CLI has its own plan, so
  each is its own pool; `poolOf(backend)` is the pool's CLIs, `samePool(a, b)` whether two CLIs read one
  counter, and `poolKey(backend)` the pool's name as a key. Everything that has to know "whose counter is
  this?" asks here, so the answer is never written down twice.
- `lib/plan-limits.ts`: `planLimits(samples)` → each CLI that has reported gets an entry holding ITS
  OWN newest 5-hour and weekly reading (see "Each CLI has its own plan" below); `liveWindow(window,
  now)` reads a window whose reset has passed as full. `reportedAt` is when that CLI last reported and
  `fiveHourAt` / `sevenDayAt` when that CLI read each window. Each entry gets its own copy of the
  window, so a consumer that changes one CLI's window does not change every other CLI's with it.
  `GET /api/limits/plans` serves it and
  `lib/use-plan-limits.ts` shares one copy across every strip on screen, read again each minute and when
  the open card gets a new reading (null where the route isn't there, the web board).
- `components/StatusStrip.tsx`: two parts. The thread's, only for an open card: folder, `[cli · model]`
  (`stats.runsOn`, the model its session started on, else the last turn's costliest), context, cache,
  tokens. The plan's: that card's CLI's windows from the plans, or with no card open (the board footer,
  `lib/board-derive.ts` `footerFor`) every CLI's by name. On the web board the card's own reading stands in.
- `components/LimitBurndown.tsx`: the 640 px SVG (`CHART_WIDTH`), in a 664 px `Tip` over each plan's
  `Limit` chips, titled with the CLI's plan. Colors are the theme's `--ok` and `--danger`.
  `NowLevel` draws the level standing right now: the line, the dot at now and the number on it.
  `useSamples(backend)` reads `/api/limits?backend=<cli>`: the plot is drawn over that CLI's own
  history, so it reaches back into last week whenever that plan has readings from before the week began.
  The `backend` prop names the plan in the title and supplies the card's own `stats`.

## Data flow

CLI event or turn end → `updateLimits` → a sample in the log under the session's CLI, and card
`stats.fiveHour` / `sevenDay` while the card is still on that CLI. Background tick → `startLimitPoll` →
spare or one-off `usage_EXPERIMENTAL_*` → `recordLimits` → a sample, if the plan's window changed.
Strip → `GET /api/limits/plans` → one entry per CLI that has reported, each carrying that CLI's own
newest windows. Hover → `GET /api/limits?backend=<cli>` → that CLI's whole history → `limitsChart()`
adds the card's own reading → SVG.

## Each CLI has its own plan

**Each CLI reads its own counter.** Claude Code runs on Anthropic's subscription and reads the
claude.ai account's 5-hour and weekly windows. puku-cli bills through Puku's gateway and has no
Anthropic plan limit. Codex is on OpenAI's plan. So the windows a reading carries answer for the CLI
that read them and no other: a puku thread is not gated by Claude Code's spent 5-hour window, and
Codex's window never touches either.

A CLI's *reading* is recorded under the CLI that made it — the log says who reported a number, and
now that is also whose plan the number is about.

### Why the pool was wrong, and how it was undone

Commit `bcabb72` ("the plan limits are one pool per account") read Claude Code and puku-cli as two
fronts onto one Anthropic counter, on the strength of two `limits.jsonl` rows tagged
`"backend":"puku"` at 2026-10-23 19:45. Those rows were not puku's own report of Puku's plan. A card
switched with **Run on puku** kept its Claude stats, and `lib/runner-turn.ts` `updateLimits` logged a
late Claude reading under the card's *new* backend — so a Claude reading became a "puku" row. That is
bug 031, and it is fixed: `lib/backend-switch.ts` `switchPatch` drops the old session's numbers, and
readings are logged under `session.spec.backend`.

The revert's own chain of reasoning — that the SDK's `rate_limits` come from the claude.ai usage
endpoint, and so must be Anthropic's account's wherever they are read — is the premise that does not
hold. `sdk.d.ts:4286` is explicit that `rate_limits` is null for API-key, Bedrock and Vertex
sessions: the SDK reports **plan** windows, and a session on a gateway with its own billing has its
own plan. `SDKRateLimitInfo` is documented as *"Rate limit information for claude.ai subscription
users"* (`sdk.d.ts:5674`), and `rateLimitType` can only be `five_hour`, `seven_day`,
`seven_day_opus`, `seven_day_sonnet`, `seven_day_overage_included` or `overage` (`sdk.d.ts:5680`) —
there is no reading for a gateway's own allowance, so there is nothing for a puku session to report
except Puku's 429 (`lib/puku-proxy.ts`), which carries no window at all.

The consequence of the wrong pool was the bug a user hit on 2026-10-26: Claude Code's 5-hour window
reached 100%, and a puku thread — on a plan with room — was held behind it with "Start at 2:30am".
Changing the model changed nothing, because the limit was never the model's.

The per-CLI reading was already shipped once (`f338d62`, "each CLI's plan limits are its own again")
and reverted three hours later by `bcabb72`. `lib/plan-pools.ts` now holds the per-CLI mapping, with
`GROUPS` empty: every CLI is its own pool.

What keeps one CLI's numbers out of another's strip:

- **A reading is logged under the session's CLI.** `lib/runner-turn.ts` `updateLimits(id, backend, patch)`
  takes `session.spec.backend` and leaves the card's stats alone once the card has moved to another CLI.
- **A CLI switch drops the old session's numbers.** `lib/backend-switch.ts` `switchPatch` keeps only the
  folder's `branch`, `added` and `removed`; it used to keep everything, and 37 puku cards on the board
  carried Claude's `5hr:0% reset 9:30pm` and a Claude model.
- **The pools are named in one place.** `lib/plan-pools.ts` `GROUPS` is the whole mapping — empty, so
  every CLI is its own pool — and a CLI added
  later reads its own numbers until someone says otherwise. `poolOf()` / `samePool()` / `poolKey()` are
  the only way anything asks.
- **A CLI that has not reported has no entry.** The strip says "no plan limits yet" for it, even though
  its pool's other CLI has reported: the entry says who reported, and the windows it carries are the
  pool's. `planLimits()` copies the pool's newest window onto every entry of that pool, each as its own
  copy, so a consumer that changes one CLI's window does not change every other CLI's with it.
- **The chart draws the CLI's own history.** `GET /api/limits` answers with every reading, and
  `?backend=` answers with that CLI's own readings. A puku card's chart reaches back into last week
  whenever Puku's own history has readings from before the week began.

Two other limits are not per CLI: the **model's** own cap is per model (`lib/model-limit.ts`,
`~/.weft/model-limits.json`), and a card's `stats.fiveHour` / `stats.sevenDay` is that card's last snapshot
until its next reading. docs/bug-fixes/031-puku-cards-showed-claudes-limits.md has the whole story.

## The footer and the open card

The board footer used to show `latestLimits(cards)`, the stats of whichever card changed last, when no
card was open: any turn, move or rename elsewhere flipped its model, tokens and limits to that card's
without saying so. It now shows only each CLI's plan. In an open card, the model chip reads
`stats.runsOn` (set at session start), not `stats.model`, which is the last turn's costliest model and
can be a subagent's, or blank after a turn that reported no usage.

## Notes

- The 15-minute slot size trades off bar width (~0.9 px each on a 640 px chart) for finer time
  resolution: a window that opened and closed while no thread was running (a few hours of "no log yet"
  stretches) now fills in continuously.
- Limit hits come from these samples, not from transcripts. `lib/usage.ts` also detects hits from
  transcripts for the Loom's usage chart; the two aren't unified yet.
- The two samples from 23 Oct 19:45 carry `"backend":"puku"`. They were a Claude reading logged under a
  card's new backend after **Run on puku** (bug 031), not puku's own report of Puku's plan; they age out
  of the log after 8 days, and until then they sit in puku's own history as a reading that was never
  puku's.
