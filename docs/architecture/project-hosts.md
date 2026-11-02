# Project hosts: one code path for local and Worker projects

Status: **design** (2026-11-01, merged with "one engine, two transports" 2026-11-02). Phase H1 is in progress; H2 (the
`host` command) is built ([below](#the-host-command-h2-as-built)), and so is H3, `hostFor` and one open card
([below](#hostfor-and-one-open-card-h3-as-built)), and H3b, composer parity ([below](#composer-parity-h3b-as-built)). It follows on from [weft-worker.md](weft-worker.md#worker-projects-on-the-desktop-board),
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
| Model, CLI, effort on an open card | `switch-backend`, `rerun-model` | the model picker and the first-message banner's rerun, as `card.switchBackend` / `card.rerunModel` (H3) |
| Agent | PATCH `agent` | none |
| Rename, tags, star, archive, move, delete | PATCH, `CardActions` | all but delete, as `card.update` (H3); no delete verb yet |
| ↑ edit, Restart, Fresh | `messages`, `fresh` | as host verbs (H3) |
| "!" shell | `shell` | none |
| Wait, Me first, Others first | `permission` | as host verbs, on the tile and in the thread (H3) |
| Stop a subagent task | `tasks/[taskId]/stop` | `card.stopTask` (H3) |
| Attachments in a reply | `/api/attachments` | images and PDFs travel as blobs on `reply`, `run` and `new_card` (`lib/attachment-transfer.ts`, 2026-11-02) |
| Send later | `desktop: true` | `card.schedule` / `card.unschedule`, the worker's daemon holding the timer (H3b) |
| "/" skills list | `/api/skills?cwd=` | `skills.list`, the worker's own list for the card's checkout (H3b) |
| Plan limits meter | this Mac's limits log | the card's own reading, from the worker's CLI (H3b) |
| Review panel, skills chip | `desktop: true` | none |
| Show rail, editor | Board's open card | the show rail, in Board's own open card (H3); the editor waits for file verbs (H4) |
| Backlog | Backlog column | none |
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
- **Not yet:** the inbox as an attachment receiver, the web composer as a sender. The board's UI for it is H3 (below).

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
- **Not yet.** Delete, Share… and the agent on a worker card; the editor and file links (H4); the header badges, terminal
  and drawers on a worker project (H4); the pane as the native `BrowserPane` (the worker's page still frames through
  `WebPane`); a `card.create` verb, so New thread still sends `run`.

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
  strip. **No upload on the web:** the Mac's inbox can't receive a file yet, so a pasted file's node says it can't be
  attached here (`NO_UPLOAD`).
- **Limits.** `StatusStrip cardLimits` (set off the desktop transport) reads the card's own `stats.fiveHour`/`sevenDay`,
  which the worker's CLI reported, instead of this Mac's limits log. Follow-up: the model pickers' "at its cap" marks
  (`useLimitedModels`) are still this Mac's on a worker card, and a worker could publish its whole limits log.

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
  that card and command. The worker opens it, runs, and redacts as the Mac does. `fill_field` stays desktop-only:
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

## Approvals and secrets

A view owns one thing: **approval**. Today Touch ID is `promptTouchID` in Electron main, which approves but signs
nothing, and only the phone signs (Ed25519 after Face ID, mobile-security.md). The browser's paired key sits in
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
- **One device registry:** worker enrolment tokens, `desktop` heartbeat rows and the phone and browser QR pairing become
  one pairing flow; enrolling a worker is pairing a host.

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
   (`new_card` waits for a `card.create` verb). **Attachments travel:** built ahead of
   H2 for the worker's kinds (`lib/attachment-transfer.ts`: `encodeAttachments` for a sender, `attachmentsOf` +
   `receiveAttachments` for a host, [weft-worker.md](weft-worker.md#worker-projects-on-the-desktop-board)); `host`
   calls the same two. Still open: sealing the blobs, `cloud-inbox.ts` as a receiver, the web composer as a sender.
3. **H3 `hostFor` and one open card** (built 2026-11-02, [as built](#hostfor-and-one-open-card-h3-as-built)). `ProjectHost`,
   `LocalHost`, `CloudHost`; worker tiles lose `readOnly`; the open card merges, so worker cards get the show rail, the
   pickers, the menus and ↑ edit. **H3b composer parity** (built 2026-11-02, [as built](#composer-parity-h3b-as-built)): the "/"
   list, Send later and the limits meter from the card's host, and ↑ edit, Fresh, Send later and "/" on weft.zip.
4. **H4 project reads.** Snapshot rows (`worker_put_project`) for quality, pile, streak and Backlog; the editor through
   file verbs with results.
5. **H5 one host program.** The inbox, heartbeat and publish merged across the Mac and the daemon; one card schema; the
   `(host, repo)` address. **H5a one publish path** is built ([Devices and records](#devices-and-records)); the inbox,
   the heartbeat and the address are still two.
6. **H6 the WebRTC line for everything live.** In order: video moves from 16 KB chunks on a reliable, ordered
   DataChannel (`lib/use-rtc-screen.ts`) to an RTP track that drops late frames, so it can't delay a click (**H6a, built
   2026-11-02:** an H.264 track negotiated in the sealed offer, the channel kept as the fallback, the rate moved on receiver
   reports by restarting idb's encoder, a PLI answered with a restart for a key frame;
   [weft-worker.md](weft-worker.md#the-fast-path)); the line
   opens while a board shows the worker's project, not only during a watch; `host` (verbs and results) and `events`
   (thread and project changes, streaming text) channels replace the 2.5 s poll; Supabase leaves the hot path (the
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
   asks stay on the phone or the Mac. Waiting on the domain, DNS, the Supabase redirect URL and the migration. Still
   open: the desktop board signing with a passkey instead of `promptTouchID`, so every view has one verify path.
8. **H8 secrets on a Worker.** The per-use seal first, then the vault in the host behind H7.
9. **H9 `@weft/client`** for the phone: the transports, verbs and view models as one package. **First pass built
   2026-11-02:** `packages/weft-client`, a pnpm workspace package of plain TypeScript (no DOM, React, Next or Node; its
   own tsconfig and an ESLint rule check that), holding the stable pure pieces with re-exports at their old `lib/` paths:
   the thread-item types, the host verb names (`HOST_VERBS`, which `HOST_API` is keyed by) and arg shapes, the `host`
   command's builder and readers, the BOARD STATUS parser, `paneFor`, `showMinis` and the signed-approval message.
   Still in `lib/`: the cloud command builders (`lib/cloud-commands.ts`, under H7's change), the transports (H3b/H6),
   board grouping, thread paging and the pending ask.
10. **H10 one device registry** and one pairing flow.
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
