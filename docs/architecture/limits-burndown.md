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

## Key files

- `lib/limit-history.ts`: `recordLimits(backend, patch)` appends a `LimitSample` (`at` ms, `backend`,
  `kind` `five_hour` | `seven_day`, `used` 0-100, `resetsAt` unix seconds rounded to the minute) to
  `~/.weft/limits.jsonl` when a window's share or reset changes for that CLI. The CLI reports one reset a
  few hundred ms apart from call to call, so resets are compared to the minute. `readSamples()` returns
  the last 8 days oldest first, skips bad lines, and drops older lines from the file once per process.
  Never throws.
- `lib/limit-poll.ts`: `startLimitPoll()` runs in the background every `LIMITS_POLL_MS` = 15 minutes. It
  reuses a warm spare (or opens a one-off session the first time) for the user's default CLI in their
  most-recent project folder, asks it for its 5-hour and weekly usage, and pipes the result through
  `recordLimits`. The CLI's `usage_EXPERIMENTAL_*` is a local in-process read of its bookkeeping — no
  network, no tokens — so the cost is one process startup on the first poll if no spare is open yet
  and zero once one is. Codex cards skip it (no equivalent yet); they still get samples from thread
  turns. Booted from `lib/game-server.ts:gameState()` and `app/api/events/route.ts` next to the
  activity log.
- `lib/runner-turn.ts`: `updateLimits()` is the per-thread writer (a rate-limit event, or the CLI's
  usage report at `init` and, through `refreshLimitsAfterTurn()`, after each turn at most every
  `LIMITS_EVERY_MS` = 5 minutes per thread); it updates the card's stats and records the sample.
- `lib/limit-history.ts` `setOnLimitReset(handler)` and the `used >= 100 → used < 100` check inside
  `recordLimits` notify one subscriber when a window just reset. `lib/limit-resume.ts`
  `resumeParkedCards(backend, kind, now)` is the subscriber, installed by `lib/limit-poll.ts` on
  first import: for every non-archived, `needs_you`, `rateLimitHit` card on that backend, it
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
  reset or are older than the history. `fiveHourNow(rows, stats, now)` is the open window's share
  left and its span (five hours ending at its reset): the card's own reading when it has that same
  reset, else the history's last reading held while its window is open. `undefined` when neither is
  known, and `undefined` once the window has reset (it is full again, as the header reads it), so
  the plot never draws a level the header contradicts. `shareLeft(used)` is the one place a used
  share becomes a share left.
- `app/api/limits/route.ts`: `GET /api/limits?backend=claude|puku|codex` returns that CLI's readings,
  the chart's history; without `?backend`, every CLI's.
- `lib/plan-limits.ts`: `planLimits(samples)` → each CLI's newest 5-hour and weekly reading;
  `liveWindow(window, now)` reads a window whose reset has passed as full. `GET /api/limits/plans`
  serves it and `lib/use-plan-limits.ts` shares one copy across every strip on screen, read again each
  minute and when the open card gets a new reading (null where the route isn't there, the web board).
- `components/StatusStrip.tsx`: two parts. The thread's, only for an open card: folder, `[cli · model]`
  (`stats.runsOn`, the model its session started on, else the last turn's costliest), context, cache,
  tokens. The plan's: that card's CLI's windows from the plans, or with no card open (the board footer,
  `lib/board-derive.ts` `footerFor`) every CLI's by name. On the web board the card's own reading stands in.
- `components/LimitBurndown.tsx`: the 640 px SVG (`CHART_WIDTH`), in a 664 px `Tip` over each plan's
  `Limit` chips, titled with the CLI's plan. Colors are the theme's `--ok` and `--danger`.
  `NowLevel` draws the level standing right now: the line, the dot at now and the number on it.

## Data flow

CLI event or turn end → `updateLimits` → a sample in the log under the session's CLI, and card
`stats.fiveHour` / `sevenDay` while the card is still on that CLI. Background tick → `startLimitPoll` →
spare or one-off `usage_EXPERIMENTAL_*` → `recordLimits` → a sample. Strip → `GET /api/limits/plans` →
each CLI's newest windows. Hover → `GET /api/limits?backend=<cli>` → `limitsChart()` adds the plan's
current reading → SVG.

## Each CLI has its own plan

Claude Code runs on Anthropic's plan, puku-cli on Puku's, Codex on OpenAI's. On 23 Oct the log looked
like it said otherwise: two "puku" samples at 19:45 matched Claude Code's to the minute (`five_hour
used=100 resetsAt 21:30`). They were Claude's. A card hit Claude's 5-hour limit, was switched with
**Run on puku**, and two things carried Claude's numbers over:

- `lib/backend-switch.ts` `switchPatch` kept the card's `stats`, so the puku card showed Claude's
  `5hr:0% reset 9:30pm` (and a Claude model) until puku finished a turn. On the board 37 puku cards
  carried Claude's reset times. A switch now keeps only the folder's `branch`, `added` and `removed`.
- `updateLimits` logged a reading under the card's backend *at the time it landed*, so the Claude
  session's last reading after the switch went into the log as puku's. It now logs under the session's
  own CLI (`session.spec.backend`) and leaves the card's stats alone when the card has moved on.

For a while the chart read every CLI's samples as one history on the strength of that misread. It
reads one CLI's again; a CLI with no readings before the week began gets no lookback, which is correct.

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
- The two mis-tagged samples from 23 Oct 19:45 (`"backend":"puku"`, really Claude's) age out of the log
  after 8 days; until then the footer may list a puku plan built from them.

