# Dev servers and Services

Weft owns the dev servers threads run, instead of each one living inside the thread that started it.

## Why

A thread that starts `pnpm dev` with Bash `run_in_background` puts the server in its CLI's process group
(`lib/cli-process.ts`). That server keeps the idle CLI open (`lib/task-ledger.ts` `hasLiveTasks`), dies when the
CLI closes (a Weft restart), and sits in the thread's task strip as "1 task running" with no other home.

## How

- `lib/devserver.ts`: one run per card (`runs`, keyed by card id), spawned detached in its own process group with
  the vault's development values (`lib/secret-run.ts` `devSecrets`). Each run keeps its command, folder, url,
  card title and start time; `startDev`, `stopDev`, `restartDev`, `devStatus`. Weft stops them all when it exits.
  The plain (no-vault) launch path parses the command into argv (`splitCommand`, quote-aware) and calls
  `spawn(bin, args, { shell: false })` — a command containing shell metacharacters
  (`| & ; < > \` $ ( ) { } \`) is refused outright with a clear error, so a launcher from
  `lib/dev-commands.ts` can never travel through a shell. The vault launch path already takes a
  structured `{ bin, args }` from `secret-run`, so this only applies to user-supplied commands.
  `startDev` refuses a command that would start a second Weft in Weft's own folder (`startsWeft`, from
  `lib/restart-guard.ts` `restartTarget`): its `dev` script frees port 1024 first, killing the board every card runs
  on. That covers the devservers tool, review tours and the Services drawer's Start.
- `lib/devserver-tools.ts`: `mcp__devservers__start` (command, url, cwd inside the project; reuses a live run with
  the same folder and command so two cards don't fight over a port; waits up to 60s for the url), `status`
  (the whole list) and `stop`. `DEVSERVERS_PROMPT` in every thread's system prompt (`lib/weft-prompts.ts`) and
  `/weft:preview` step 3 point threads at it. Trusted, so no permission prompt (`lib/board-tools-trust.ts`).
- The review tour's `dev` command goes through the same runs (`app/api/cards/[id]/dev`), with the tour's url.
- `lib/devserver-list.ts` `listDev()`: every Weft run (probed in parallel), plus running background shell tasks a
  thread still started the old way (`lib/tasks.ts` `isDevServerTask`, a pattern on the task's description; its url
  parsed from "port 4001" or "localhost:4001"). Those are stop-only: stopping goes through `lib/task-stop.ts`.
- `app/api/devservers`: GET the list, POST `{ action: "stop" | "restart", cardId, taskId? }`.
- The rail's 🖥 drawer is now **Services** (below); dev servers are rows in it with their url, Restart (Start once it
  died) and End.
- `lib/tasks-view.ts` leaves running dev-server tasks out of the thread's task strip and the card's ⑂ count.

## Services

The 🖥 drawer lists every process Weft spawned, not only dev servers, with CPU and memory.

- `lib/services-snapshot.ts` `listServices()`: one `ps -axo pid=,ppid=,pgid=,%cpu=,rss=,etime=,command=` (~30 ms),
  plus what the server knows: each session's CLI pid (`CliProcess.pid`, `lib/cli-process.ts`) and session id, warm
  spares, and `lib/devserver.ts` runs. `listDev()` adds dev servers that aren't running (Start) and ones threads run
  in their own CLI (`task`, stop-only; their CPU counts under that CLI).
- `lib/services.ts` `buildServices()` (pure): finds the root (the highest ancestor of the Next server that is still
  Weft: Electron main in the app, `next dev` alone), walks down, and starts a service at each process it knows (a
  thread CLI by pid, else by the `--resume`/`--session-id` in its command line, so CLIs started before an update
  still find their card; a dev server by pid). Electron, its helpers, the Next server and its Turbopack workers are
  `weft`; another child of Electron main is a `terminal` (the drawer's node-pty shells); anything else is `other`.
  Every process below a service belongs to it, so a CLI's row sums its Bash commands, test runs and subagents.
  The snapshot's own `ps` is left out.
- `lib/services-kill.ts`: End on a `cli` closes its session (`endSession`, as keep-alive would), a `dev` stops its run,
  a `task` stops its task, anything else gets SIGTERM per process (children first) and SIGKILL after 2s. Ending a
  process that leads a service ends the service; one inside it gets SIGTERM/SIGKILL alone. Anything in `weft` is
  refused (403): ending the server or Electron would cut every thread off.
- `app/api/services`: GET the list and `machine` (`machineInfo()`: `os.cpus().length` and `os.totalmem()`), POST `{ action: "kill", id | pid }` or `{ action: "restart", id: "dev:<cardId>" }`.
- `lib/use-services.ts` + `lib/services-view.ts` + `lib/services-prefs.ts` + `components/ServicesDrawer.tsx`: the
  drawer. The header has the total out of this Mac ("2.8 of 10 cores · 7.9 GB of 16 GB", its tooltip the share in %)
  and the refresh rate (1, 2, 5, 10, 30s or paused; cookie
  `weft-services-refresh`, default 2s); closed, it polls every 30s for the icon's count (services running, Weft
  itself not counted). With a project picked, services from other folders hide; Weft, terminals and other commands
  have no folder and always show. Under the header, `components/ServicesSummary.tsx` draws `summarize()`
  (`lib/services-summary.ts`): a CPU bar and a memory bar against the whole Mac, one slice per kind, a legend with each
  kind's cores and memory, and the busiest service (1% CPU or more) plus the biggest by memory when that's another one.
  CPU is ps's `%cpu` (100% is one core, a decaying average); memory is RSS.

## Dev servers section

The top of the Services drawer, above the usage summary (`components/DevLaunchers.tsx`), starts and stops a working folder's dev server by hand.

- `lib/dev-commands.ts` `detectDevCommands(folder)`: reads, never runs. `package.json` scripts named dev, start, serve,
  develop, preview or storybook, or whose body runs a server (`next dev`, `vite`, `astro dev`, `wrangler dev`, …), run
  with the folder's package manager (`packageManager`, else the lockfile: pnpm, yarn, bun, npm); a Procfile's `web:`;
  `bin/dev`, `bin/rails server`, `manage.py runserver` (with `.venv/bin/python` when there); deno tasks; a Makefile
  dev/run/serve/start target; `npx wrangler dev` when nothing else. The url comes from a port flag or `PORT=` in the
  script, else in the file it hands off to (`sh scripts/dev.sh`), else the framework's default port. Three at most.
- `lib/dev-launchers.ts`: working folders are the non-archived cards' folders minus Weft's own (`process.cwd()`).
  Weft's own folder, when a card works in it, comes last as `{ self: true }`: never probed, never launched
  (`launch` still refuses it, and `pnpm dev` would free port 1024 by killing this board); its row reads "Weft itself" and links
  its `url` (`http://127.0.0.1:$PORT`, else the dev script's) through `window.weft.openExternal`, since the pane refuses Weft's own server.
  A run keyed by a card id (a thread's `mcp__devservers__start`) carries `cardId` and `title`, so the row's "· by …" opens it.
  `listLaunchers()` pairs each command with the run serving it (`runFor`: same cwd and command, live first), probing
  its url; with no run, a url that already answers is flagged `answering`. `launch(cwd, command)` only runs a command
  `detectDevCommands` names in a working folder (else `LaunchRefused`, 403): a live run is restarted (`restartDev`),
  anything else starts under the ended run's key or `folder:<cwd>`. It answers `started` or `restarted`.
- `Run.restarts` counts `restartDev` calls; the row shows "Restarted 23:41 · 2×".
- `GET /api/services` returns `launchers` beside `services`; `POST { action: "launch", cwd, command }`.
- One row per folder; a folder with several commands gets a `<select>` (`pickCommand`: the pick, else a live one, else
  the first). After a click a "✓ Started" / "✓ Restarted" / "✓ Stopped" chip shows for 4s. **Stop** shows beside
  Restart on a live run and ends it through the drawer's kill (`kill({ id: run.id })`, `lib/services-kill.ts` → `stopDev`).
- In the services list below, a row whose `cardId` is still on the board names its card as a button (`ServiceName`),
  which opens it through the rail's `onOpenCard`.

## Stopping one task

Separately, every running row in the task strip has a ■ Stop (`app/api/cards/[id]/tasks/[taskId]/stop` →
`lib/task-stop.ts`): the SDK's `query.stopTask(id)`, after which the CLI's `task_notification` marks it stopped. A
task with no CLI left to ask is marked stopped directly.

## Gaps

- A process that daemonizes (double-forks to PID 1) leaves Weft's tree and the drawer.
- Runs live in the Next server's memory: a Weft restart stops them (as before), and the list starts empty.
- Codex threads reach the tools over HTTP like the other MCP servers, but nothing stops a Codex thread from
  starting a server in its own shell.
- The Stop button on the thread still kills background tasks with the turn; declaring the SDK's
  `perTaskStopAffordance` would spare them now that each has its own Stop.
