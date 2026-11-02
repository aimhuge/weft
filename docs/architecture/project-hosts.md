# Project hosts: one code path for local and Worker projects

Status: **design** (2026-11-01, merged with "one engine, two transports" 2026-11-02). Phase H1 is in progress; H2 (the
`host` command) is built ([below](#the-host-command-h2-as-built)), and so is H3, `hostFor` and one open card
([below](#hostfor-and-one-open-card-h3-as-built)), and H3b, composer parity ([below](#composer-parity-h3b-as-built)), and H5, one host program ([below](#one-host-program-h5-as-built)), and H4, project reads and the editor
([below](#project-reads-and-the-editor-h4-as-built)). It follows on from [weft-worker.md](weft-worker.md#worker-projects-on-the-desktop-board),
where a Worker project shows on the desktop board but most of what a local project gets drops out.

## The problem

A project on a Weft Worker is a path, `worker://<worker id>/<folder>`. `localPath` (`lib/worker-project.ts`) turns it
into `null`, and `components/Board.tsx` feeds that to everything that touches a folder, so on a Worker project the
header badges, the terminal, the drawers and the copilot all drop out, and its cards draw `readOnly`. Each of those
features reads the Mac directly: a route under `app/api/*` calls `lib/*` on a path on this disk, or Electron main.
There are two code paths, and every new feature lands on the local one only.

The goal: **full parity**, and ideally **the local project is a worker too**, so the board has one way to reach any
project.

## What drops out on a Worker today

Read in the source (2026-11-02). Each gap is a missing command kind and a missing handler on the board, not a missing
engine: the daemon runs the same `lib/runner.ts`.

| Feature | Local | On a Worker card |
| --- | --- | --- |
| Permission mode | PATCH `permissionMode` | default/acceptEdits/auto through the `mode` command; no `plan` mid-card |
| Model, CLI, effort on an open card | `switch-backend`, `rerun-model` | the model picker and the first-message banner's rerun, as `card.switchBackend` / `card.rerunModel` (H3); the rerun is on the card's own CLI's default (`hostRerunModel`), not this Mac's backup model |
| Agent | PATCH `agent` | none |
| Rename, tags, star, archive, move, delete | PATCH, `CardActions` | all but delete, as `card.update` (H3); no delete verb yet |
| ↑ edit, Restart, Fresh | `messages`, `fresh` | as host verbs (H3) |
| "!" shell | `shell` | none: the box still turns amber and says "A shell runs only on this Mac's cards." (`shellRefusal`), sending nothing |
| Wait, Me first, Others first | `permission` | as host verbs, on the tile and in the thread (H3) |
| Stop a subagent task | `tasks/[taskId]/stop` | `card.stopTask` (H3) |
| Attachments in a reply | `/api/attachments` | images and PDFs travel as blobs on `reply`, `run` and `new_card` (`lib/attachment-transfer.ts`, 2026-11-02) |
| Send later | `desktop: true` | `card.schedule` / `card.unschedule`, the worker's daemon holding the timer (H3b) |
| "/" skills list | `/api/skills?cwd=` | `skills.list`, the worker's own list for the card's checkout (H3b) |
| Plan limits meter | this Mac's limits log | the card's own reading, from the worker's CLI (H3b) |
| Show rail, editor | Board's open card | the show rail, in Board's own open card (H3); the editor and file links through `files.*` (H4) |
| Review tour | `desktop: true` | the tour and the no-tour panel (card data), each step's page in the card's pane column (`lib/pane-open.ts`); no dev server step |
| Skills menu, Run /skill | `/api/skills`, `api.send` | the header menu (its list from `skills.list`) and the right-click Run /<skill>, as `card.message` |
| Skill set chip, ⏰ crons | `desktop: true` | none (`cardCan(card, transport, "skills" / "cron")`) |
| ⌘F over the whole thread | `/thread/search` | `GET /api/worker-board?card=&q=` over the card's `cloud_thread_items` (`lib/worker-thread-reads.ts`); sealed rows and cut tool results aren't searched |
| Pictures in the thread | `/api/attachments/<name>` | blob refs signed through `GET /api/worker-board?blobs=` and drawn by the transport's `useView` (`lib/worker-blob-view.ts`) |
| New thread, Backlog | POST `/api/cards` | the header's count from the worker's snapshot (H4); `card.create` (tags, CLI, model, effort, mode, Isolated; `start: false` is the worker's Backlog), Backlog reorder as `card.update { before }` (board parity) |
| Isolated | the warm worktree pool | the daemon's own pool (`startWorktreePool` after recovery), a reflink or plain copy of `node_modules` on Linux; lands on Done as on the Mac (board parity) |
| Notifications, dock badge | `board-live` announce, chimes | the same `noticeCard` per read (`useWorkerNotices`); the badge counts every card on the board (board parity) |
| Streaming | SSE | a 2.5 s poll |
| weft.zip and the phone | | reply, answer, stop and new card, and since H2 any verb as a `host` command (`cloud-inbox-cards.ts`, the same `runVerb`); the phone still has its own copy of the command shapes |


## The idea: a project has a host

Every project has a **host**: the machine that holds its checkout and runs its cards. Today there are two kinds
and the board special-cases one. The design gives them one interface.

```
                         ┌──────────── board (renderer) ────────────┐
                         │  hostFor(project) → ProjectHost          │
                         │    .read(name, args)   badges, drawers   │
                         │    .act(verb, args)    card moves, done  │
                         │    .events()           live changes      │
                         └──────┬─────────────────────────┬─────────┘
                                │                         │
                 LocalHost (this Mac)            CloudHost (a Worker)
             apiFetch 127.0.0.1 + x-weft-token   POST /api/worker-board → cloud_commands
             /api/events SSE                     snapshot rows + Realtime
                                │                         │
                    ┌───────────▼──────────┐   ┌──────────▼──────────┐
                    │ Next server (desktop)│   │ weft-worker daemon  │
                    │  mounts host-api     │   │  mounts host-api    │
                    └───────────┬──────────┘   └──────────┬──────────┘
                                └──── lib/host-api/* ──────┘
                                  one handler per verb, the same code
```

- **`lib/host-api/`** is the shared part: one handler per read or verb (`quality`, `pile`, `streak`, `backlog`,
  `card.move`, `card.done`, `terminal.open`, …), each a plain function of `(store, args)`. It's what `app/api/*`
  routes already do, moved out of the route so a second caller can mount it.
- **The desktop's Next server is the local host.** Its routes become thin wrappers over `host-api`. Nothing about
  latency changes: same process, same 127.0.0.1 hop, same SSE.
- **The worker daemon is a remote host.** It mounts the same handlers behind `cloud_commands` (acts) and
  published snapshot rows (reads), so a handler written once works on both.
- **The board never asks "is this a worker?".** `localPath` and `isWorkerCard` stop being feature gates; they stay
  only inside `hostFor`. A feature that a host can't do yet says so through `host.can(name)`, the way
  `ThreadTransport` leaves out what a transport can't do, so the board shows one honest "not on a Worker yet" instead
  of silently dropping the badge.

`ThreadTransport` (`lib/thread-transport.ts`) is already this shape for an open thread: `localTransport`,
`workerTransport`, the web's `useCloudTransport`. `ProjectHost` is the same move one level up, for the project and
its cards, and `hostFor(project).thread` returns the transport.

### Why "local is a worker" stops at the interface

Running the desktop's engine as a separate headless daemon process, and the Next server as a pure board, is the
literal reading of "local runs on a local worker". It isn't worth doing first:

- **Speed first.** Card start is ~2 s because spares and keep-alive live in the server process. A process hop for
  every runner call adds a serialization boundary on the hottest path and a second process to keep warm.
- **The engine already runs headless.** `scripts/weft-worker.ts` loads `lib/runner.ts` and `lib/store.ts`
  unchanged. The engine is shared today; what's not shared is the layer above it: the routes, which only the
  Next server has. Sharing that layer is what gets parity.
- **The process boundary is wanted for another reason.** weft-worker.md says the real fix for tokens in a card's
  env is "a process boundary between the daemon and its cards". If that happens, it should be a daemon-and-cards
  split on both hosts, and `host-api` makes it a change behind one interface.

So the target is: **one handler layer, two transports**. The local host is a worker in every way the board can see.
Whether it's also a separate process is an implementation detail left for later (phase 5).

## Transports

| | LocalHost | CloudHost |
| --- | --- | --- |
| Reads | `GET /api/host/<name>?project=` on 127.0.0.1 | snapshot rows the worker publishes (`cloud_worker_projects`), read through `/api/worker-board` |
| Acts | `POST /api/host/<verb>` | a `cloud_commands` row, `kind = 'host'`, `{ verb, args }`; result back in a new `result jsonb` |
| Live | `/api/events` SSE | Realtime on the snapshot table (the desktop has a session), 5 s poll as today without it |
| Latency | ~5 ms | ~200 ms to claim (wake-ups) + the handler + the result write; reads are instant from the snapshot |
| Offline | always works | reads show the last snapshot with its age; acts queue and say "queued for m1mini" |
| Signed out | always works | not offered: a Worker needs an account |

- **Reads are pushed, acts are pulled.** A badge must not wait on a round trip, so a worker publishes what the header
  reads (quality, scout, pile, streak, Backlog) as one row per folder, on a change and at least every few minutes.
  `worker_set_folders` is the hook already there; it gets a sibling, `worker_put_project(key, folder, snapshot)`.
- **One generic verb, not one per feature.** `kind = 'host'` carries a verb name the daemon looks up in the same
  `host-api` table, so adding a feature never needs a migration. The daemon holds an allowlist (the table itself),
  as `mode` holds `CARD_MODES`, so a row can't name a verb that isn't there.
- **A direct channel later, for the screen and the terminal.** A pty or H.264 doesn't belong on Postgres rows.
  `tunnels.md` already opens a private address to a dev server; the same gate gives a worker's terminal a WebSocket.
  Until then, the terminal on a Worker is the one feature that says "not yet".

### The `host` command (H2, as built)

```
board ── POST /api/worker-board {action:"host", cardId, verb, args} (elevated) ── hostCommand ──▶ cloud_commands
                                                                 kind='host', payload {verb, args:{id, …}}
worker daemon: claim ─▶ readHostCommand ─▶ ownCard ─▶ remoteRefusal ─▶ engine.host = runVerb ─▶ worker_report(…, p_result)
Mac inbox:     claim ─▶ readHostCommand ─▶ macCard ─▶ approval rule  ─▶ runVerb               ─▶ update {status, result}
```

- **The row.** `lib/host-command.ts`: `hostCommand(target, verb, args)` builds it (null for a verb `isHostVerb` doesn't know;
  `args.id` is always the target card), `readHostCommand` reads it back and throws "That request names no verb.", "This host
  doesn't run X. Update it to the newest Weft." or "That request names no card.". A `card.message`, `card.message.edit` or
  `card.fresh` carries its pasted files as `attachments`, like a reply (`textArgOf`).
- **`result`** (`supabase/migrations/20261102094800_host_command.sql`) is `{ ok: true, cardId }` or `{ ok: false, error }`,
  written beside `status` and `error`. Never the card: `cloud_cards` is sealed and `result` is plain jsonb, so the card
  itself still travels through the publisher or the outbox. A worker writes it through `worker_report`'s new `p_result`
  (default null, so a worker that predates it still reports); a Mac through its own session (`result` joined the update grant).
- **Old kinds are aliases.** `reply` → `card.message`, `answer` → `card.permission.answer`, `stop` → `card.stop`, and on a
  worker `mode` → `card.update { permissionMode }`, in `lib/worker-card-commands.ts` and `lib/cloud-inbox-cards.ts`. The wire
  is unchanged and so is every error message; what only one host adds stays a check in front of the verb: the folder grant
  on an answer, `CARD_MODES` and the Codex rule on a worker's `mode`, the Mac's folder, copilot and approval checks.
- **Policy.** Only a command the worker's owner created is ever pending or claimable for it (`worker_pending`,
  `worker_claim`), but anyone holding that account's session can insert one, so the database doesn't make a row trusted.
  Both hosts therefore refuse, from the network, whatever widens what a card can touch (`remoteRefusal`): `card.shell`, and
  a `card.update` that moves the card's folder (`cwd`), changes its agent or read scope, or skips permission prompts. Those
  stay with Weft's own window, behind `elevated()`. The Mac also keeps its phone rule: a host `card.permission.answer` is
  checked as an `answer` (a signature in `args.auth`), and any other verb `needsElevation` names is refused while a phone
  is paired and the web may not approve, since the phone can't sign one yet. `result` is capped at 4 KB by a check
  constraint. Found by a security review before H2 shipped.
- **Desktop-only.** None of the 14 card verbs needs the desktop; the copilot does, so `card.message` loads `lib/copilot`
  only for it, and both hosts refuse the copilot before the verb ("That thread isn't on this worker."). `lib/host-api` imports
  relatively, because the daemon runs under jiti, which doesn't read the `@/` alias.
- **Attachments:** the inbox receives pasted files and the web composer sends them since H3c (below). The board's UI for it is H3 (below).

### `hostFor` and one open card (H3, as built)

```
board ── hostFor(card.cwd) ─┬─ localHost: thread = localTransport, act = the api client's card routes (or the caller's own call)
                            └─ cloudHost: thread = workerTransport, act = actOnWorker ── POST /api/worker-board {action:"host"}
                                                                     └─ GET /api/workers?command=<id> every 0.5 s ─ failed → reject
```

- **`lib/project-host.ts`.** `ProjectHost` is `{ kind, thread, tools, can, act, menu }`. `localHost.act` maps each verb to the
  `lib/client-api.ts` call the board already made (`card.stop` → `api.stop`, `card.switchBackend` → `api.switchBackend`, …),
  and takes the caller's own call where it had a specific one (`api.mark` for a star, `api.archive`), so every local
  request is unchanged. `cloudHost.act` is `actOnWorker` (`lib/worker-acts.ts`): the `host` command, then
  `waitForCommand` on its row with a backoff (`ACT_WAIT`: 0.5, 1, 2, 4 s; 10 s for a claim, 30 s to finish), rejecting
  with the worker's error, so a refusal takes the change back. One the worker hasn't taken by then answers `{ queued }`:
  read every 15 s for up to an hour, counted per card (`useWorkerQueued`, shown in the open card's offline line), and
  `lib/optimistic-cards.ts` keeps its change drawn with no timeout until it runs (then settles as usual) or is refused
  (then reloads). The same verb and args while one is on its way joins it instead of sending another; an opposite one
  is sent after it and the worker runs them in order (a row can't be taken back). The thread's Stop and mode picker
  send the same `card.stop` and `card.update` as the tile and the menu. `can(feature)` is all true on the
  Mac and false on a worker for `files`, `shots`, `pane`, `folder`, `agent`, `shell`, `skills`, `share`, `delete`,
  `login`, `vault` and `dev`. `menu` trims a card's right-click menu (`lib/card-menu-remote.ts`). `hostFor` and
  `hostOf(card)` are the only place that reads `worker://`, for the code H3 touched; `localColumns`, the header badges and
  the drawers still use `localPath` (H4).
- **The tile and the menu.** `use-board-cards` draws every card with `handlersFor` (`lib/card-handlers-host.ts`): this
  Mac's keep `cardHandlers`, a worker's get the same props over host verbs. The shared actions (star and tags in
  `use-board-menus`, archive and Undo in `use-board-archive`, column moves in `use-board-card-actions`, the model picker,
  the rate-limit switch, the held-edit choices on a card, the first-message banner's rerun) all go through
  `hostOf(card).act`. The list view's folder picker stays local (`can("folder")`).
- **Optimistic.** `useWorkerBoard` draws its cards through `overlayAll` / `applyIntents` and re-reads on a `reload`, as
  `lib/board-live.ts` does for local cards (only the newest of two overlapping reads draws and re-arms the poll), so `patchNow`, `stopNow`, `answerNow` and the held-edit intents land on a
  worker card at once. `stopNow`, `waitNow`, `firstNow` and `otherFirstNow` take the host's call as an optional argument.
- **The transport.** `workerTransport` gains `editLast`, `fresh`, `waitPermission`, `putFirst`, `putHolderFirst` and
  `stopTask` as host verbs, `stop` through `stopNow`, and `cardEdits: true`, which `ThreadPanel` reads (with `desktop`) to
  offer rename, tags, star, archive and the model picker. `shell` and `grantFolder` stay out because `remoteRefusal`
  refuses them from the network (a folder grant still rides inside an answer), and `listFiles` waits for H4.
- **One open card.** `BoardFrame` opens a worker card in `OpenCard`, like a local one; `OpenCard` calls
  `useProjectHost(card, …)` (`lib/use-project-host.ts`) and provides the host's transport and tool source. On a worker the
  pane column is `components/WorkerPane.tsx` (the old `WorkerOpenCard`'s `WebPane`, `WorkerScreen` input and Local
  Simulator switch, with star and archive in its toolbar), the editor column says the files aren't there, and the show
  rail reads the items the thread view drew (`workerTransport.useView` publishes them, `lib/worker-shown.ts`), starts on
  the card's page, puts the pane on a page it reopens (`onReopen`), and pictures a page with the card's last capture when
  it's an https picture, never `/api/cards/[id]/shots`. A saved page reads "page" under its picture
  (`lib/show-rail.ts` `pageLabel`). `WorkerOpenCard` is deleted. `Board.tsx` went from 396 to 395 counted lines.
- **Board parity** (2026-11-02), [below](#board-parity-as-built).
- **Open-card parity** (2026-11-02). The right-click menu keeps Run /<skill> (a `card.message`) and plan mode. The header
  gates on `cardCan(card, transport, feature)` (`lib/project-host.ts`): the transport reaches the card's host and the
  host has the feature, so `runSkill` (the Skills menu, listed by the transport's `listSkills`) shows on a worker card and
  `skills` (the chip), `cron` (⏰), `delete` and `settings` don't. The review tour shows on a worker card, its pages put in
  the card's pane column through `PaneOpenContext` (`lib/pane-open.ts`, from `useProjectHost`'s `page.open`), with no dev
  server step (`hostFor(cwd).can("dev")`). ⌘F reads the whole thread (`searchThread`, `lib/worker-thread-reads.ts`), the
  thread's pictures are signed blob refs (`useWorkerView`, `lib/worker-blob-view.ts`; page refs stay refs for the rail and
  the pane), the first-message banner reruns on the card's CLI's default (`hostRerunModel`), and "!" shows the amber box
  with "A shell runs only on this Mac's cards." instead of sending (`shellRefusal`, `ReplyBox` `noShell`).
- **Not yet.** Delete, Share… and the agent on a worker card; the editor and file links (H4); the header badges, terminal
  and drawers on a worker project (H4); the pane as the native `BrowserPane` (the worker's page still frames through
  `WebPane`); crons and the skill set chip on a worker card; a
  worker's own backup model (no worker settings sync); ⌘F over a worker card's cut tool results and sealed rows.

### Board parity (as built)

```
New thread ── POST /api/cards {cwd: worker://…, start} ── startWorkerThread (lib/worker-new-thread.ts)
     host row {verb: "card.create", args: {id: randomUUID, prompt, tags, backend, model, effort, permissionMode, isolated, branch, start}}
worker: host kind ─ readHostCommand ─ remoteRefusal ─ rules.create (no card check: it's new) ─ checkout(folder)
        ─ engine.start ─ runVerb("card.create") = createCardFromBody(body, id) (+ startCard unless start:false) ─ publish ─ report
```

- **`card.create`** (`lib/host-api/card-create.ts`): the card under the board's id (refused if taken or not id-shaped),
  `start: false` leaving it in Backlog. `remoteRefusal` holds its args to an update's rules (no folder, agent, read scope or
  skipped prompts); the folder is the row's own checkout. Its prompt carries pasted files (`textArgOf`). A Mac's inbox has
  no `create` rule and refuses it: the web's `new_card` stays its kind. The route no longer refuses Backlog on a worker.
- **Isolated.** The daemon starts the worktree pool after recovery (`scripts/weft-worker.ts`); `cloneModules` copies with
  `cp -R --reflink=auto` off a Mac (`cloneArgs`). An isolated worker card takes a worktree and lands on Done through the
  same runner code as on the Mac. The New thread dialog doesn't warm a worker's pool from this Mac.
- **Notices.** `noticeCard` (`lib/card-notice.ts`) is board-live's chime, announce, unseen dot and Away open, and
  `useWorkerNotices` runs it on each read of a worker's cards (a card's first sighting is its baseline). The dock badge
  and the browser prune read `boardCards`.
- **What reads `boardCards` now:** the header's "N running · M need you", Switch all (`lib/switch-cards.ts`: this Mac's
  through the bulk route, a worker's one `card.switchBackend` each, a running one reported rather than retried), the ⌘K
  palette (Stop through the card's host; prompt search adds `workerPromptHits` over the cards' first prompts), Archive all
  Done and Shift+E, Resume all (`card.message "continue"` / `card.restart`), the 🏷 drop (`card.update { tags }`), Backlog
  reorder within one worker's cards, the Backlog column's visibility and the project menu's counts. `localColumns` is gone.
- **Project menu.** A worker project's right-click menu adds Pin/Unpin, Hide/Show (this board's own, in localStorage:
  `lib/worker-project-marks.ts`, because this Mac's project list is read as folders by the spare, repos and sync code),
  Archive Done and Stop Running. "More" says Changelog and Re-seed Backlog are this Mac's only for a worker project.
- **Warm.** Opening a card warms its CLI on its host (`ProjectHost.warm`): `/api/warm` here, `card.warm` on a worker only
  over a session line that's up, never as a row.
- **Terminal.** With a worker card open (or a worker project chosen and no card open) the terminal drawer says it isn't
  available on that worker rather than open this Mac's shell (`terminalAway`).

### Composer parity (H3b, as built)

```
composer ── useThreadTransport() ─┬─ localTransport:  api.skills(cwd) · api.schedule/unschedule · api.uploadAttachment   (unchanged)
                                  ├─ workerTransport: askWorker("skills.list") · actOnWorker("card.schedule") · upload on this Mac
                                  └─ useCloudTransport (weft.zip): cloudHostActs ─ host rows for the card's Mac or worker; no upload
host (Mac inbox / worker daemon): runVerb ─▶ verbResult(verb, cardId, reply) ─▶ cloud_commands.result (skills fitted to 3 KB)
```

- **Three verbs** (`lib/host-api`, none elevated): `card.schedule` and `card.unschedule` (`card-schedule.ts`, over
  `lib/scheduler.ts`, so the local route `app/api/cards/[id]/scheduled` is now a wrapper) and `skills.list`
  (`skills-list.ts`, `listSkills` of the card's own folder; `/api/skills?card=` mounts it locally). The worker's daemon runs
  `startScheduler({ briefs: false })` through `onRecovered` (`lib/worker-daemon.ts`), once recovery has published and
  resumed, so a message that came due while it was down goes on the first check without racing a resumed turn; no
  briefs, because baking one is a model call.
- **Limits.** `at` is the board's clock and the host compares it with its own, so a skewed host sends early or late by
  the skew and refuses a time it thinks has passed. Two daemons on one data folder would both send a due message; one
  daemon per store is assumed, as for the rest of the engine.
- **Shell rule.** `remoteRefusal` refuses a `card.schedule` whose text is a `!` command, with the shell's message. A due
  message is sent with `sendUserMessage`, never run, so this is belt and braces. `card.schedule`'s text carries pasted files
  (`textArgOf`), so a scheduled screenshot travels like a reply's.
- **Results.** A read verb's answer goes in `result` (`verbResult`, `lib/host-command.ts`): the skills as
  `[name, description, source]` triples, descriptions cut (120, 60, 30, then none) until the JSON is under 3,000 bytes,
  then the list cut with `more` (`lib/skills-wire.ts`). The size is stored jsonb's, not JSON text's: `jsonbBytes` counts
  from above (varlena and container headers, a JEntry per element, alignment padding), held to 3,600 bytes, so the whole
  `result` stays at least 250 bytes under the 4,096 cap (tested up to 2,000 skills; not checked against a live Postgres). Chosen over the snapshot because the list is per folder and only
  wanted when "/" opens, `result` already exists (no migration), and the snapshot row (`worker_put_project`) is H4's and
  doesn't exist yet. `commandResult` now selects `result`; `askWorker` (`lib/worker-acts.ts`) posts and waits up to
  ACT_WAIT, failing rather than queueing a read, and `workerSkills` keeps a card's list 5 minutes.
- **Transport.** `ThreadTransport` gains `listSkills`, `schedule`, `unschedule` and `upload`. `useSkillTypeahead`,
  `useReplySchedule` and the composer's uploads (`insertFiles` takes the upload, `Composer`, `ComposerBottomBar`) call them.
  A worker card's upload is this Mac's `/api/attachments`: the file travels on the send, as before. A schedule a worker
  hasn't taken stays drawn until it runs. `ThreadPanel` offers Send later when the transport has `schedule` (`cloudHost.can("schedule")`
  is true too); the review panel stays desktop-only. A worker card's Send later times come from that worker's cards
  (`sameHostCards`).
- **weft.zip.** `useCloudTransport` gets ↑ edit, Send fresh, Send later and "/" through `lib/cloud-host-acts.ts` (rows
  built in the browser by `lib/host-row.ts`, which `hostCommand` shares but which doesn't load `HOST_API`). Each is
  followed to its result like `actOnWorker`: a refusal rejects, so the box puts the text back; one not taken yet is
  `{ queued }`, so Send later's row stays drawn; a queued ↑ edit or Fresh refused later shows as a failed row with its text
  above the box (`cardReplies`). The "/" list uses the same 5-minute `skillCache` as a worker card; the reply box now draws the card's
  scheduled rows, so `WebReplyStatus` dropped its "After this turn" list, and `boardCommands` keeps `host` rows off the
  strip. Pasted files came in H3c (below): the Mac's inbox receives them now.
- **Limits.** `StatusStrip cardLimits` (set off the desktop transport) reads the card's own `stats.fiveHour`/`sevenDay`,
  which the worker's CLI reported, instead of this Mac's limits log. Follow-up: the model pickers' "at its cap" marks
  (`useLimitedModels`) are still this Mac's on a worker card, and a worker could publish its whole limits log.

### Web board parity (H3c, as built)

```
weft.zip board ── setHostForEveryCard(webHost) ── hostOf(card) = webHost for every card, a Mac's or a worker's
  tiles, rows   ── useBoardCards + remoteCardHandlers ─┐
  drag, archive ── useBoardCardActions (all "remote"), useBoardArchive ─┼─ webHost.act ─ cloudHostActs.act ─ host row ─▶ Mac inbox │ worker daemon
  menus         ── useBoardMenus(popupMenu: WebMenu) ──┤                     (followed to its result, drawn at once by optimistic-cards)
  open card     ── ThreadPanel edits, holds, stopTask ─┘
  pasted file   ── webUploads: browser sha256 ─▶ weft-blobs <org>/<sha> as the visitor ─▶ row.payload.attachments ─▶ host receiveAttachments
```

- **One host for every card on the web.** `hostOf(card)` read the folder, so on weft.zip a Mac's card (a local path) got
  `localHost` and called this Mac's server, which isn't there. `lib/project-host.ts` `setHostForEveryCard(host)` puts one host
  in front of every card while it's set; the web board installs `lib/web-host.ts` `webHost` (`components/web-board/useWebHost.ts`,
  set during the first render so the tiles pick their handlers by it). It's a worker card's host on the desktop: `kind: "cloud"`,
  `can` only `schedule`, `menu` = `remoteMenu`, and `act` = `cloudHostActs.act` (any verb as a `host` row for the card's machine,
  followed to its result). So the desktop's own `remoteCardHandlers`, `useBoardMenus`, `useBoardArchive`,
  `useBoardCardActions`, `BackendPicker`, `RateLimitSwitch`, `holdNow` and `FirstMessageErrorBanner` run unchanged on the web.
- **The board** (`components/web-board/useWebCards.tsx`): `useBoardCards` draws your own cards with the desktop's handlers
  (★, Stop, ▶, archive, drag; Allow/Deny go through the board's own answer path so a paired passkey still signs); every card is
  `useBoardCardActions`' `remote`, so a drop is `card.update { column }`; `useBoardArchive` gives archive with Undo and Done's
  Archive all; `useBoardMenus` takes a `popupMenu` and `components/web-board/WebMenu.tsx` draws the same `MenuItem[]` at the pointer.
  Tags… is the desktop's `TagsDialog`. A teammate's card stays read-only (only its owner's machine obeys). Cards are drawn through
  `overlayAll` and redrawn on `onOptimistic`, as `useWorkerBoard` does.
- **The open card** (`WebThreadPanel`): the header's rename, ★, archive, tags, the model/CLI picker and the mode picker
  (`cardEdits: true`, with `edits` from `useWebCards`; a teammate's card gets a transport copy with `cardEdits: false`); Wait,
  This first, Others first and a subagent's Stop as `card.permission.*` and `card.stopTask`; the desktop's `ShowRail` beside the
  pane, with the card's capture as a page's picture and Reopen putting the pane on it; ⌘F / ⌘G (`requestThreadFind`,
  `stepThreadFind`) and `searchThread` over every synced row (`lib/cloud-thread-search.ts`: batches of 1,000 oldest first, opened
  in the browser because a sealed row only opens there, up to 20,000 rows); taps and Start on a worker's live screen as `input`
  rows (`lib/screen-input.ts`, the browser-safe half of `inputCommand`; the offer, which a Mac seals, stays in `lib/worker-commands.ts`).
- **Pasted files** (`lib/web-upload.ts`): the composer's upload hashes the file in the browser, puts it in `weft-blobs` at
  `<org>/<sha>` as the visitor (the member insert policy; "already exists" counts), and pastes `/attachments/<slug>-<sha8>.<ext>`.
  `useWebBoard.sendCommand` lists the refs a row's text pastes (`withAttachmentRefs`: a reply's text, a new card's prompt, a host
  verb's text or message) as `payload.attachments`, the same `{ name, sha, mime }` a Mac sends a worker (`lib/attachment-refs.ts`,
  split out of `lib/attachment-transfer.ts` so the browser can use it). Images and PDFs only, 25 MB, 20 a message. A worker brings
  them over as before (`/api/worker-blob` read mode). **The Mac now receives too**: `lib/cloud-inbox-receive.ts` `macReceive` reads
  each blob through the account's own session (`readBlob`), checks it and saves it in `~/.weft/attachments`, through the same
  `receiveAttachments`; `macDispatch` gives it to the card kinds as `receive` and to `new_card`'s prompt.
- **New thread** (`WebNewCardDialog`): the desktop's `ModelSelect` with its CLI rows (the CLI is sent only once picked, so the
  machine's default holds), the effort, the desktop's `ModePicker` (never skip-permissions), tags and Backlog (`start: false`,
  a card made and left in Backlog); on a worker's folder, **Plan first** and no Backlog (a worker refuses `start: false` until
  `card.create`). `NewCardPayload` gains `permissionMode` (`NEW_CARD_MODES`) and `start`; the Mac holds the mode it starts in,
  named or its own default, to the rule a mode change is (`lib/cloud-new-card-mode.ts`): never skip-permissions, a looser one
  named while a phone is paired refused, the Mac's own default (`auto` out of the box) dropped to default then, and plan
  started as default (a Mac has no plan mode, and the card maker would read it as the Mac's default); a worker
  starts in the mode named (`lib/worker-kinds.ts`). Sent as `new_card`: WP2's `card.create` hadn't landed.
- **What the web leaves out on purpose.** File names in a thread link to the editor only where the transport has `listFiles`
  (`ThreadView` sets `FileLinkContext` from it; `ToolLine` follows it), so a worker card links them again through H4's `files.list`
  and the web draws plain names (its one host has no `files` or `reads` yet: `lib/web-host.ts` answers both with a refusal); the first-message banner reads settings and offers Rerun only where there are settings to open (`openSettings`),
  and Delete only where the host can (`can("delete")`). Delete, Share…, Run /skill, bulk Resume/Switch, the Local Simulator
  switch and the review panel are still desktop-only.

### One host program (H5, as built)

```
                    lib/host/inbox.ts  createInbox: connect ─▶ pending ─▶ claim ─▶ dispatch ─▶ report   (single-flight, aside kinds)
                                       startPolling: fast until a wake-up socket joins, slow while it's up
                    lib/host/identity.ts  CommandLine: sessionLine (a Mac) │ keyLine (a worker)
                    lib/host/dispatch.ts  cardKinds(CardRules): reply, answer, stop, host ─▶ runVerb; dispatcher(table, unknown, check)
                    lib/host/beat.ts      createBeat: presence when there is one, the row otherwise
                    lib/host/address.ts   ProjectAddress { host: local | worker id, repo } ⇄ the board's path
Mac  lib/cloud-inbox.ts: session identity, postgres_changes wake-up, 30 s check, beat ticked per check; kinds in lib/cloud-inbox-cards.ts
Worker lib/worker-daemon.ts: key identity, Broadcast wake-up, 3 s / 30 s poll, 20 s beat; kinds in lib/worker-kinds.ts + lib/worker-card-commands.ts
```

- **One loop.** A pass asks who the host is (`connect`: a Mac reads the signed-in account afresh, so a sign-out between the
  read and the run runs nothing; a worker waits for recovery and has its key at hand, so it reads the queue in the same
  tick), claims each pending row, runs it through the host's table and reports. A claimed row is never retried. A
  wake-up during a pass asks for one more pass, after a failed one too. A worker's `clone`, `input` and `qa` run aside.
- **One table for the card kinds.** `host` and its aliases are written once; what differs is `CardRules` data: the card
  check (a Mac's synced folder and per-kind copilot line; a worker's own cards), `approve` (the phone-signature rule) and
  `elevated` (verbs kept on the Mac while a phone is paired), `answerAsKind` (a Mac sends a host answer through the
  answer kind), `questionReplies`, `emptyStop`, `receive` (a worker brings pasted files over), `after` (a Mac syncs now).
  A worker's `mode` (`CARD_MODES`, the Codex rule), `input`, `qa`, `run`, `login`, `github_login`, `clone` and `update`
  stay its own kinds; a Mac's `new_card` and its author, folder and workspace checks stay its own.
- **Claim and report.** A Mac claims with a conditional update under its session (an error is a claim it didn't get) and
  reports through the update-own grant (a failed report only warns). A worker uses `worker_claim` (a failure throws, and
  the pass logs it) and `worker_report`, with `p_result` only when there is one.
- **The beat.** `createBeat` serves both: a worker starts it (20 s, presence, `offline` on the way out); a Mac only ticks it
  from the inbox's check, with no presence and no `offline`, as before.
- **The address.** `lib/worker-project.ts`'s `workerProjectPath` and `parseWorkerProject` read and write through
  `ProjectAddress`; the wire stays `worker://<id>/<folder>`.

### Secrets on a worker (H8, the per-use seal, as built)

A worker card's `mcp__secrets__run` used to throw "only exists in the desktop app". Now it asks the Mac, the way a
local card asks main, and the values cross once, sealed to that worker, for that card's one command.

```
worker card: mcp__secrets__run ─ checkCommand ─ openAsk(nonce, expiry) ─ worker_secret_ask ──▶ device_calls
             (lib/secret-run.ts → lib/worker-secret-run.ts)                    tool='secret_run', newest live desktop
Mac server:  drainDeviceCalls ─ claim ─ POST /secrets/worker-ask {call} ──▶ Electron main (electron/worker-secret.cjs)
main:        re-reads the row with its own session ─ askOf (shape, expiry) ─ the worker's public_key ─ the vault the
             project's git remote names ─ the approval window, "on the worker m1mini", Touch ID ─ seal(values,
             purpose = secret-use:<card>:<nonce>:<sha256(command)>) ─ cloud_commands kind='secret_use' ──▶ {queued}
worker:      claim secret_use ─ deliverSecretUse: the ask for that nonce, same card, opens under the purpose, same
             command, names and environment, not expired ─ resolves the waiting tool ─ spawn, no shell ─ redact ─ reply
```

- **The ask** is a `device_calls` row (the worker-to-Mac table Local Simulator mode built), tool `secret_run`, queued by
  `worker_secret_ask` (`supabase/migrations/20261102170000_secret_use.sql`) for the owner's most recently seen desktop.
  It carries names, never values: the command, names, environment, cwd relative to the project, its package.json script,
  the thread's why and title, the checkout's git remote (which vault), a 64-hex nonce and an expiry 5 minutes out. Only
  the owner reads it, and it's deleted once the worker reads the answer. The Mac's drain doesn't wait on it, so a
  Touch ID left open doesn't hold up Local Simulator calls. One ask per card at a time, three ways: the worker's
  `openAsk`, `worker_secret_ask` (one per card, five per worker, in the last 10 minutes, counted under a per-worker advisory lock so two
  asks at once can't both slip under) and main, which shows one
  window at a time and refuses a second ask from a card that has one waiting.
- **Main decides from the database, not the caller.** The server only passes the call id; main reads the row through its
  own Supabase session (`owner_user` must be the signed-in user, status `claimed`, tool `secret_run`) and checks the ask
  (`electron/worker-ask.cjs`): its shape and expiry, the command again with `checkCommand`'s refusals
  (`electron/command-rules.cjs`, held to `lib/secret-command.ts` by a parity test), and no control, format or bidi
  character in the command, script, folder or remote (both sides refuse them). Both rule sets also check what a package
  runner starts (`pnpm exec sh -c`, `npx printenv`, `yarn dlx curl`) and refuse `find -exec` and git's `-c`,
  `--config-env` and `--exec-path`. The thread's why and title are capped (300 and 120 chars). The vault is the one the
  remote names, and only when that GitHub owner/repo is the repo this Mac knows the card's project as: its own projects
  and worker folders with that folder name (`electron/worker-projects.cjs` reads `settings.json` and each one's
  remote), never the worker's word for it. A project this Mac has never had is refused.
- **The worker's key is pinned.** `cloud_workers.public_key` is the worker's word (anyone with its `wwk_` key can rewrite
  it), so main seals only to a key it pinned (`electron/worker-pins.cjs`, sealed with safeStorage in
  `~/.weft/vault/worker-pins.json`, beside the paired devices), and refuses, before asking anything, when the row's key is
  another. A worker added by pairing (H10, Settings → Devices) is pinned at `worker_pair_confirm`, under that Touch ID,
  with the box key and the Ed25519 sign key main just checked (`electron/host-pairing.cjs` `pinWorker`); every ask from
  it must then carry a signature by that key over `askMessage` (`lib/secret-use.ts`, signed from `sign-key.json` by
  `lib/worker-secret-wiring.ts`), and an unsigned one is refused. The requirement is sticky: main reads
  `cloud_workers.sign_key`, pins it with the Allow if it wasn't pinned yet, and refuses a row whose sign key went or
  changed. A pin that can't be written at pairing fails the pairing and revokes the new worker. A worker with no sign
  key was enrolled by token and gets no secrets: pair it. **Re-pin** in Settings → Devices (after Touch ID,
  `worker-pins:forget`) drops the box key only; the sign key stays, so the next pin still needs the worker's signature.
  `weft-worker status` prints the box key's fingerprint, the one the window shows. A file that won't open refuses every
  worker.
- **The worker checks it's the Mac.** Sealing needs only the worker's public key, so main also signs each `secret_use`
  with this Mac's device key (`electron/desktop-signer.cjs`) over the card, the nonce and the sealed bytes
  (`secretUseMessage`). The worker takes a row only when that signature checks against the Mac key that came in the
  pairing code (`wph.<id>.<org>.<secret>.<mac key>`, carried from the Mac's screen to the box by hand;
  `lib/worker-mac-keys.ts` `trustPairingMac`, kept in `mac-keys.json`, sealed from threads). No key off the network is
  ever trusted, so a session of the owner's that seals and signs its own row before the real Touch ID gets nothing. A
  token-enrolled box trusts no Mac and takes no secrets; `weft-worker forget-macs` stops a paired one. Enrolling
  replaces the trusted Mac (never adds one), and an enrolled box enrols again only with `--re-pair` typed at a terminal
  on it. Threads can't run any of this: `lib/worker-cli-guard.ts` refuses `weft-worker`, the daemon's script, the
  installer and a pairing code handed to a runner, in every thread's guard set. The ask's signature also names the box
  key (`askMessage`), so after a Re-pin main seals only to the key the worker itself signed for.
- **The window** (`electron/approval-worker.cjs`) puts the full command and script first, with anything outside plain
  ASCII marked and named; then the folder, "the Weft Worker m1mini, not this Mac", the full git remote, the worker's key
  fingerprint ("first seen now" on the first ask) and, plainly, that the command and any code it runs on the worker get
  the values; the thread's title and why come last, as the thread's claim. Allow once only (no Always rule, no hour
  grant), and Allow and Touch ID wait until the end of the page has been on screen.
- **The seal** is `lib/worker-seal.ts`'s construction (`electron/worker-seal.cjs` is main's copy of `seal`, held to it by
  a round-trip test): X25519 to the worker's key, HKDF bound to both keys and the purpose, AES-256-GCM. The purpose names
  the card, the nonce and the command's hash (`lib/secret-use.ts`), and the plaintext repeats them with the names,
  environment and expiry.
- **The worker** (`lib/worker-secret-asks.ts`) keeps each open ask in memory only, by nonce. A `secret_use` is refused
  unless an ask with that nonce is open on that card, the payload opens under that ask's purpose, and the command, names
  and environment match exactly, before the expiry. A refusal leaves the real ask open (junk can't burn it); success
  deletes it, so a replayed row finds nothing. The tool then runs the command with `electron/secret-exec.cjs` (the code
  main's own runs use), once it has read `package.json` again and found the same script the user saw: no shell, the values in the child's env only, over the thread's own env (`cliEnv`, so the
  worker's sign-in tokens stay out), the output redacted by `electron/secret-redact.cjs` and cut to 20,000 chars. The
  values are dropped when the run ends, except in memory for `redactStored` until the card's turn ends
  (`forgetOnTurnEnd`), so a tool result in that turn that prints one is redacted too. A finished `secret_use` row's
  payload is blanked by a trigger, and one nobody took is failed (so blanked) 10 minutes on by
  `private.sweep_secret_use`, run on each new ask and every 5 minutes where pg_cron is on, so a `seal-key.json` stolen
  later can't open an old row from a backup.
- **What it guarantees.** A value is never in the model, the transcript, Supabase in the clear or the worker's disk: it
  lives in main, in the sealed row until it finishes, and in the worker daemon's memory. A row replayed, late, for
  another card or another command, or naming other secrets, opens nothing or is refused. Values leave the Mac only after
  Touch ID, per run, in a window naming the command, the names, the card and the worker.
- **Its limits.** Secrets need a paired worker; token-enrolled ones are refused on both sides. A worker trusts only the Mac
  that paired it: with two Macs signed in, the newest beat gets the ask, and the other Mac's answer is refused (route asks
  to the pairing Mac: follow-up). A worker paired before this change has no Mac key, so it must be paired again.
  Variables that load code (`NODE_OPTIONS`, `LD_*`, `DYLD_*`, `BASH_ENV`, `ENV`, `PYTHONSTARTUP`, `PERL5OPT`, `RUBYOPT`)
  are refused on the command line and as vault names, on both sides. The command runs with the
  worker's privileges, so a script that writes a value to a file leaves it there, as on the Mac. With two Macs signed
  in, the newest beat gets the ask.
- **Not yet.** A dev server's env on a worker (the vault's whole development set held for the server's life: the same ask
  with `kind: "dev"` and a long-lived redacting launcher), `fill_field` (the pane is the Mac's), missing names made into
  blanks from the worker (it says to add them on the Mac), and the vault on the host itself, its key sealed to the worker
  and opened behind a signed approval (after H7).

### Project reads and the editor (H4, as built)

```
worker: lib/worker-projects.ts ── every 5 min, 20 s after a change, never mid-turn ─▶ readProjectSnapshot (lib/project-snapshot.ts)
          └─ worker_put_project(key, folder, snapshot) ─▶ cloud_worker_projects (worker_id, folder) ── RLS: workspace reads
board:  HeaderBadges ─ hostFor(cwd).read(name) ─┬─ local: /api/quality, /api/scout, /api/pile, /api/sprint (lib/project-reads.ts)
                                                └─ cloud: GET /api/worker-board?project= (15 s cache) ─▶ SnapshotAge "12m ago, m1mini offline"
editor: OpenCard ─ FilesSourceContext = host.files ─┬─ local: filesApi (/api/cards/<id>/files)
                                                    └─ cloud: workerFiles ─ askWorker(files.*) ─▶ result.value │ result.blob ─▶ GET ?blob=
```

- **Reads are snapshots.** `supabase/migrations/20261102141500_worker_projects.sql`: `cloud_worker_projects` (one row per
  worker and folder, `snapshot jsonb` capped at 64 KB, `updated_at`), readable by the workspace's members (the owner is one),
  written only through the key-checked `worker_put_project` (500 folders a worker at most). The snapshot is the same reads a
  Mac's routes answer: quality, the scout's cached report (never a new run: a worker spends tokens on a scout only when a
  card asks), the pile and the Backlog; the pile and Backlog counts come from `lib/project-summaries.ts`, which the
  `/api/pile` and `/api/sprint` routes now call too, so the two hosts count the same way. The worker skips a folder whose
  reads didn't change until 10 minutes have passed, so `updated_at` still says it's up; the board calls a snapshot stale
  after 20 minutes, or when the worker is offline, and shows its age before the badges (`components/SnapshotAge.tsx`).
- **`read` and `files` on `ProjectHost`**, and two features: `reads` and `files` are on for a worker. `projectActs` (a
  re-scout, the commit walk-through, the sprint plan, whose prompts point at this Mac's store and server) stays off: those
  say "isn't on a worker's projects yet". The streak and the sync ask stay this Mac's (`localPath`): your streak is yours.
  Board's `localPath(workFolder)` became `projectFolders` (`lib/board-folders.ts`): the badges read any host's project, the
  terminal and the account menu only this Mac's folders. "Improve code quality" on a worker project starts the card there.
- **File verbs with results.** `files.list`, `files.read` (`at: "HEAD"` for the diff) and `files.write` in `lib/host-api/files.ts`,
  through `lib/file-access.ts` (inside the card's folder, never any `.git` (nested ones too), a secret file or a binary,
  reads capped at 2 MB, a save refused on a stale `baseHash`). `lib/file-handle.ts` closes the check-then-use race: a read
  opens with `O_NOFOLLOW` and checks the handle it holds (its `/proc/self/fd` path on Linux, else the name's realpath with
  the same device and inode) is still inside the folder; a save writes an `O_EXCL | O_NOFOLLOW` temp in the parent's
  realpath and checks that realpath again just before the rename. Every remote read and save is a line in the host's
  `<data>/remote-files.log` (when, verb, card, path). Their results don't fit H2's 4 KB `result`, so `lib/host-result.ts`
  puts a small value in `result.value` and a larger one as JSON under `<org>/results/<sha>` in the blob bucket
  (`workerResults` in `lib/worker-blobs.ts`, through the key-checked `/api/worker-blob` with `result: true`), `result.blob`
  naming its sha; the board reads it with the account's session (`GET /api/worker-board?blob=`). Results live a day: the
  worker asks the route to `sweep` its workspace's `results/` every hour, and the R2 mirror never copies them (its
  pattern is `<org>/<sha>`). Why a blob and not a bigger column: every board and host polls `cloud_commands`, and it
  carries Realtime pings, so the cap keeps it small; the bucket is already the workspace's member-readable place for a
  worker's bytes. `lib/host/dispatch.ts` gives `CardRules` a `carry` (the worker's; a Mac has none, so its inbox answers
  only small file results).
- **Over the session line (H6).** The file verbs are host verbs, so the line's `host` channel runs them through the
  same `cardKinds.host` (with the worker's `carry`) and answers the same `HostResult`, `value` or `blob`. A worker's host
  reads its files through `lineFiles(workerId)` (`lib/line-host.ts` `askOnLine`: the line when it's up, the relay's
  `askWorker` when it isn't or can't send; a call the line lost is refused, not resent), and `workerFilesVia` reads either
  result alike, a blob through `GET /api/worker-board?blob=`.
- **The editor through the host.** `lib/files-source.ts`: `OpenCard` provides `host.files`, and `useOpenFile`,
  `useEditorColumn` and `QuickOpen` read it. A worker's (`lib/worker-files.ts`) has no live reload (`live: false`: a stat every
  2 s would be a command each), caches the file index for a minute, and refuses a save over 150 KB before sending (the
  command payload is capped at 200 KB). `workerTransport.listFiles` is `files.list`, so file names in a worker thread link
  to the editor (a worker's absolute paths don't, since the board doesn't know its checkout's path).
- **The policy for `files.write`.** It's `elevated: true` in `HOST_API`, and the local `PUT /api/cards/<id>/files` now checks
  `elevated()` to match (the editor sends the launch token; a thread's curl can write files itself). From the network the
  database can't tell the Mac's elevated route from weft.zip or the phone holding the same session (H2), so the worker
  can't require "came through the Mac" until signed approvals (H7) or a Mac key (H10). What it enforces instead is what H2's
  `remoteRefusal` enforces for every verb: nothing that widens the card. A save inside the card's folder adds nothing a
  session holder can't already get by asking the card (a worker card runs `acceptEdits`, and answers are allowed from the
  network). What would widen it is refused twice, by `@weft/client`'s `file-policy.ts`: `remoteRefusal` on the path the
  row names, and the verb itself after the realpath (so a symlink can't point there), case-folded. A save may not go into
  any agent's settings or Weft's own agent folders (`.claude`, `.codex`, `.goose`, `.puku-cli`, `.agents`, `.gemini`,
  `.cursor`, `.weft`), git or hook managers (`.git`, `.githooks`, `.husky`, `lefthook*`, `.pre-commit-config.yaml`, and
  any `package.json`, whose scripts run on install), editor tasks and dev containers (`.vscode`, `.idea`, `.zed`,
  `.devcontainer`), `.mcp.json` or `.envrc`. Neither a read nor a save touches credentials anywhere in the folder:
  `.ssh`, `.aws`, `.gnupg`, `.kube`, `.docker/config.json`, `.config/gh`, `.netrc`, `.npmrc`, `.pypirc`,
  `.git-credentials`, `*.pem` and `id_*` keys (the index leaves them out too), on top of file-access's own secret files.
  A Mac's inbox runs these verbs only where the web may approve. Snapshot roots are the folder's name, never a worker's
  absolute path.
- **Not yet.** Live reload of a worker's open file (events over the H6 line); the streak counting a worker's turns; the
  commit walk-through, sprint plan and re-scout on a worker project; Realtime on `cloud_worker_projects` (the board polls on
  turn ticks and focus); blob GC for results; the terminal and drawers (vault, dev servers) on a worker project; the
  `@weft/client` `HOST_VERBS` list (H9a) must add `files.list`, `files.read` and `files.write` when it lands.

## Security

- **`lib/guard.ts` stays the local gate.** `/api/host/*` is behind `guard()`, and verbs that grant power (answer,
  mode, shell, settings, folder grants, terminal) behind `elevated()`. The same split is a field on each handler
  (`elevated: true`), so the local route and the cloud path read it from one place.
- **A cloud act is elevated by construction.** It's inserted only by `POST /api/worker-board`, which is `elevated`,
  so a thread's curl on the Mac can't send one. RLS already limits `cloud_commands` to the worker's owner
  (`created_by = owner_user`), and the daemon checks the card is its own.
- **The vault never leaves the Mac in the clear.** Touch ID lives in Electron main. A worker card that needs a
  secret (`mcp__secrets__run`, a dev server's env) asks the board; the Mac approves with Touch ID and seals the values
  to the worker's X25519 key (`lib/worker-seal.ts`, the Claude sign-in's model) on a `secret_use` command bound to
  that card, nonce and command ([H8](#secrets-on-a-worker-h8-the-per-use-seal-as-built)). The worker opens it, runs, and redacts as the Mac does. `fill_field` stays desktop-only:
  the pane is on the Mac.
- **Snapshots are workspace-readable,** like `cloud_cards`. Quality, pile counts and the streak are fine there; file
  names in the pile are as visible as they are in a card's thread today. Nothing secret goes in one.

## Card verbs

The card's own actions are verbs in `host-api` like any other: `card.update` (the PATCH body: title, tags, star,
archive, mode, agent, folder, read scope, column), `card.stop`, `card.shell`, `card.fresh`, the `messages` and
`permission` variants, `card.switchBackend`, `card.rerunModel`, `card.stopTask`. The validation the PATCH route held
privately (`validatePermissionMode`, `setMarks`, `setAgent`, `moveCard`) moves into the handlers, so a worker refuses
what the Mac refuses. `cloud-inbox.ts` on the Mac and the phone's commands go through the same table, so weft.zip and
the phone get every verb too.

## Views

The desktop board and weft.zip are one React DOM app (Electron on your Mac, a browser on weft.zip). The open card's
fork, `WebThreadPanel`/`WebPane` beside `ThreadPanel`/`BrowserPane`, plus `WorkerOpenCard` (merged in H3), merges into Board's own:
the thread, the pane and the show rail, fed by `hostFor(project).thread`, wherever the card runs. The show rail is
already a projection of the thread's items (`showMinis`); its page pictures come from the pane that shows the page.

Under the board and the phone sits **`@weft/client`**, plain TypeScript: the transports, the verb types and the view
models (board grouping, thread paging, `paneFor`, `showMinis`, the pending ask, the status line). The board draws it
with DOM components and `~/dev/weft-mobile` with React Native ones, so the two can only disagree on looks.

## Host services

The editor (files), the terminal (a pty), the browser the agent drives, dev servers and tunnels, and simulators act on
the host's own files and processes, so they're host services every host offers and every view reaches through
`ProjectHost`. They arrive natively on the Mac and as streams elsewhere. `host.can(name)` shrinks to real hardware limits
(iOS simulators need a Mac host).

## Routes: the WebRTC line

`CloudHost` has two routes. The **direct** one is the WebRTC line already built for the simulator
([weft-worker.md#the-fast-path](weft-worker.md#the-fast-path)): `lib/worker-rtc.ts`, one peer connection with named
channels, signaling sealed to the worker's key with both DTLS fingerprints inside, 198 ms gesture-to-frame at 29 fps on
m1mini's LAN. It gains `host` (verbs and their results), `events` (thread and project changes) and `terminal` channels,
and stays open while a board shows the worker's project rather than only during a watch. The **relay** is
`cloud_commands` plus the snapshot rows, used when no line forms (offline, a blocking network, before TURN), and it
keeps the offline queue and history. A board talking to a worker on its LAN then gets local speed and live streaming.

### The session line (H6, as built)

```
board (renderer)                          this Mac's server                    worker daemon
lib/session-lines.ts  retainLine(worker) ─ GET /api/rtc-ice (elevated) ─ lib/rtc-ice.ts: STUN, + Cloudflare TURN
lib/session-line.ts   offer + key + topic + ICE ─ POST /api/worker-board {action:"line"} (elevated)
                                          openWorkerLine: seal to the worker's key (LINE_PURPOSE) ─ cloud_commands kind='line'
                                                                    claim ─ lib/worker-kinds.ts line ─ lib/host-line.ts
lib/line-answer.ts  ◀── sealed answer (one-time key) on Broadcast worker-line:<128 random bits> ────────┘
            ═════ DTLS (fingerprints were inside the sealed offer and answer) ═════
  host     {id, verb, args} ─▶ the `host` kind's own handler (lib/host/dispatch.ts: CardRules, remoteRefusal) ─▶ {id, ok, result|error}
  events   ◀─ card, card_deleted, thread: what the publisher ships, as it ships it (lib/worker-publish.ts mirror)
  line     ping/pong every 5 s (→ setWorkerRoute(worker, "direct", ms)); offer/answer renegotiation
  terminal refused on open
```

- **Who holds it.** The selected chip of a worker project that isn't offline (`components/ProjectChips.tsx`) and an open
  worker card (`lib/use-project-host.ts`) each call `useSessionLine(workerId)`. One line per worker, shared, closed 30 s
  after the last lets go. A worker keeps up to 4 lines (one per board) and closes one no board has pinged for 30 s.
- **Acts.** `hostFor(worker://…)` is one `CloudHost` per worker whose `act` is `actOnLine` (`lib/line-host.ts`): on the line
  when it's up; on the relay when there's no line, when the call couldn't be sent (`LineDown`), and for text that pastes
  files (the relay uploads them). A call sent and then lost (`LineLost`, or no reply in 30 s) is refused rather than
  resent, since the worker may have run it. A worker's refusal comes back as the same error the relay gives.
- **Policy is the relay's.** The daemon hands `lines.open` the `host` kind's own handler (`lib/worker-kinds.ts` →
  `createCardCommands` → `cardKinds(...).host`), so a verb over the line passes `readHostCommand`, the card check,
  `remoteRefusal` and the CardRules exactly as a row does (`lib/session-line.real.test.ts` checks shell, folder and
  foreign-card refusals over a real line).
- **Hardening (security review).** One channel per fixed label per line, any other label closed; `host` strictly one
  verb at a time; offers over `line` one at a time and at most 5 per 10 s; a verb over the line refused while the worker
  updates itself and logged with its card and outcome (`lib/worker-kinds.ts`); `events` reuse the publisher's projection
  and uploads, and never carry a card it didn't publish (so not the copilot's delete); a screen needs
  `channel === input:<device>:<8–32 hex>`, a card of this worker's own watching the device (the relay `input` kind's
  ownCard), and gets one track per device per line (`lib/host-line-screen.ts`); the worker takes only Cloudflare's
  STUN/TURN addresses from an offer (`peerIce`, `lib/worker-rtc.ts`). The migration lists every kind plus `line` and
  `secret_use`, so it and H8's land in either order.
- **Live.** The open thread's `useLive` (`useLineLive`) stops the poll while the route is direct and applies `events`; it
  re-reads the newest page whenever the route changes. The card list applies `card` and `card_deleted` events
  (`withLineEvent`, `lib/use-worker-board.ts`) and keeps its poll for projects and cards it hasn't seen.
- **Repair.** No pong for 15 s, or ICE `disconnected`: an ICE restart offered over the `line` channel itself (5 s to
  answer). When that can't get through, or the connection fails, the line drops to the relay and a new one is offered
  through Supabase after 5 s, 15 s, 1 min, then every 5 min. An offer this Mac's server refuses (no key published, not
  your worker, a database without the `line` kind) stops the retries until the line is held again.
- **The simulator is a track on it.** `useScreenVideo` (`lib/use-line-screen.ts`) adds a receive-only H.264 m-line and an
  `input:<device>:<nonce>` channel to the line, renegotiated over `line` with `screen: {device, quality, channel}`. The
  worker attaches the watched device's `FastScreen` (`fastScreenOf`, `attach`, `input`) to the new m-line and stops it
  when that input channel closes. With no line, or a refused attach, the screen opens its own line as in H6a.
- **The terminal is refused**, on every line, with `TERMINAL_REFUSAL`. A pty is a shell, and H2 refuses a shell from the
  network because whoever holds the account's session can insert a row. A line is no better: the sealed offer proves
  that only the worker answers, not that Weft's own window offered (the worker's key is public, so anyone with the
  session can seal one). A terminal over the line needs the offer signed by a device key the worker pins (H7/H10).
- **TURN.** `GET /api/rtc-ice` (elevated: a TURN allocation is billed relay traffic) mints Cloudflare credentials for 4 h
  with `CLOUDFLARE_TURN_KEY_ID` and `CLOUDFLARE_TURN_KEY_API_TOKEN`, reused for half that, port-53 URLs dropped; without
  them, or on any failure, STUN alone. The servers ride inside the sealed offer, so the worker relays through the same
  credentials and never needs its own.
- **The route chip.** Each pong calls `setWorkerRoute(workerId, "direct", ms)` (`lib/worker-route.ts`), so the worker
  chip's tooltip reads "direct · 4 ms"; once pongs stop, relay notes take over after 15 s.
- **Migration.** `supabase/migrations/20261102160000_line_command.sql` adds `line` to the kind check. Until it's applied
  the offer's insert fails and the board stays on the relay.
- **Verified** with two real werift peers (`lib/session-line.real.test.ts`): the sealed offer, the answer under the
  one-time key, verbs and their refusals, a pushed event, ping/pong, an ICE restart over the line, and a video m-line
  plus input channel renegotiated over it. Not yet run in Electron's own Chromium, against a real worker, through TURN,
  or off the LAN.
- **Not yet.** Streaming deltas on `events`; reconnecting a dropped line over a second path (the mDNS hint); weft.zip and the
  phone sealing their own offers; Supabase leaving the card-list poll.

## Approvals and secrets

A view owns one thing: **approval**. Touch ID on the Mac is `promptTouchID` in Electron main, which approves but signs
nothing on its own, so main now signs after it with a key only main holds (mobile-security.md, "The desktop signs
too"); the phone signs (Ed25519 after Face ID, mobile-security.md). The browser's paired key sits in
localStorage and can't sign. **Passkeys** close that: a WebAuthn key in the Secure Enclave, bound to `sign.weft.zip`, a
host of its own that serves only the pairing and approve pages under a strict CSP, so a script injected into weft.zip
can't reach it. The host pins it through its own pairing session (the link's secret opens only on sign.weft.zip, plus a
Touch ID on the Mac). The approval binds the host, card, folder, pending request, tool, the whole input and the time,
and the host checks it on one verify path. The riskiest asks (a vault value, skipping permissions, an agent's config, a
folder grant) stay native on the phone or the Mac.

Secrets on a Worker start as the per-use seal above (`secret_use`). With signed approvals in place, the vault itself can
later move into the host, its key sealed to the host and opened only behind a signed approval.

## Devices and records

- **One address:** every project is `(host, repo)`, with this Mac one host among others, so `worker://` paths and
  `localPath` gates live only inside `hostFor`.
- **One card schema** (H5a, built 2026-11-02): the cloud row is a sealed projection of the host's `Card`, made by one
  module, `lib/card-rows.ts` (`projectCard`, `projectItem`), for a Mac's flush and a worker's publisher alike. Identity
  (`owner_device` and the full path on a Mac; `worker:<id>` and the project name, filled in by the RPC, on a worker), the
  transport (an upsert with the account's session in chunks of 100; `worker_put_card` / `worker_put_items` per card) and
  the sealer (the workspace key on a Mac; none yet on a worker) stay per host. The differences that remain are `RowHost`
  fields: `thumbs`, `onBlobError`, `copilot`. Two were bugs and are fixed: a Mac's `page` column skipped redaction, and a
  worker shipped the copilot from its thread events and could send one tool id twice in a batch. Also still per host:
  a delete keeps the card json on a Mac and blanks it (`{}`) on a worker. Golden snapshots: `lib/card-rows.golden.test.ts`.
- **One device registry** (H10, built 2026-11-02, [device-registry.md](device-registry.md)): `public.device_registry` shows
  every Mac, worker, phone and browser with its keys, owner, org and last seen; `device_revoke` revokes any kind; enrolling a
  worker is pairing a host (`worker_pair_*`: the same claim, proof and Touch ID), with token enrolment kept beside it.

## Cost and speed

Live traffic is what grows with use, so it leaves Supabase; the sealed history stays as the record and the offline copy.

- **Polling, before the line exists (built).** An open worker thread asks for `after=<seq>`: only items past the last one
  it has (a running card re-asks its last item, which can change in place), with the thread's total even when nothing is new, so
  a rewind shows; a gap wider than a page replaces the window (`workerThreadPage`, `mergePage`, `lib/worker-poll.ts`). It polls at
  2.5 s while the card runs or needs you, 30 s when idle, not while `document.hidden`, and once at once on return. The board list
  asks `since=<asOf>` and merges only the changed cards (`readWorkerBoard`, `lib/worker-board-merge.ts`), with a whole read
  every 5 minutes as a safety net: a changed read also names the cards deleted, turned copilot or left without a folder (`removed`), and one that fills the 500-card limit is sent as a whole read. A running thread reads its whole page every 10th poll and after each whole board read, one more read follows when it goes idle, and a reply wakes it to 2.5 s at once. One idle open thread went from about 77 MB an hour to about 4 KB.
- **The route shows (built).** A worker chip's tooltip reads "on m1mini · relay · 612 ms", the last poll's or command's
  round trip (`lib/worker-route.ts`), per worker. H6 calls `setWorkerRoute(workerId, "direct", ms)` and the label follows; a fresh direct note outranks relay reads.
- **On the line (H6):** one line per host shared by every card, opened when a worker project is selected; long tool
  outputs fetched on demand, mirrored only compressed and under a cap; items gzipped before sealing; the mirror batched
  while the line carries the live view; video on an RTP track with adaptive bitrate instead of a fixed 8 Mbps (built,
  H6a: loss-driven, 0.5 Mbps up to the quality's rate).
- **Upkeep (built):** a worker says it's up on Realtime Presence and writes its row every 5 minutes instead of every
  20 s, about 290 writes a day instead of 4,300; finished `cloud_commands` rows expire after a day (a failed clone
  or a stuck claim after 7); the fallback screen frames are WebP, about half the bytes of the JPEGs, where every board
  watching says it takes WebP (weft-worker.md#liveness, #expiring-finished-commands, #the-live-screen).

## Phases

Each ships on its own.

1. **H1 card verbs into `host-api`.** The card routes become thin wrappers over `lib/host-api`, behaviour unchanged
   (in progress).
2. **H2 the `host` command** (built 2026-11-02, [as built](#the-host-command-h2-as-built)). `kind = 'host'` with `{ verb, args }`
   and a `result` column; the daemon and `cloud-inbox.ts` run `runVerb`, and `reply`, `answer`, `stop` and `mode` are aliases
   (`new_card` stays the Mac's own kind; a worker's new thread is `card.create`, [board parity](#board-parity-as-built)). **Attachments travel:** built ahead of
   H2 for the worker's kinds (`lib/attachment-transfer.ts`: `encodeAttachments` for a sender, `attachmentsOf` +
   `receiveAttachments` for a host, [weft-worker.md](weft-worker.md#worker-projects-on-the-desktop-board)); `host`
   calls the same two. Still open: sealing the blobs, `cloud-inbox.ts` as a receiver, the web composer as a sender.
3. **H3 `hostFor` and one open card** (built 2026-11-02, [as built](#hostfor-and-one-open-card-h3-as-built)). `ProjectHost`,
   `LocalHost`, `CloudHost`; worker tiles lose `readOnly`; the open card merges, so worker cards get the show rail, the
   pickers, the menus and ↑ edit. **H3b composer parity** (built 2026-11-02, [as built](#composer-parity-h3b-as-built)): the "/"
   list, Send later and the limits meter from the card's host, and ↑ edit, Fresh, Send later and "/" on weft.zip.
4. **H4 project reads** (built 2026-11-02, [as built](#project-reads-and-the-editor-h4-as-built)). Snapshot rows
   (`worker_put_project`) for quality, the scout, the pile and Backlog; the editor through file verbs with results.
5. **H5 one host program** (built 2026-11-02, [as built](#one-host-program-h5-as-built)). The inbox, heartbeat and
   publish merged across the Mac and the daemon; one card schema; the `(host, repo)` address. **H5a one publish path**
   ([Devices and records](#devices-and-records)), then the inbox, the beat and `ProjectAddress` in `lib/host/`. Leases
   are still to come: they need a column, and this phase changed no behaviour.
6. **H6 the WebRTC line for everything live.** In order: video moves from 16 KB chunks on a reliable, ordered
   DataChannel (`lib/use-rtc-screen.ts`) to an RTP track that drops late frames, so it can't delay a click (**H6a, built
   2026-11-02:** an H.264 track negotiated in the sealed offer, the channel kept as the fallback, the rate moved on receiver
   reports by restarting idb's encoder, a PLI answered with a restart for a key frame;
   [weft-worker.md](weft-worker.md#the-fast-path)); the line
   opens while a board shows the worker's project, not only during a watch; `host` (verbs and results) and `events`
   (thread and project changes, streaming text) channels replace the 2.5 s poll (**built 2026-11-02**, [as
   built](#the-session-line-h6-as-built), with the simulator as a track on the line, TURN, and the terminal refused); Supabase leaves the hot path (the
   first sealed offer, then a history and offline mirror written beside the line, with reconnects over the line itself);
   a signed Bonjour/mDNS hint lets a board on the same LAN offer straight to the host; the browser and the phone seal
   their own offers (libsodium), so weft.zip and the phone open lines too; and a TURN relay beside the STUN server
   covers networks that block direct connections. Plus the line's cost and speed work in [Cost and speed](#cost-and-speed).
7. **H7 passkey approvals** (built 2026-11-02, not live: [mobile-security.md](mobile-security.md#4-passkey-approvals-h7)).
   Passkeys live on their own origin, **sign.weft.zip**, so an XSS on weft.zip can neither pin a key nor make the user
   sign something they didn't see: that host serves only two static pages under a strict CSP, a passkey pairs there
   through its own pairing session, and the weft.zip board opens `sign.weft.zip/approve` in a new tab, which reads the
   ask itself, shows all of it and sends the signed answer. The Mac rebuilds the message from its own names and main
   checks it (origin and rp id sign.weft.zip only, the counter kept). Grants, vault, skip-permission and agent-config
   asks stay on the phone or the Mac. Waiting on the domain, DNS, the Supabase redirect URL and the migration. The
   desktop signs too (built, not yet called by the board): main holds an Ed25519 key, signs the phone's message after
   Touch ID, and `/pairing/verify` checks it like a phone's ([mobile-security.md](mobile-security.md#the-desktop-signs-too)).
   Still open: the board's Allow asking for that signature, and a worker host pinning the Mac's key (with H10).
8. **H8 secrets on a Worker.** The per-use seal first (built 2026-11-02 for `mcp__secrets__run`,
   [as built](#secrets-on-a-worker-h8-the-per-use-seal-as-built); a dev server's env next), then the vault in the host behind H7.
9. **H9 `@weft/client`** for the phone: the transports, verbs and view models as one package. **First pass built
   2026-11-02:** `packages/weft-client`, a pnpm workspace package of plain TypeScript (no DOM, React, Next or Node; its
   own tsconfig and an ESLint rule check that), holding the stable pure pieces with re-exports at their old `lib/` paths:
   the thread-item types, the host verb names (`HOST_VERBS`, which `HOST_API` is keyed by) and arg shapes, the `host`
   command's builder and readers, the BOARD STATUS parser, `paneFor`, `showMinis` and the signed-approval message.
   Still in `lib/`: the cloud command builders (`lib/cloud-commands.ts`, under H7's change), the transports (H3b/H6),
   board grouping, thread paging and the pending ask.
10. **H10 one device registry** and one pairing flow (built 2026-11-02, migration not applied:
    [device-registry.md](device-registry.md)): `public.device_registry`, `device_revoke` for every kind, Settings → Devices,
    and Add a worker as a pairing (`worker_pair_*`); `worker_enrol` stays for tokens.
11. **Later: the process split.** Daemon and cards as separate processes on both hosts, behind the same interface.


## Risks

- **Two hosts drift.** If a handler only works on one, the parity promise breaks quietly. Each `host-api` handler gets
  one test that runs it against a local store and a worker harness (`lib/worker-daemon.harness.ts`).
- **Stale reads look real.** A snapshot from an offline worker must say its age ("12 min ago, m1mini offline").
- **The cloud path's latency on acts.** A card move that takes 400 ms feels broken next to a local one. The board
  moves the card optimistically and rolls back on a failed result.
- **`Board.tsx` is a hotspot** (MAP.md#hotspots). `hostFor` lands as a hook in `lib/use-project-host.ts`, and each
  feature's switch from `localPath` to `host` is its own small change, so the file shrinks rather than grows.
- **Moving route code into `host-api`** touches many routes. It goes one feature at a time, behaviour-preserving,
  with the route's existing tests (`app/api/*.test.ts`) as the net.
- **Worker load.** Measuring quality walks the tree; on a busy box it runs after a turn ends and on a timer, never
  on the start-a-card path.
