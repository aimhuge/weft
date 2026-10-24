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
  remembers between two samples is keyed by the POOL (`lib/plan-pools.ts` `poolKey()`), not by the CLI:
  the counter is one, so the memory of it is one, and a puku reading that repeats Claude Code's current
  value is not a new sample. `readSamples()` returns the last 8 days oldest first, skips bad lines, and
  drops older lines from the file once per process. Never throws.
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
  first import: for every non-archived, `needs_you`, `rateLimitHit` card **on that plan** (the
  filter is `samePool()`, so a puku card parked on the account's spent window resumes with a
  Claude Code one), it
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
  `?backend=claude|puku|codex` it returns that **plan's** readings — the same rows for Claude Code and
  for puku-cli, and only Codex's own for Codex.
- `lib/plan-pools.ts`: the mapping, in one place. `GROUPS` is `[["claude", "puku"], ["codex"], ["goose"]]`;
  `poolOf(backend)` is the pool's CLIs, `samePool(a, b)` whether two CLIs read one counter, and
  `poolKey(backend)` the pool's name as a key. Everything that has to know "whose counter is this?"
  asks here, so the answer is never written down twice.
- `lib/plan-limits.ts`: `planLimits(samples)` → each CLI that has reported gets an entry holding the
  POOL's newest 5-hour and weekly reading (see "One plan per account" below); `liveWindow(window, now)`
  reads a window whose reset has passed as full. `reportedAt` is when that CLI last reported and
  `fiveHourAt` / `sevenDayAt` when the POOL read each window. Each entry gets its own copy of the
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
  `useSamples()` reads `/api/limits` with no query: the plot is drawn over the ACCOUNT's history, so it
  reaches back into last week whenever the account has readings from before the week began — on a puku
  card as much as on a Claude Code one. The `backend` prop still names the plan in the title and still
  supplies the card's own `stats`.

## Data flow

CLI event or turn end → `updateLimits` → a sample in the log under the session's CLI, and card
`stats.fiveHour` / `sevenDay` while the card is still on that CLI. Background tick → `startLimitPoll` →
spare or one-off `usage_EXPERIMENTAL_*` → `recordLimits` → a sample, if the plan's window changed.
Strip → `GET /api/limits/plans` → one entry per CLI that has reported, each carrying the PLAN's
newest windows. Hover → `GET /api/limits` → the account's whole history → `limitsChart()` adds the
card's own reading → SVG.

## One plan per account, one reading per CLI

The plan limits are **one pool per account**. Claude Code and puku-cli read the same Anthropic plan's
5-hour and weekly windows, so a card's numbers are the account's numbers whichever CLI it runs on, and
the chart is drawn over the account's whole history. Codex is on OpenAI's plan and has its own.

A CLI's *reading* is still recorded under the CLI that made it — the log says who reported a number, not
whose account the number came from. Those are different things, and conflating them is what made a puku
card look like it was showing Claude's limits.

### How the counter reaches puku

The billing and the counter are two different things, and puku changes only the first. Puku bills through
Puku's gateway; the 5-hour and weekly windows are Anthropic's account windows, and a puku session reads
the same account's windows that Claude Code does. The chain, link by link:

- **Both CLIs run the Anthropic Agent SDK.** `lib/runner-session.ts` `queryOptions()` builds the SDK's
  `Options` for every backend, and `lib/runner-turn.ts` and `lib/limit-poll.ts` both read it through
  `session.query?.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET(...)`.
- **The SDK's `rate_limits` are Anthropic's subscription windows.** `sdk.d.ts:4293` documents them as
  *"Plan rate-limit utilization windows from the claude.ai usage endpoint"*, and `sdk.d.ts:4286` gives the
  account's `subscription_type` ('pro' | 'max' | 'team' | 'enterprise'). The SDK reads claude.ai's usage
  endpoint, so the number is the Anthropic account's, whoever made the call.
- **Puku's gateway speaks Anthropic's `/v1/messages`.** `lib/puku-proxy.ts:10` points at
  `https://api-cli.puku.sh`, and a request without a key answers Anthropic's own error shape
  (`{"error":{"type":"authentication_error","code":"missing_token"}}`), not a Puku-specific one.
- **The headers come back untouched.** `lib/puku-proxy.ts:202-203` copies every upstream response header
  except the ones `DROP_RESPONSE` (`lib/puku-proxy.ts:58`) names —
  `/^(content-encoding|content-length|transfer-encoding|connection)$/i` — so Anthropic's
  `anthropic-ratelimit-*` reach the SDK, and the SDK turns them into `rate_limits`.
- **A puku thread on Weft's trial goes through that proxy.** `lib/puku-trial.ts` `trialOptions()` sets
  `PUKU_AI_BASE_URL` to Weft's deployed `/api/puku`, which is `lib/puku-proxy.ts` and relays the headers.

So there is no second counter to read: a puku session's reading *is* the Anthropic account's window, which
is why a puku card can show the account's 5-hour burn and a puku chart can reach back into the week
before. The user's own word — that puku is not on Anthropic's plan — is true of the billing and not of
the counter.

One link is not provable from this repo: a puku thread signed in to Puku with its own key talks to
`api-cli.puku.sh` directly, and whether *Puku's* gateway relays Anthropic's rate-limit headers the way
Weft's own proxy does cannot be read from here. The log settles that case, not the mechanism: the two
puku rows on 23 Oct carry the same reset epoch as Claude's, to the second, and the next value in a
climbing sequence — a second counter would carry its own epoch.

### What the log said, and what it decided

The log once seemed to say otherwise. On 2026-10-23 it held 684 samples, 682 from Claude Code and 2 from
puku, and the puku rows matched Claude's counter to the minute: puku `five_hour used=100 resetsAt
21:30` at 19:45:15, between Claude Code's `used=99` at 19:43:51 and `used=100` at 19:47:40. Two ways to
read that — a Claude session's reading logged under the card's new backend after **Run on puku**, or puku
relayed the same windows — and the log alone cannot tell them apart. It can, once the mechanism is in
sight, and the mechanism is above. The two rows are puku's own report:

- **The five-hour row is not a duplicate.** Under the mislabel reading it would have to be a re-report of
  a value already in the log. No earlier Claude row carries `used=100` with reset `1792765800`.
- **It is the next step in one climbing sequence.** The counter ran 93, 92, 94, 95, 96, 97, 98, 99 across
  19:38–19:43, all with reset `1792765800`, and the puku row is 100 with that same epoch — the same
  integer, not a near miss. Two independent plans would not share a reset epoch to the second.
- **The readings are logged under the CLI that made them.** `lib/runner-turn.ts:344` uses
  `session.spec.backend` and `lib/limit-poll.ts:110` records the backend that was polled, so a puku row
  means a puku session reported it. The misattribution that could have produced it — logging a Claude
  reading under the card's *current* backend — was the bug fixed in `lib/backend-switch.ts`
  `switchPatch`, and a puku card's stats are dropped on a switch now.

The log's own count has moved on since (765 rows, 763 from Claude Code and 2 from puku) but the two
puku rows are the same two, and they age out eight days after they were written.

What keeps one PLAN's numbers out of another's strip:

- **A reading is logged under the session's CLI.** `lib/runner-turn.ts` `updateLimits(id, backend, patch)`
  takes `session.spec.backend` and leaves the card's stats alone once the card has moved to another CLI.
- **A CLI switch drops the old session's numbers.** `lib/backend-switch.ts` `switchPatch` keeps only the
  folder's `branch`, `added` and `removed`; it used to keep everything, and 37 puku cards on the board
  carried Claude's `5hr:0% reset 9:30pm` and a Claude model.
- **The pools are named in one place.** `lib/plan-pools.ts` `GROUPS` is the whole mapping —
  `["claude", "puku"]`, `["codex"]`, `["goose"]` — so a CLI in no group is its own pool and a CLI added
  later reads its own numbers until someone says otherwise. `poolOf()` / `samePool()` / `poolKey()` are
  the only way anything asks.
- **A CLI that has not reported has no entry.** The strip says "no plan limits yet" for it, even though
  its pool's other CLI has reported: the entry says who reported, and the windows it carries are the
  pool's. `planLimits()` copies the pool's newest window onto every entry of that pool, each as its own
  copy, so a consumer that changes one CLI's window does not change every other CLI's with it.
- **The chart draws the pool's whole history.** `GET /api/limits` answers with every reading, and
  `?backend=` answers with the PLAN's readings — the same rows for Claude Code and for puku-cli. A puku
  card's chart reaches back into last week whenever the account has readings from before the week began,
  which is the whole point: it used to ask for puku's own rows and find two of them.

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
- The two samples from 23 Oct 19:45 carry `"backend":"puku"`. They are puku's own report of the
  Anthropic account's window (see "What the log said, and what it decided"); they age out of the log after
  8 days, and until then they are the account's newest reading of that window, whichever CLI reported it.
