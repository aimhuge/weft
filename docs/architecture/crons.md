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
  of the ones that will run again. Each row: schedule, next run, an on/off switch (`components/CronSwitch.tsx`, the
  same switch the thread header's popover puts beside its crons), the last runs as dots coloured by
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

## On a Weft Worker

A cron lives where its runs fire: its cards work in a checkout and a fork resumes a session on that host's disk. So a
cron a thread makes on a worker is the worker's (its own `crons.json`, fired by the worker's own `startCronClock`,
started after recovery), and `create_cron` there refuses a folder or source card that isn't the worker's. The worker
publishes its whole list after every `crons` event (`lib/worker-lists.ts` → `worker_set_lists` → `cloud_worker_lists`,
owner-only), and the Mac's `GET /api/crons` adds them (`lib/worker-lists-read.ts`) with their `worker://` folder, an id
`worker:<worker>:<cron>` and `worker` set to its name, so the ⏰ drawer and count include them, and a worker project's ⏰
shows only that worker's. The drawer's switch, Edit, Run now and Delete reach the worker as host verbs (`cron.update`,
`cron.run`, `cron.delete`; `lib/worker-list-acts.ts`), held to what the drawer changes (never the folder, CLI, mode or
agent, never a "!" prompt), and a run from the Mac starts in the mode a card from the network may. A worker card's
thread header ⏰ makes one there too: `components/ThreadCronButton.tsx` sends `cron.create` through `hostOf(card).act`
(`lib/host-api/cron-create.ts`, args.id the card, so each run takes the card's folder, CLI, model, effort and agent on
the worker); remoteRefusal keeps the row to what the popover sends (`cronCreateRefusal`, @weft/client list-policy.ts:
prompt, schedule, name, fork or fresh, the message to fork at, a window, on or off, run now; never a "!" prompt), the
worker narrows the cron's mode to what a card from the network may start in (`lib/worker-kinds.ts` `listVerb`), and a
Mac refuses it from the network like its other list verbs. The popover reads the list again once the worker has
republished it (`useCrons().later`). The other way,
`list_crons` on a worker lists the Mac's crons too, read-only as `mac:<id>` (`lib/mac-crons.ts` publishes a summary to
`cloud_mac_crons`), and refuses to change one. Details:
[project-hosts.md](project-hosts.md#crons-and-webhooks-both-ways-as-built).

## Crons Weft runs for itself

Two crons are not a user's scheduled job but Weft's own upkeep, both in `~/.weft/crons.json` and both made
over MCP from a thread:

- **Weekly repo analysis** (Mondays 10:00, fresh thread, `~/dev/weft`): runs the repo-analysis skill's
  four scripts over the repo (docs/architecture/skills.md; the skill ships five, but `docs-drift.sh` is the
  superseded shell version of `docs-drift.mjs` and nothing calls it) and writes a report to
  `~/.weft/show/repo-analysis/report-YYYY-MM-DD.html`, so the weekly runs accumulate rather than overwrite
  each other. It **diffs against the previous run** — the point is what moved since last week, not what
  is — and leads with what got worse, what got better, and a short read on whether the repo is getting
  healthier. The first report is `~/.weft/show/repo-analysis/index.html`, and its style is the house style
  the later ones copy. Its infrastructure and quota numbers are **live, not baked**: the page reads
  `/api/infra/live` through Weft's own bridge on open, so the database, storage and egress figures are
  true at the moment you read the report (docs/architecture/infra-live.md).
- **Daily growth summary** (daily 9:00): posts the day's growth numbers to the #user-growth Slack channel
  through the board's own API.

## API

`GET/POST /api/crons` (list; make, with `runNow`), `PATCH/DELETE /api/crons/[id]`, `POST /api/crons/[id]/run`. The board
calls them through `lib/cron-client.ts`.

## Not yet

Codex and Goose threads can't be forked on a cron (fresh only). The run page is asked for in the run's prompt, not
written by Weft.
