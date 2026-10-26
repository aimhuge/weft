# Crons

A cron runs a thread again on a schedule. Each run is a **new card**: by default a fork of the thread it was made
from (its context, folder, model and the page it had open), or a fresh thread with the prompt only. The source thread
is never written to, so every run starts from the same point.

## Where you meet it

- **⏰ in a thread's header** (`components/ThreadCronButton.tsx` → `components/CronButton.tsx`): lists the thread's crons
  (on/off, delete) and makes a new one from the thread's last message. Violet while the thread has crons.
- **⏰ on one of your messages** (hover, `components/RepeatFromHere.tsx`): "Repeat from here" opens the same popover
  anchored on that message. It talks to the header through a window event (`lib/cron-events.ts`), so nothing is threaded
  through the memoised thread view.
- **⏰ in the New thread window** (`components/NewThreadHeaderActions.tsx`): puts the prompt being written on a cron
  instead of starting it once, with the window's folder, CLI, model and mode; "Also run now" fires the first run.
- **⏰ Crons on the left rail** (under 🏷, `components/CronsDrawer.tsx`): every cron, soonest first, with a count badge
  of the ones that will run again. Each row: schedule, next run, an on/off switch, the last runs as dots coloured by
  their card's column (`lib/crons-view.ts`; click one to open that run), Run now, Edit (the same form) and Delete.
  A cron a thread made over MCP says so. The first time it opens, the drawer plays its intro video
  (`public/intros/crons.html`, docs/architecture/feature-intros.md).
- **The board**: a run's card has a violet ticket-stub edge and `⏰ run N` before its title (`components/CronMark.tsx`,
  `components/crons.css`; violet is crons' alone). Runs fold into a stack under their source card
  (`lib/cron-stacks.ts`, `components/CronStack.tsx`, wired in `components/BoardColumns.tsx`): the first click on the
  stack fans the runs out below it, the `⏰ N runs` chip folds them back. A run waiting on you stays in Needs you too.
- **The list view**: a ⏰ Crons band at the foot of the sheet, one row per cron (on with its next run or off, schedule,
  fork or fresh, folder, last run, run count); its status opens Run now and Switch on/off, and its toggle unfolds the
  run cards (`components/SheetCrons.tsx`). Runs fold under their source card's row like any child card, which says
  `⏰ next in 3h`; a run says `⏰ run N`; "⏰ cron" filters the Tags column (`lib/list-crons.ts`).

The popover's form (`components/CronEditor.tsx`, logic in `lib/cron-form.ts`): what to send, Fork from here or Fresh
thread, a repeat preset (Hourly, Daily, Weekdays, Weekly with day toggles, Monthly, Custom… for a raw cron string), a
mini calendar to pick the start day with violet dots on the days it will run (`components/CronCalendar.tsx`), the time,
an optional end date, and a plain-English readback with the next three runs.

## How a run works

- **Schedule** (`lib/cron-schedule.ts`): five-field cron in the Mac's local time (`*`, lists, ranges, steps; day of
  month and day of week OR together when both are set, as in cron). `presetOf` reads a string back into the form.
- **Store** (`lib/cron-store.ts`): `~/.weft/crons.json`, written through a temp file and a rename, publishing a
  `crons` board event that the board's `useCrons` (`lib/use-crons.ts`) reloads on.
- **Making one** (`lib/crons.ts` `createCron`): a fork needs a Claude Code or puku thread that has run. Forking at a
  message stores the session and the transcript entry before that message (`sessionRewindPoint`, the same point ↑-edit
  rewinds to), so each run re-sends the message fresh; from the header with no message id it forks at the session's
  latest reply (`sessionTip` in `lib/rewind.ts`). A message that opened the session forks nothing: the runs start fresh
  in the same folder. The page on screen when the anchor message was sent (or the source's latest) is kept for runs.
- **The clock** (`lib/cron-run.ts` `startCronClock`, started from the server's prewarm in `lib/copilot.ts`): every 15s it
  runs each enabled cron whose `nextAt` has come, one run each. A run due while the Mac slept or Weft was closed goes
  on the first check; missed runs don't stack up. A run waits while the previous run's card is still running, and
  nothing runs while a restart is armed.
- **A run** (`runCron`): a new card titled `<name> · <day>`, `cronId`/`cronRun`/`cronOf` set, the prompt plus a note
  naming the run and its run page (`~/.weft/show/crons/<cron>/run-<n>.html`). A fork run carries `forkOf`
  `{ sessionId, at }`; `specFor` (`lib/runner-state.ts`) turns that into `resume` + `forkSession` + `resumeSessionAt`
  until the card's own first turn gives it a session, and `adoptSpare` skips it so a warm spare never takes it. The
  source page opens in the run's pane, then the first message goes out (or waits for the model's reset, like a new
  thread). A run that can't start is kept on the cron with its error.

## Threads and the copilot

The board MCP has `create_cron`, `list_crons`, `update_cron`, `delete_cron` and `run_cron_now` (`lib/cron-tools.ts`),
in every thread and the copilot, trusted like `create_card` (`CRON_TOOL_NAMES` in `lib/cron-types.ts`). A thread's
`create_cron` forks itself by default. `cron-tools` loads `cron-run` only when a run fires: `cron-run` reaches the
runner, which builds these tools.

## API

`GET/POST /api/crons` (list; make, with `runNow`), `PATCH/DELETE /api/crons/[id]`, `POST /api/crons/[id]/run`. The board
calls them through `lib/cron-client.ts`.

## Not yet

Codex and Goose threads can't be forked on a cron (fresh only). The run page is asked for in the run's prompt, not
written by Weft.
