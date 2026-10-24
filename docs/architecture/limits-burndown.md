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
- `lib/runner-turn.ts`: `updateLimits(id, backend, patch)` is the per-thread writer (a rate-limit event,
  or the CLI's usage report from `refreshLimits()` after a turn); it updates the card's stats (only while
  the card is still on that CLI) and records the sample under the CLI that reported it.
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
  share becomes a share left. The lookback: `const back = now - weekStart < NEW_WEEK &&
  rows.some((s) => s.at < weekStart) ? LOOKBACK_DAYS : 0` — the chart reaches into the week before
  only when the history it was given actually holds those days.
- `app/api/limits/route.ts`: `GET /api/limits` returns the account's whole limit history (every
  CLI's readings) — the only answer it gives. There is no `?backend=` narrowing, on purpose: a caller
  that narrowed to one CLI would get a history too short to look back with, and the chart would quietly
  stop reaching into the week before a reset. The one place that wants a single CLI's own readings
  reads the log itself (`lib/plan-limits.ts`, on the server).
- `lib/plan-limits.ts`: `planLimits(samples)` → each CLI that has reported an entry, and each entry
  carries the **pool's** newest 5-hour and weekly reading (see "One pool per account" below);
  `liveWindow(window, now)` reads a window whose reset has passed as full. Each entry gets its own
  copy of the pool's window, not the pool's object, so a consumer that changes one CLI's window
  doesn't change the others'. The entry's `reportedAt` says when that CLI last reported (the strip
  names the plan by it), and `fiveHourAt` / `sevenDayAt` say when the pool read each window — the
  number is the pool's, so its time is the pool's too. `GET /api/limits/plans` serves it and
  `lib/use-plan-limits.ts` shares one copy across every strip on screen, read again each minute and
  when the open card gets a new reading (null where the route isn't there, the web board).
- `components/StatusStrip.tsx`: two parts. The thread's, only for an open card: folder, `[cli · model]`
  (`stats.runsOn`, the model its session started on, else the last turn's costliest), context, cache,
  tokens. The plan's: that card's CLI's windows from the plans, or with no card open (the board footer,
  `lib/board-derive.ts` `footerFor`) every CLI's by name. On the web board the card's own reading stands in.
- `components/LimitBurndown.tsx`: the 640 px SVG (`CHART_WIDTH`), in a 664 px `Tip` over each plan's
  `Limit` chips, titled with the CLI's plan. Colors are the theme's `--ok` and `--danger`.
  `NowLevel` draws the level standing right now: the line, the dot at now and the number on it.
  `useSamples()` reads `/api/limits`: the plot is drawn over the account's whole
  history, so it can reach back into last week.

## Data flow

CLI event or turn end → `updateLimits` → a sample in the log under the session's CLI, and card
`stats.fiveHour` / `sevenDay` while the card is still on that CLI. Background tick → `startLimitPoll` →
spare or one-off `usage_EXPERIMENTAL_*` → `recordLimits` → a sample. Strip → `GET /api/limits/plans` →
the pool's newest windows, one entry per CLI that has reported. Hover → `GET /api/limits` (the
account's whole history) → `limitsChart()` adds the plan's current reading → SVG.

## One pool per account

The plan limits are **one pool per account**, shared by every CLI: Claude Code and puku-cli report the
same 5-hour and weekly windows, with the same reset times, because they draw from the same plan.
Measured on the author's machine on 2026-10-23: puku read `five_hour used=100 resetsAt 21:30` at
19:45:15, while Claude Code read `used=99` at 19:43:51 and `used=100` at 19:47:40 against the same
21:30 reset — one climbing counter, not two. The history log held 684 samples: 682 from Claude Code
and 2 from puku, both from that one evening.

So the limits are not per CLI, and nothing may read them as if they were:

- **The history behind the chart is the account's.** `components/LimitBurndown.tsx`'s `useSamples()`
  asks `/api/limits`, which answers with the whole history. Filtering by CLI starves the CLI with the
  fewest samples (puku had 2 of 684 here, all from that one evening), and the lookback
  (`rows.some(s => s.at < weekStart)`) is then permanently false: the chart stays at seven days
  however fresh the weekly reset. The account's history has those days.
- **The plan the strip NAMES is the card's own CLI's**, and so are the numbers in the summary. The
  `backend` prop still names it ("Claude Code's plan" / "puku-cli's plan") and still supplies
  `stats.fiveHour` / `stats.sevenDay`.
- **`planLimits()` puts the pool's reading on every entry.** Each entry is keyed by the CLI that
  reported (so the strip can name it), but it carries the pool's newest reading of each window. A
  card on a CLI that stopped reporting shows the account's real limits instead of a stale snapshot
  of its own — on the machine above, puku's entry carries `used: 25`, the pool's newest reading,
  rather than puku's own stale `100` from 19:45.
- **A pool window is dated by the pool's reading, not by the CLI that carries it.** The entry's
  `reportedAt` is when that CLI last reported; `fiveHourAt` / `sevenDayAt` are when the pool read
  each window. `lib/use-start-gate.ts` stamps the sample it builds with the window's own time, so
  the start gate doesn't claim a value was seen before it was read.

Two things that look like per-CLI limits but are not: the **model's** own cap is per model
(`lib/model-limit.ts`, `~/.weft/model-limits.json`), and a card's `stats.fiveHour` / `stats.sevenDay`
is that card's own last snapshot, which the card keeps until the next reading.

The other way a plan's number leaks across CLIs was the card's stats: `lib/backend-switch.ts`
`switchPatch` used to keep them, so a puku card showed Claude's `5hr:0% reset 9:30pm` (and a Claude
model) until puku finished a turn — 37 puku cards on the board carried Claude's reset times. A switch
now keeps only the folder's `branch`, `added` and `removed`.

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
- The two samples from 23 Oct 19:45 carry `"backend":"puku"`, and they are puku's own readings: a
  sample's `backend` is the CLI that reported it (`recordLimits(backend, …)` in
  `lib/limit-history.ts`, called with the session's own backend), so puku's CLI wrote them. They are
  two readings of the same pool Claude Code was reading, which is the point of the section above.
  They age out of the log after 8 days; until then they are part of the pool's history like any other
  reading, and the pool's newest reading is newer than both, so they don't move the numbers.
