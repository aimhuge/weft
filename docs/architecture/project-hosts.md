# Project hosts: one code path for local and Worker projects

Status: **built, with a short list still open** (design 2026-11-01, merged with "one engine, two transports" 2026-11-02;
truth pass 2026-11-03). Every phase but the dropped process split is built: H1 (thin card routes), H2 (the `host` command),
H3/H3b/H3c (`hostFor`, one open card, composer and web board parity), H4 (project reads, the editor, live file reload),
H5 (one host program, with leases), H6 (the session line, streaming deltas, TURN on both boards, the LAN path, offers
sealed by weft.zip itself), H7 (passkey approvals, the desktop's signer), H8 (the per-use seal, T2, values kept on a
worker), H9 (`@weft/client`, two passes), H10 (one device registry), signed widening, the T-items (T2, T5, T6) and WP3.
The 2026-11-03 additions are in [What landed on 2026-11-03](#what-landed-on-2026-11-03); what's left is in
[Still open](#still-open). Every migration this doc names is applied on production. It follows on from
[weft-worker.md](weft-worker.md#worker-projects-on-the-desktop-board), where a Worker project first showed on the desktop
board with most of what a local project gets dropped out.

## The problem

A project on a Weft Worker is a path, `worker://<worker id>/<folder>`. `localPath` (`lib/worker-project.ts`) turns it
into `null`, and `components/Board.tsx` feeds that to everything that touches a folder, so on a Worker project the
header badges, the terminal, the drawers and the copilot all drop out, and its cards draw `readOnly`. Each of those
features reads the Mac directly: a route under `app/api/*` calls `lib/*` on a path on this disk, or Electron main.
There are two code paths, and every new feature lands on the local one only.

The goal: **full parity**, and ideally **the local project is a worker too**, so the board has one way to reach any
project.

## What a Worker card gets

First read in the source on 2026-11-02 as a list of gaps; re-read 2026-11-03, when nearly all of them had closed. Each
row was a missing command kind and a missing handler on the board, not a missing engine: the daemon runs the same
`lib/runner.ts`. What's still open is in [Still open](#still-open).

| Feature | Local | On a Worker card |
| --- | --- | --- |
| Permission mode | PATCH `permissionMode` | default/acceptEdits/auto through the `mode` command; YOLO where the desktop app signs it (`transport.signsSkip`, through `actOnLine`'s [signed widening](#signed-widening-as-built), PR #74); no `plan` mid-card |
| Model, CLI, effort on an open card | `switch-backend`, `rerun-model` | the model picker and the first-message banner's rerun, as `card.switchBackend` / `card.rerunModel` (H3); on the desktop the rerun takes your synced `backupModel`, on weft.zip the CLI's default (PR #75) |
| Agent | PATCH `agent` | `card.update` with a signed approval ([Signed widening](#signed-widening-as-built)); your custom agents and worker-project defaults travel as the signed `agents` account setting, so a new thread there gets its project's default and Settings → Agents lists worker projects (PR #79); a board tool's `create_card` to another host runs as that default ([Agents across hosts](#agents-across-hosts)) |
| Rename, tags, star, archive, move, delete | PATCH, DELETE, `CardActions` | as `card.update` (H3), and `card.delete` (2026-11-02) |
| Share… | `card-share`, `ShareCardDialog` | the same dialog over the rows the worker published (`lib/card-share-worker.ts`, 2026-11-02; sharing.md) |
| ↑ edit, Restart, Fresh | `messages`, `fresh` | as host verbs (H3) |
| "!" shell | `shell` | `card.shell` with a signed approval ([Signed widening](#signed-widening-as-built)) |
| Allow on a request | `permission` | an answer the worker takes from the network today; a Touch ID-signed Allow is built and landing (PR #80, [below](#what-landed-on-2026-11-03)) |
| Wait, Me first, Others first | `permission` | as host verbs, on the tile and in the thread (H3) |
| Stop a subagent task | `tasks/[taskId]/stop` | `card.stopTask` (H3) |
| Attachments in a reply | `/api/attachments` | images and PDFs travel as blobs on `reply`, `run` and `new_card` (`lib/attachment-transfer.ts`), sealed when the card's row is (PR #94); a brand-new worker thread's files still go plain |
| Send later | `desktop: true` | `card.schedule` / `card.unschedule`, the worker's daemon holding the timer (H3b) |
| "/" skills list | `/api/skills?cwd=` | `skills.list`, the worker's own list for the card's checkout (H3b) |
| Plan limits meter, "at its cap" | this Mac's limits log | the card's own reading and the worker's burndown (H3b, WP3); the model pickers' caps from the `m` caps the worker publishes in `cloud_workers.limits` (`/api/limits/plans?worker=`, `useLimitedModels(cwd)`, PR #75) |
| Settings | this Mac's settings.json | account settings synced from the Mac, host settings per worker in Settings → Threads (WP3); Goose's provider as a `settings.put` signed by the pairing Mac (PR #81), its key per turn from the Mac after Touch ID (PR #93) |
| Streaks and XP | this Mac's activity log | the worker's cards count too (WP3); a Run on Worker card's local record is marked `handedOff` and left out (`lib/activity.ts` `withoutHandedOff`, PR #75) |
| Show rail, pane, editor | Board's open card | the show rail (H3); the card's uploaded pages and sites in the native `BrowserPane` (PR #78, `WebPane` kept for the live screen); the editor and file links through `files.*` (H4), reloading when the file changes on the worker (`files.watch`, PR #86) |
| Review tour | `desktop: true` | the tour and the no-tour panel (card data), each step's page in the card's pane column (`lib/pane-open.ts`); no dev server step |
| Skills menu, Run /skill | `/api/skills`, `api.send` | the header menu (its list from `skills.list`) and the right-click Run /<skill>, as `card.message` |
| Skill set chip, ⏰ crons | `desktop: true` | the chip as `card.update { skill }` over the worker's `skills.list`; ⏰ as `cron.create` through `hostOf(card).act`, the worker narrowing the mode (PR #79) |
| ⌘F over the whole thread | `/thread/search` | `GET /api/worker-board?card=&q=` over the card's `cloud_thread_items`, cut tool results paged in from `cloud_tool_outputs` first (`workerThreadSearch`, PR #75), sealed rows opened with the workspace key where it's granted (PR #92); a sealed tool output matches nothing |
| Pictures in the thread | `/api/attachments/<name>` | blob refs signed through `GET /api/worker-board?blobs=` and drawn by the transport's `useView` (`lib/worker-blob-view.ts`), opened in the browser when sealed (PR #87) |
| New thread, Backlog | POST `/api/cards` | `card.create` (tags, CLI, model, effort, mode, Isolated; `start: false` is the worker's Backlog), Backlog reorder as `card.update { before }` (board parity) |
| Isolated | the warm worktree pool | the daemon's own pool, landing on Done as on the Mac (board parity) |
| Notifications, dock badge | `board-live` announce, chimes | the same `noticeCard` per read (`useWorkerNotices`); the badge counts every card on the board (board parity) |
| Rail drawers, mini apps | the project's folder | 🔐 and the provider drawers through this Mac's checkout of the repo; Services with Log, Restart and Stop; issues as runs; Save as app on its pages (T5) |
| Streaming | SSE | over the session line, reply text typing out from `delta` events (H6, PR #86); a 2.5 s poll on the relay |
| Secrets | the 🔐 vault in main | `mcp__secrets__run`, the other secrets tools and a dev server's env through the Mac's Touch ID (H8, T2), optionally kept on the worker (PR #88); `fill_field` stays the Mac's, by design ([secrets.md](secrets.md#fill_field-on-a-weft-worker-not-planned)) |
| weft.zip and the phone | | any verb as a `host` command (H2); weft.zip opens its own session line to your worker cards, through TURN (PRs #89, #91); the phone still sends rows, not lines |

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
  env is "a process boundary between the daemon and its cards". That split was considered and dropped on 2026-11-03
  ([Phases](#phases), item 12); the threats it would close are written down where they bite.

So the target is: **one handler layer, two transports**. The local host is a worker in every way the board can see,
and it stays one process.

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
  stay with Weft's own window, behind `elevated()`, unless the command carries a signed approval for exactly that change
  ([Signed widening](#signed-widening-as-built)). The Mac also keeps its phone rule: a host `card.permission.answer` is
  checked as an `answer` (a signature in `args.auth`), and any other verb `needsElevation` names is refused while a phone
  is paired and the web may not approve, since the phone can't sign one yet. `result` is capped at 4 KB by a check
  constraint. Found by a security review before H2 shipped.
- **Desktop-only.** None of the card verbs needs the desktop; the copilot does, so `card.message` loads `lib/copilot`
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
  Mac and false on a worker for `files`, `shots`, `pane`, `folder`, `agent`, `shell`, `skills`,
  `login`, `vault` and `dev` (`schedule`, `share` and `delete` are true on both; Delete and Share… below). `menu` trims a card's right-click menu (`lib/card-menu-remote.ts`). `hostFor` and
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
  host has the feature, so `runSkill` (the Skills menu, listed by the transport's `listSkills`), `share` and `delete` show on
  a worker card and `skills` (the chip), `cron` (⏰) and `settings` don't. The review tour shows on a worker card, its pages put in
  the card's pane column through `PaneOpenContext` (`lib/pane-open.ts`, from `useProjectHost`'s `page.open`), with no dev
  server step (`hostFor(cwd).can("dev")`). ⌘F reads the whole thread (`searchThread`, `lib/worker-thread-reads.ts`), the
  thread's pictures are signed blob refs (`useWorkerView`, `lib/worker-blob-view.ts`; page refs stay refs for the rail and
  the pane), the first-message banner reruns on the card's CLI's default (`hostRerunModel`), and "!" shows the amber box
  with "A shell runs only on this Mac's cards." instead of sending (`shellRefusal`, `ReplyBox` `noShell`).
- **Since then** (all of what this line once listed as not yet). The agent through [signed widening](#signed-widening-as-built);
  the editor, file links, header badges and drawers (H4, T5); the terminal over the line; the native `BrowserPane`
  (PR #78); crons and the skill set chip (PR #79); the rerun on your synced backup model (PR #75); ⌘F over cut tool
  results (PR #75) and sealed rows (PR #92). A sealed tool output still matches nothing.

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

### Delete and Share… on a worker card (as built, 2026-11-02)

```
menu / header Delete… ─ useDeleteDialog (same confirm) ─ removeOnHost(card) ─┬─ local: removeNow ─ DELETE /api/cards/<id> ─ runVerb("card.delete")
                                                                            └─ cloud: removeNow(id, act("card.delete")) ─ host command
worker daemon: card.delete ─ deleteCard ─ card_deleted ─ publisher putCard(deleted) ─ next changed read lists it in `removed`
Share… ─ /api/cards/<id>/share ─ not in this Mac's store ─ lib/card-share-worker.ts finds the worker's row (no verb)
```

- **`card.delete`** (`lib/host-api/card-delete.ts`, in `HOST_VERBS`): ends the CLI, keeps a picked-up session dismissed,
  drops the card and an isolated card's worktree, refuses the copilot. `app/api/cards/[id]` DELETE is now its wrapper
  (behind `guard()`, so `elevated: false`). `remoteRefusal` lets it through: deleting your own card narrows what a card
  can touch, and only a command the worker's owner made reaches the worker. Both hosts already refuse the copilot and a
  card they don't run before the verb.
- **Drawn at once.** `removeOnHost` (`lib/card-handlers-host.ts`) is the one delete every caller uses (the menu's
  `removeCard`, the first-message banner, the worker thread's `onDelete`). A worker's delete goes through `sendNow`:
  the card stays hidden after the worker says yes, since the last read still has it until the publisher's deleted row
  lands, and a reload after `STOP_SETTLE_MS` (a whole read, which leaves deleted rows out) takes over; a queued one stays
  hidden until it runs, a refusal brings it back.
- **Share…** needs no verb: the cloud rows suffice (sharing.md#a-worker-card).
- **UI.** `remoteMenu` keeps `share` and `delete`; the thread header's `CardButtons` draws `CardActions` for a worker
  card too (`skills={false}`), so Share… and the not-yet-finished card's delete sit where a local card's do, with no new
  row or chip.

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
  which the worker's CLI reported, instead of this Mac's limits log. The model pickers' "at its cap" marks follow the
  card's host since PR #75: the worker publishes its `m` caps in `cloud_workers.limits`, read through
  `/api/limits/plans?worker=` by `useLimitedModels(cwd)` (keyed on `hostFor(cwd).workerId`).

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
  half of the host chip's menu and the review panel are still desktop-only. The host chip itself is shared
  (`components/web-board/HostChip.tsx` in `WebPane`): on weft.zip it shows once a simulator streams or a mobile app could start one,
  as "Worker" where the web doesn't know the worker's name.

### Settings on a worker (WP3)

```
this Mac  Settings → Save ─ PATCH /api/settings ─ pushAccountSettings ──▶ account_settings (your row, RLS own)
          server start (+20 s) ─────────────────── startAccountSettingsPush ─┘
worker    createSettingsSync: start, every 60 s, nudge per command (≥15 s) ─ worker_account_settings(key) ─▶ applyAccountSettings ─▶ its settings.json
this Mac  Settings → Threads → On a worker ─ POST /api/worker-settings (elevated) ─ host row, no card ─▶ settings.get / settings.put
worker    startWorkerLimits: startLimitPoll, then worker_set_limits(packLimits(readSamples())) ─▶ cloud_workers.limits
board     StatusStrip on a worker card ─ /api/limits?worker= ─ workerLimitSamples ─▶ LimitBurndown + the strip's reading
          /api/game ─ workerActivity(readWorkerBoard) ─▶ gameState({ worker }) ─ mergeWorkerEvents
```

- **Which settings a card's run reads.** The engine reads `threadPrompt` (every thread's system prompt), `automations`
  (Done and the other column moves, `lib/automations.ts`), `doneModel`/`doneEffort` (`doneOverrides`), `pushOnDone`
  (`/weft:done`'s push.sh reads settings.json), `subagentModel`, `backupModel` (the failed-first-message rerun),
  `defaultBackend` (a run that names no CLI, and the limit poll), `maxThreads` (`lib/thread-slots.ts`),
  `keepAliveMinutes` (warm CLIs), `worktreePool`, `defaultPermissionMode`, `allowedFolders` (the folder guard) and the
  Goose provider, model and endpoint. The rest (`copilotModel`, `reviewAllModel`, issue landings, sync and worker folders,
  the project list) are this Mac's board.
- **Two lists, never overlapping** (`packages/weft-client/src/host-settings.ts`). `ACCOUNT_SETTINGS` are how a card
  behaves wherever it runs: automations, push on done, the done model and effort, the subagent model, the thread
  instructions, the backup model. They sync from your Mac to your account and every worker of yours mirrors them.
  `HOST_SETTINGS` are what one machine carries: threads at once, keep-alive, the worktree pool, the default CLI. Settings →
  Threads edits them per worker. **Never on either:** allowed folders, the default permission mode, the Goose provider and
  endpoint (where a card's traffic and key go: they travel only as a `settings.put` the pairing Mac signs after Touch ID,
  [weft-worker.md](weft-worker.md#goose-on-a-worker), PR #81), issue, sync and worker folders. A folder grant still rides inside an answer.
- **Sync model: pushed snapshot, mirrored.** The Mac upserts every account field explicitly (a default too, so a reset
  resets the worker) to `public.account_settings` (`lib/account-settings.ts`), on each Save and once 20 s after start; it
  skips a push whose snapshot hasn't changed. A worker reads it with its key (`worker_account_settings`, which returns only
  the allowlisted keys) and writes it into its own settings.json through the same setters (`applyAccountSettings`, which
  checks each field again, skips a bad one alone and writes only what changed), so `push.sh` and every reader see it with
  no overlay. Chosen over a read at each turn's start because that would put a round trip on the start-a-card path: the
  sync reads at start, every minute and on each command (`nudge`, at most every 15 s, never awaited), so a turn starts on
  what was mirrored last, at most a minute old.
- **Signed by your Mac.** Any session of yours can write the row (weft.zip, the phone, a stolen one), and the thread
  instructions and automations shape every card on a worker, so the Mac signs each push and a worker applies only what
  the Mac it was paired with signed. `pushAccountSettings` asks main (`POST /account-settings/sign`,
  `electron/settings-sign.cjs`) to sign `weft-account-settings-v1 / user / version / sha256(canonical settings)` with this
  Mac's device key (`electron/desktop-signer.cjs`, no Touch ID: every Save pushes, and the message is domain-separated and
  built by main from checked fields, so it can't stand for an approval or a `secret_use`). The row keeps `version` (only
  grows) and `signature`; nothing it can't sign is pushed. The worker (`lib/account-settings-sig.ts` `settingsRefusal`,
  wired in `lib/worker-host-services.ts`) checks the signature against `mac-keys.json`, the Mac key the pairing code
  carried (H8's `lib/worker-mac-keys.ts`), and refuses a version at or below the last it applied (kept in
  `account-settings-version` in its home, sealed from threads), logging the refusal once and keeping what it had. A
  token-enrolled worker trusts no Mac, so it takes no synced settings until it's paired; a second Mac of yours that isn't
  the paired one pushes rows the worker refuses until the paired Mac saves again.
- **Patterns can't hang it.** A "prompt matches" rule's pattern is capped at 300 characters and tested in a `vm` context
  with a 50 ms timeout (`lib/safe-pattern.ts`), so a catastrophic one (`(a+)+$`) from a synced row never matches instead of
  holding the daemon.
- **Host verbs with no card.** `settings.get` and `settings.put` are `HOST_API` verbs (`lib/host-api/settings.ts`,
  `elevated: true`) that name no card: `isHostLevelVerb` in `@weft/client`, a row built by `hostLevelRow` (`folder` and
  `args.id` empty), read by `readHostCommand` with `id: ""` whatever the row says, run by the `host` kind's `onHost` branch
  (`lib/host/dispatch.ts`) only when the host's `CardRules` has `hostVerb` (a worker; a Mac's settings stay in its own
  window), reported with `card_id` null (`doneOutcome`). `remoteRefusal` refuses a `settings.put` naming any field outside
  `HOST_SETTINGS`, and `applyHostSettings` refuses it again and checks every field before saving any. The board's side is
  `lib/worker-host-verbs.ts` (only to a worker you enrolled) behind `POST /api/worker-settings` (elevated), followed to its
  result by `lib/worker-host-settings.ts`; `ProjectHost.act` takes only card verbs (`CardVerb`).
- **Settings UI.** `components/WorkerHostSettings.tsx` at the foot of Settings → Threads: a worker picker (your headless
  workers), its four settings loaded from it, Save on worker sends only what changed. Drawn only when you have a worker.
  Phone, Away, Dictation, Shortcuts, Sound and Laptop stay this Mac's.
- **Limits.** The daemon starts `startLimitPoll` (`lib/worker-host-services.ts` → `lib/worker-limits.ts`), so the worker's
  history fills between turns and its parked cards resume on its own resets, and publishes the history (newest 750
  samples, packed by `lib/limits-wire.ts` to fit the row's 64 KB check) to `cloud_workers.limits` a minute in and every 5 minutes when it grew. Per worker,
  not in H4's per-folder snapshot, because a plan is per CLI sign-in, which is per box. A worker card's strip charts it
  (`/api/limits?worker=`, `lib/use-limit-samples.ts`), and shows its newest reading until the card reports its own.
- **The game.** `/api/game` adds your workers' cards (`lib/worker-activity.ts`): each backfilled like a card the log never
  saw (made, its turns on its last active day, Done), read at most every 5 minutes and never holding the game up more than
  3 s. Not written to this Mac's activity log. `mergeWorkerEvents` drops any event whose id or card the log already has.
- **Migration.** `supabase/migrations/20261102180000_host_settings.sql`: `account_settings` (RLS own row, 40 KB,
  `version` and `signature`), `worker_account_settings`, `cloud_workers.limits`/`limits_at` and `worker_set_limits`. Applied.
- **Since then** (2026-11-03). A Run on Worker card's local record is marked `handedOff { workerId, commandId }` and left
  out of streaks, XP and made totals (`lib/activity.ts` `withoutHandedOff`, PR #75); agents and worker-project defaults
  sync as the signed `agents` setting (PR #79, migration `20261103120000_account_setting_agents.sql`); Goose's provider
  as a signed `settings.put` (PR #81); the "at its cap" marks from the worker's caps (PR #75). Goose's provider key per
  turn from the Mac (PR #93).

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
- **Leases** (2026-11-03, PR #76, [weft-worker.md](weft-worker.md#leases)). `cloud_commands.lease_until`
  (`supabase/migrations/20261103070200_command_leases.sql`), renewed from the host's beat (`lib/host/lease.ts`). A host
  requeues its own expired claims only for the idempotent verbs (`skills.list`, `files.list`, `files.read`,
  `settings.get`, `dev.log`); any other expired claim fails rather than run twice. Leased claims expire after a day.

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
  replaces the trusted Mac (never adds one), and an enrolled box enrols again only on an approval the Mac it trusts
  now signed ([Re-pairing a worker](#re-pairing-a-worker-as-built-2026-11-02)). Threads can't run any of this: `lib/worker-cli-guard.ts` refuses `weft-worker`, the daemon's script, the
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
- Main answers each signed vault ask once (by its nonce, until it expires), so a signed ask copied into a new row by
anyone holding the worker's `wwk_` key is refused, and refuses an ask from a worker revoked since it asked. A
`set_value`'s device call is blanked when it's answered (`private.blank_vault_set`).

**What it guarantees.** A value is never in the model, the transcript, Supabase in the clear or the worker's disk: it
  lives in main, in the sealed row until it finishes, and in the worker daemon's memory. A row replayed, late, for
  another card or another command, or naming other secrets, opens nothing or is refused. Values leave the Mac only after
  Touch ID, per run, in a window naming the command, the names, the card and the worker.
- **Its limits.** Secrets need a paired worker; token-enrolled ones are refused on both sides. A worker trusts only the Mac
  that paired it. Since PR #85 a worker's asks go to that Mac (`cloud_workers.paired_mac`; secret and vault asks only to
  it, tunnels and relays fall back to the newest). A worker paired before this change has no Mac key, so it must be paired again.
  Variables that load code (`NODE_OPTIONS`, `LD_*`, `DYLD_*`, `BASH_ENV`, `ENV`, `PYTHONSTARTUP`, `PERL5OPT`, `RUBYOPT`)
  are refused on the command line and as vault names, on both sides. The command runs with the
  worker's privileges, so a script that writes a value to a file leaves it there, as on the Mac.
- **Since then.** A dev server's env, missing names made into blanks, and the rest of the secrets tools are T2
  ([below](#the-vault-on-a-worker-t2-as-built)); `fill_field` stays the Mac's.
- **Kept on a worker** (2026-11-03, PR #88, [secrets.md](secrets.md#kept-on-a-worker)): the vault on the host, opt-in per
  worker, project and environment (development and preview only); each use still needs the Mac's Touch ID, only the
  value's trip is saved. A kept value is readable by any code a card on that worker runs, since cards run as the daemon's
  OS user; the user ticks that warning to turn it on.

### The vault on a worker (T2, as built)

Built 2026-11-02 with `supabase/migrations/20261102230000_worker_vault_connectors.sql` (applied). Unit-tested on both
sides. H8 gave a worker card `mcp__secrets__run`; T2 gives it the rest of the
vault and a dev server's env. Lending the Mac's Google and GitHub sign-ins was built too and taken out before it shipped
([below](#connectors-on-a-worker-not-planned)).

```
worker card: list · add_blank · ask_add · set_value · push_to_vercel · a dev server's devSecrets
  lib/worker-vault.ts askVault ─ sign(vaultAskMessage) with sign-key.json ─ worker_mac_ask(tool) ──▶ device_calls
                                 tools vault_list, vault_blank, vault_set, vault_push, dev_env
Mac server:  drainDeviceCalls ─ claim ─ POST /secrets/worker-vault {call} ──▶ Electron main
main:        electron/worker-vault.cjs ─ readWorkerAsk (its own session; a revoked worker gets nothing) ─ vaultAskOf(tool)
             ─ pinned sign key + signature ─ a card its owner started (createCardOrigins) ─ the nonce answered once
             ─ vaultFor(remote, the card's folder from cloud_cards) ─ this Mac's own clone of that repo
             list: names only │ blank: addBlanks │ set: openBox, held to the row, fillBlank (Touch ID) │ push: Vercel (Touch ID)
             dev:  electron/worker-dev-env.cjs ─ Touch ID at every start and restart ─ seal(devEnvPurpose) to the pinned
                   box key ─ secret_use {use: "dev"}
worker:      deliverSecretUse (the open ask, dev purpose) ─ electron/secret-env.cjs gets the values on stdin ─ redacted log
```

**1. list, add_blank, ask_add.** Names only, so no Touch ID, but still a signed ask: the worker signs
`vaultAskMessage(card, box key, tool, every field main acts on)` with its pairing key (`lib/worker-vault-wire.ts`, held to
`electron/worker-vault-wire.cjs` by a test), and main answers only a worker whose sign key it pinned at pairing (not
one taken off the row, as H8 allows before the first Allow). A stolen `wwk_` key alone can't even list names, and can't
replay a signed ask into a new row: main answers each nonce once, until the ask expires, and keeps the nonces sealed in
`~/.weft/vault/worker-ask-nonces.json` so a restart doesn't reopen them (a file that won't open fails closed: no ask that
could have been signed before main read it is answered). Both are in `electron/worker-vault-guards.cjs`. The vault is the one the
checkout's git remote names, refused unless it's the repo this Mac knows the card's project as (`vaultFor`, as H8), and
main acts through its own clone of that repo (`createProjectFolders`, `electron/worker-projects.cjs`), so `vault.names`,
`addBlanks` and the rest run unchanged. The card's folder on `cloud_cards` is the worker's word, so main answers only a
card its owner started: the first time a card reaches the vault, main needs a `new_card`, `run` or `card.create`
command the signed-in owner sent to that worker for that card, naming the same folder (`createCardOrigins`, read with
the owner's own session), then pins the card's folder in `~/.weft/vault/worker-card-folders.json` (written whole, one
check at a time) and refuses the card if it later names another. A card the worker made itself, or one whose start
command expired (finished commands go after a day) before it first reached the vault, is refused with a message to
start a new card. The folder isn't in the signed message: the worker's secrets tools know the checkout's
path, not the name the publisher put on the row, and the signed remote already has to match. A blank's source says
"a thread on the worker m1mini". `ask_add` on a worker makes the blank and tells the thread the user fills it in 🔐 on
the Mac: the in-thread input (`SecretAskInput`) is left off a worker card's item (`threadAskOf`, `lib/runner-turn.ts`),
because its folder means nothing to the Mac's vault. A run or push that finds a name missing makes it a blank the same way.

**2. set_value, push_to_vercel, fill_field.** `set_value`'s value is sealed by the worker to the Mac it was paired with
(`lib/mac-box.ts`: libsodium's sealed box to the X25519 twin of the Mac's Ed25519 device key, the one key the pairing
code carried; `openBox` in `electron/desktop-signer.cjs` opens it, so the private key never leaves main). Using one key
for both signatures and these boxes is the construction libsodium supports; the box carries no purpose of its own, so
the plaintext repeats the card, the ask's nonce, the name and the environment, `openBox` has no caller but this one,
and main refuses a value sealed for anything else. It's stored by `fillBlank` (`electron/vault-routes.cjs`), so the
Touch ID prompt is the Mac's own, naming the worker, the vault and the environment first, then the PRODUCTION warning,
then the value's sha256 fingerprint and, last and quoted, the card's title, which is the worker's word ("let a thread on
the worker m1mini add SIGNING (o/r, production). This is the PRODUCTION value. Value sha256 1a2b3c4d…. Card: "Fix
login""), with no grant shortcut and an overwrite only with `replace`. The environment is in the
signed ask and in the sealed plaintext, so it can't be swapped on the way. `push_to_vercel` runs on the Mac
(`vercel-env.cjs push`, "let a thread on the worker m1mini push KEY (o/r, production) to Vercel project p. This is the
PRODUCTION value. Card: "…"") against the Vercel project this Mac's clone links. **`fill_field` stays refused** on a
worker, with a message that says to use `mcp__secrets__run` or ask the user: the value is typed by main into the Mac's
browser pane, and a worker card's pages aren't that pane. The worker's own headless browser (T4, PR #38) would need the
value in the worker's process and a browser the worker drives, so the seal would go to a box that then types into a page
any code on it can read; until a page there can be held to a site and a field the way the Mac's pane is
(`electron/pane-secrets.cjs` masks the field and checks the site), it's not worth the risk. `request_access` is refused
too: grants are the Mac's, and a dev server asks at each start. A `set_value`'s device call is blanked once it's answered
(`private.blank_vault_set`).

**3. A dev server's env.** `devSecrets` on a worker (`lib/worker-dev-env.ts`) opens an ask in the H8 registry marked
`dev` (its names are the Mac's to name), sends a signed `dev_env` call with the command, cwd and package.json script,
and waits. Main (`electron/worker-dev-env.cjs`) reads the vault's whole development set, drops any variable that loads
code (`NODE_OPTIONS`, `DYLD_*` …), and asks in the worker window ("Start a dev server on the worker m1mini with …?") at
every start and every restart. There's no standing grant on a worker: one keyed to the card's latest instruction was
built and dropped after a red team, because this Mac can't see every way a turn starts (the H6 line carries host verbs
with no `cloud_commands` row, the owner can delete finished rows, and a command's card is only set when it's reported),
so a stolen weft.zip session could still reach a grant. The window says the values are for this one start, that
whatever the server runs (the project's code included) gets them, and that any process on the worker can read a
running server's env. A revoked worker gets nothing (`readWorkerAsk`). The values are sealed to the pinned box key for `devEnvPurpose(card, nonce, command)` and signed by the Mac, as a `secret_use` with
`use: "dev"`, so a run's answer can't open as a dev server's or the reverse. On the worker they go to the launcher on its
stdin (`electron/secret-env.cjs` takes `values` in place of a grant to claim): never the daemon's env, an argument or a
file. The server's output is redacted line by line, `run.log` names the secrets but never a value, the published
dev-server list carries the command only, and the card's stored text is redacted from the values kept in memory until
its turn ends (`remember`, as a run).

**Commands carrying sealed secrets are the maker's.** The migration narrows `cloud_commands: read as member` so a
`secret_use`, `login` or `github_login` row is read only by the member who made it; every other kind is still the
workspace's (the web board's "waiting for your Mac"). The worker reads its commands through its key-checked functions.

**What it guarantees.** No vault value is ever in Supabase in the clear, the model or a transcript. Every Mac-side answer
is decided from the device_calls row and the worker row main reads itself, a signature by the sign key pinned at pairing,
and the vault the card's own repo names; the caller passes only an id. Values reach a worker only after Touch ID (a run,
a set, a push, each dev server start), and only sealed to the box key this Mac pinned. A stolen
`wwk_` key alone gets nothing: it can't sign an ask, replay one, or open a seal. A stolen box (all its keys) gets what the
user approved for it, one Touch ID at a time.

**Its limits.** There's still no process boundary between the daemon and its cards (weft-worker.md): code a thread
writes and runs as the same user can read a running server's env, so a dev server's development values are as safe as
the worker's cards are trusted. The device_calls row of a
`set_value` keeps its sealed bytes while it waits, until it's answered or swept.

**Follow-ups.** `fill_field` on the worker's browser once T4 can hold a field to a site, the in-thread `ask_add` input for
a worker card, and the folder in the signed ask once the worker's secrets tools know the published name. Routing asks to
the pairing Mac is built (PR #85). Lending gog and gh is not planned
([below](#connectors-on-a-worker-not-planned)).

### Connectors on a worker: not planned

T2 built lending the Mac's gog (Google) and gh (GitHub) sign-ins to a paired worker: toggles on its row in Settings →
Devices, tokens minted on the Mac, sealed to the worker and signed by the Mac as a `connector` command, kept sealed at
rest on the worker, and run through shims on the cards' PATH that refused `auth`, aliases and extensions. A read-only
red team (2026-11-02) found that any card on the worker could take the token, and gh's never expires, so a single
prompt-injected card meant a permanent GitHub account takeover. It was taken out before it shipped, with its `connector`
kind and the PATH change. The ways in, every one as the worker's own OS user, which every card runs as:

- `NODE_OPTIONS=--require …` (or a `DYLD_*` / `LD_PRELOAD` library) into the node shim that opens the token.
- The CLI's children inheriting `GH_TOKEN`: git hooks and `core.hooksPath`, `GIT_CONFIG_*`, `GIT_SSH_COMMAND`, and
  `GH_BROWSER`, `PAGER` / `GH_PAGER` with `GH_FORCE_TTY`, `EDITOR`; a repo's own `.git/config` is the card's to write.
- Flags before the subcommand: `gh --hostname github.com auth token` got past a refusal that parsed the subcommand.
- Reading a running gh's env (`ps -E`, `/proc/<pid>/environ`).
- `connectors.json` holding the real binary's path and the expiry in plaintext beside the sealed token, and the box's
  own seal key beside it, all readable and writable by the same user (the path guards stop a tool, not code a card runs).
- A gh alias or extension planted in the shim's config folder, and gog's `--home`.
- Revocation that couldn't reach a revoked or offline box, which keeps a gh token that GitHub never expires.

A real fix would need a process boundary: the token held by a separate OS user (or a separate machine) that the cards
can't read or ptrace, with the CLI's calls proxied through an API that holds the token and checks each request, never
the token in a card's process tree. That split was dropped on 2026-11-03 ([Phases](#phases), item 12), so lending the
Mac's gog and gh sign-ins to a worker is **not planned**. A worker's cards use `github_login` (a fine-grained token
pasted for that worker, scoped to its repos) or the GitHub mint below (P1) for git.

### Re-pairing a worker (as built, 2026-11-02)

Pairing chooses the Mac a box takes secret answers, signed settings and signed widenings from, so moving an enrolled box
to another Mac is the most powerful thing its command line does. It used to need only `--re-pair` at a terminal
(`enrolRefusal`'s TTY check), and a thread fakes a terminal with any pty (`script`, `expect`, `unbuffer`, Python's
`pty.spawn`, or a program it writes). Now the Mac the box trusts signs the move:

```
old Mac (key K, in the box's mac-keys.json)            worker box
Settings → Devices → m1mini → Re-pair
  paste the new Mac's wph.… code (carries K')
  Touch ID: "let the worker m1mini stop trusting this
    Mac and trust the Mac a1b2 c3d4 e5f6 7890 instead"
  sign with K: weft-repair-v1 \n worker \n K' \n pairing
    \n org \n issuedAt \n nonce
  shows: weft-worker enrol wph.… --re-pair --approval wra.<issuedAt>.<nonce>.<sig>
                                         ─ by hand ─▶  repairRefusal: the sig checks against K, for this
                                                       worker id, K', the code's pairing and workspace,
                                                       under 30 min old → pairWorker (the new Mac's own
                                                       claim check and Touch ID) → trustPairingMac(K')
```

- **The box** (`lib/worker-repair.ts` `repairRefusal`, called by `scripts/weft-worker.ts` before anything else runs)
  refuses an enrolled box's enrol unless the code is a `wph.` code carrying a Mac key and the `--approval` line verifies
  against a key in `mac-keys.json` over this worker's id (`worker.json`), the new key, the code's pairing id and
  workspace, and a time within 30 minutes (two minutes' skew). A token can't re-enrol an enrolled box, and a box that
  trusts no Mac (enrolled by token, or after `forget-macs`) has no one to approve, so both are wiped first
  ([weft-worker.md](weft-worker.md#re-pairing-and-a-lost-mac)). The new Mac can't approve its own arrival, and the
  pairing id is single-use on the server, so a replayed approval can't do anything new; once the swap lands, the old
  key verifies nothing. The TTY check stays as a speed bump. A fresh box enrols as before.
- **The Mac** (`electron/worker-repair.cjs`, IPC `worker-repair:approve` on the board-only handler in
  `electron/host-pairing-ipc.cjs`, `weft.hostPairing.approveRepair`) takes only the worker's id and the code. It reads
  the worker from `device_registry` through its own session (a worker, owned by the signed-in user) and names it from
  there, never from the renderer. It parses the code itself and asks Touch ID with the new Mac's fingerprint first (the
  name only if it passes `SAFE_NAME`), then signs with its approval key (`electron/desktop-signer.cjs`), which never
  leaves main. This Mac's key is public, so anyone could put it in a pairing code of their own workspace: a code naming
  this Mac must be one this Mac opened and still has open (`createHostPairing().opened`). Add a worker shows this Mac's
  fingerprint, so a user moving a worker here can match it against the old Mac's prompt. Re-pair shows on paired
  workers in Settings → Devices (`components/WorkerRepair.tsx`). `lib/worker-repair.test.ts` proves main's message and
  fingerprint are the box's.
- **A damaged `worker.json`** doesn't drop the check: a box with a `mac-keys.json` counts as enrolled.
- **The code that checks is guarded too.** `weft-worker` runs from the worker's own clone (`~/.weft-worker/weft`) through
  jiti, so editing `lib/worker-repair.ts` there would turn the check off. `lib/worker-clone-guard.ts` keeps that clone
  readable but unchangeable from a thread: Edit, Write and NotebookEdit are refused (`lib/secret-guard-tool.ts`), and so
  is Bash that writes into it (`sed -i`, `perl -pi`, `cp`/`mv`/`tee`/`rm` and the like, `tar -C`, `unzip -d`, `curl -o`,
  `patch` run in it, a `>` redirect from any folder a `cd` reaches, `git` run in it or pointed at it).
  Only the updater changes it. The CLI guard (`lib/worker-cli-guard.ts`) also sees `weft-worker` behind the wrappers
  that give it a terminal or run it for you (`script`, `expect`, `unbuffer`, `timeout`, `stdbuf`, `caffeinate`, `xargs`,
  `python -c` with `pty.spawn`, and others), even named inside a string.
- **Why by hand, not a request the box posts.** A request the box posts can be posted by a thread too, putting
  unrequested Touch ID prompts on the Mac until one is approved by habit. Carried by hand, nothing reaches the Mac unless
  the user pastes it there. It needs no table and no migration either.
- **Its limit: the guards are speed bumps, the signature is the check.** Threads on a worker run as the same OS user as
  the daemon, and the guards read names on the command line. A thread can still copy the clone out (`cp -R`, reading is
  open), edit the copy's check away and run it with `node` under another name. It can also write and run a program that
  rewrites `mac-keys.json` or `worker.json` directly (weft-worker.md, "the same limits as the data dir"). The guards make
  the obvious routes fail loudly; none of them can stop the same user. Only a process boundary would (the daemon as its
  own OS user that owns `worker.json`, `mac-keys.json` and the clone, with cards run as another), and that split is
  dropped ([Phases](#phases), item 12): the threat stays documented here and in
  [secrets.md](secrets.md#kept-on-a-worker).

### Connectors on a worker: GitHub (P1, as built)

Built 2026-11-02, migration `20261102280000_worker_github_mint.sql` applied; the full account is in
[connectors.md](connectors.md#connectors-on-a-worker-github-p1-as-built). T2 (PR #56) built lending the Mac's gh and gog
sign-ins to a worker and took it out after a red team: any card could read a token that never expired. P1 is the design
note's layer 1, **off-box minting**: nothing long-lived reaches the box. Its own red team (PR #62) found the first cut
trusted weft.zip's rows, which any session of yours can write; it now trusts only signatures by a Mac's approval key.

- **Who holds what.** weft.zip holds the Weft GitHub App's client secret and your GitHub refresh token, sealed in a table
  only the service role reads. The worker holds its `wwk_` key and its pairing sign key, as before. A card gets a user
  access token (8 hours by GitHub's clock, handed out for 1 hour and rotated after), narrowed to the card's repo by
  default, never a refresh token or the Mac's `gh` token.
- **Who may say yes** ([the chain of trust](connectors.md#who-may-say-yes-the-chain-of-trust)). Each Mac registers its desktop
  approval key (H7's `electron/desktop-signer.cjs`) as a signer on weft.zip, after a change's Touch ID; a key counts once
  someone opens the one-time link mailed to the account's address (which also carries a no-session Revoke link), or when
  a trusted Mac vouches for it under Touch ID. Pairing a worker signs the keys main just pinned. Turning a connector on,
  any change to it and an Allow take Touch ID, then main signs exactly what's written; weft.zip writes it only with a good
  signature (no session can write those tables) and the mint checks it again. The grant names the repos this Mac had
  checkouts of when it was signed. Each new thread Weft's own window starts on a worker is signed by main too (fresh, with
  a nonce, once per card), with the repo main knows the folder as.
- **The mint** (`app/api/connectors/github/mint`, `lib/connector-mint.ts`) reuses H8/H10's signing: the request is signed
  by the sign key `worker_pair_confirm` set, and a trusted Mac must have vouched for that key. Then a grant signed by a
  trusted Mac, a card whose one start is a `card.create` a trusted Mac signed (never a reply, an H6-line verb, a run or a
  card another worker sent), the repo that signed start names, this worker's card not Done or deleted,
  a signed Allow when the approval asks one, a nonce once and the rate limits in one database step; it re-reads the grant
  after getting the token and answers only if it's unchanged. Every answer goes in a ledger you can read.
- **On the box**, a card's git credential helper and gh wrapper ask the daemon over `~/.weft-worker/connector.sock` by a
  per-CLI-process capability, which the socket answers only for a process under that CLI (peer pid from lsof or ss) and
  drops when the CLI exits. gh runs with an env built from scratch and empty config, data and XDG folders, and falls back
  to the box's own gh when there's no token.
- **Revocation** works with the box offline: Turn off or Revoke deletes the grant (a trigger does it on `device_revoke`
  too), then weft.zip deletes narrowed tokens at GitHub and, if this worker holds the current user token, refreshes it under
  the refresh claim (which ends it, per GitHub); only a 204 counts as confirmed, unconfirmed rows stay for a daily sweep,
  which also ends what expired grants left behind.
- **What it doesn't close:** a card can still copy the token it's handed, and with the worker's own key files can ask for
  more while the grant lives (per-card scope is then advisory); a session can't turn anything on unless it also reads your
  email, and can still turn things off. The on-box helper (P4 on a Mac, P5 on Linux) is what closes the first two. A second red-team pass is due.

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
  re-scout, the commit walk-through, the sprint plan, whose prompts point at this Mac's store and server) stays off, and each
  badge gates on it: where it's off but `reads` is on, the act is a card on the worker (T5/T6, below). The streak and the sync ask stay this Mac's (`localPath`): your streak is yours.
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
  `useEditorColumn` and `QuickOpen` read it. A worker's (`lib/worker-files.ts`) reloads an open file over the line (below, PR #86;
  never as relay rows, where a stat every 2 s would be a command each), caches the file index for a minute, and refuses a save over 150 KB before sending (the
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
- **Live reload** (2026-11-03, PR #86). `files.watch` / `files.unwatch` (read policy) over the session line, at most 32
  per line and dropped when the line closes: the worker stat-polls each (`lib/host-line-files.ts`,
  `lib/worker-file-watch.ts`) and the board reloads the editor (`lib/line-file-watch.ts`, `lib/use-file-watch.ts`).
- **Live snapshots** (2026-11-03, PR #76). `cloud_worker_projects` is in the Realtime publication
  (`supabase/migrations/20261103070100_worker_projects_realtime.sql`); the desktop's server subscribes on its first
  snapshot read (`lib/worker-project-live.ts`) and a `worker_project` board event re-reads the badges. Reads stay the
  fallback.
- **Result blobs expire.** `results/` blobs go after a day (`lib/host-result-sweep.ts`): hourly per worker, and daily for
  every workspace with a worker through `app/api/cron/r2-mirror`.
- **Not yet.** The streak counting a worker's turns (your streak is this Mac's).

### Re-scout and sprint planning on a worker (T6)

`projectActs` stays off for a worker, so the two badges that wrote their prompts from this Mac's store and server build
them another way and start a card in the worker's project (`start` is the board's New thread, `card.create`):

- **Re-scout** (`QualityBadge`'s ScoutDialog): `workerScoutPrompt()` in `lib/scout-worker.ts` is the scout's own instructions
  (`lib/scout-prompt.ts`, moved out of `lib/scout.ts` so the board can import them without the SDK) with the findings written
  to a temp file and saved by the plugin's `scout-save.mjs`, the file `/weft:done`'s scout writes. That fills the worker's
  `scout/` report, which the worker publishes in its next snapshot, so the badge refreshes by itself. The card is read-only
  for the project; if the script isn't on the worker it lists the findings in its reply instead.
- **Sprint planning** (`BacklogBadge`): `workerSprintPrompt()` in `lib/sprint-worker.ts` lists the project's Backlog and
  active cards from the board's own cards (the snapshot's count is the fallback). A worker thread has no way to move an
  existing card, so the prompt has it name a sprint's cards for the user to start from the board, and add merged or split
  cards with `mcp__board__create_card` (`start: false` leaves them in Backlog).

### Board tools on a worker

```
worker thread ── mcp__board__* (lib/board-tools.ts) ── onWorker? ── onWorkerBoard (lib/worker-board-tools.ts)
   list_cards   ── boardCards ── worker_board_cards(key) ──▶ the owner's cloud_cards, every host (sealed fields read 🔒)
   create_card  ── localFolder? ─ yes ─▶ createBoardCard here (publisher ships it)
                                └ no ──▶ remoteTarget ─▶ worker_new_card(key) ─▶ cloud_commands new_card (a Mac) │ run (a worker)
   *_cron       ── this worker's own crons.json, fired by its own cron clock ┐
   webhooks     ── this worker's own webhooks.json                            ├─ worker_set_lists ─▶ cloud_worker_lists
                                                                             ┘     └─ Mac: GET /api/crons, /api/webhooks merge them
   list_crons   ── + worker_mac_crons(key) ◀── cloud_mac_crons ◀── each Mac's summary (lib/mac-crons.ts), read-only (mac:<id>)
Mac ⏰ / 🪝 drawer ── PATCH, DELETE, Run now on worker:<id>:<item> (elevated) ── actOnWorkerItem ── host row
                     cron.update · cron.delete · cron.run · webhook.update · webhook.delete ──▶ the worker's daemon
                     dispatch: no card check, remoteRefusal (list-policy), lists rule (a run narrowed by workerStartMode)
   create_agent ── refused (agents live in Settings → Agents on the Mac)
every Weft tool ── WORKER_TOOLS (lib/worker-tools.ts): prompt says what doesn't work; WORKER_TOOL_GATE denies it with why
```

A worker's store (`WEFT_DATA`) holds only its own cards, so before this a thread there "created a card" or "added a
webhook" in a board nobody sees. Now the tools that write the board reach the user's, the same one a Mac card's reach.

- **The link.** `lib/worker-board-link.ts` holds `BoardLink` (`workerId`, the work root, `cards`, `newCard`, `setLists`),
  bound in `scripts/weft-worker.ts` to the registry's three new calls. Off a worker there is none, and the tools say
  "This worker can't reach your board yet". `lib/board-tools.ts` builds the same tools everywhere and, on a worker, hands
  them to `onWorkerBoard`, which swaps handlers by name and keeps every name and schema.
- **list_cards** lists this worker's own cards (its store is fresher than the cloud) plus every other synced card of the
  owner's, read through `worker_board_cards` (key-checked, the owner's rows in the worker's workspace, newest 500). A
  Mac card's folder is its path, another worker's `worker://<id>/<name>`. A worker has no workspace key, so a sealed
  title reads `🔒 sealed` and the other sealed fields are left out.
- **create_card.** `localFolder` decides: empty (the thread's own), `worker://<this worker>/<name>`, a path under the work
  root, or a project name there starts the card here, in the parent's mode, through `createBoardCard`, and the
  publisher ships it like any card. Anything else is looked up by `remoteTarget`: an explicit `worker://<id>/<name>`, or
  the synced cards' folders matched by path or by name (one match, or an error naming the choices). It goes as
  `worker_new_card`, which inserts a `new_card` (a Mac the owner has synced cards from) or `run` (another worker of the
  owner's, headless and not revoked, same workspace) as the owner, so the target's inbox applies its usual checks: a
  Mac's synced folder, a worker's work root. `start: false` travels in the payload (`NewCardPayload.start`,
  `newCardBody`, `runBody`). No agent travels: the target starts it as that project's default
  ([Agents across hosts](#agents-across-hosts)).
- **A worker's card never runs unasked elsewhere.** A worker key belongs to a box, and a thread's prompt can be injected,
  so `worker_new_card` treats both as untrusted: it rebuilds the payload from `prompt`, `title`, `tags` and
  `start: false` alone (no mode, agent, model, repo or attachments) and stamps it `fromWorker: <id>`, which only the
  function can write onto a worker's row, and refuses past 30 such commands per worker per hour. The target reads the
  stamp (`lib/worker-origin.ts`): a Mac files the card in Backlog, in `default`, tagged `from-worker`, without fetching
  pasted files (`holdWorkerCard` in `lib/cloud-inbox-cards.ts`), for the user to start; another worker starts it in
  `default`, never its usual `acceptEdits` (`lib/worker-kinds.ts`). `worker_board_cards` returns only what `list_cards`
  draws (title, column, tags, stage, starred, archived, role, backend, updatedAt), never a card's prompt, latest
  reply, error or pending request, so a worker key can't read what threads on the Mac saw.
- **Crons live where they fire.** A cron's runs are cards in a checkout, and a fork needs the session on that host's
  disk, so a cron for a worker project lives in the worker's `crons.json` and fires on the worker's cron clock
  (`startCronClock`, started after recovery beside the scheduler). `create_cron` on a worker refuses a folder or source
  card that isn't this worker's; `list_crons` lists the worker's and says so. The worker publishes its whole list a
  moment after any `crons` event (`lib/worker-lists.ts`, `worker_set_lists` into `cloud_worker_lists`, owner-only RLS,
  256 KB cap; folders as project names, no fork session). The Mac's `GET /api/crons` adds them
  (`lib/worker-lists-read.ts`, read at most every 15 s, signed-out or table-less reads as none) with
  `worker://<id>/<name>` folders, ids `worker:<id>:<cron>` and `worker` set to the worker's name, so the ⏰ drawer lists
  them. The drawer changes one through a host verb to that worker ([below](#crons-and-webhooks-both-ways-as-built)), and a
  worker thread's `list_crons` lists the Mac's read-only.
- **Webhooks the same way.** A webhook's target is the worker's own dev server, so its registry stays on the worker;
  `lib/webhooks.ts` tells `onWebhooksWrite` listeners after each write, the worker republishes, and `GET /api/webhooks`
  adds the worker's for the folders asked (or all), so the 🪝 drawer and its count show them. Mark registered and Remove
  on the Mac reach the worker as host verbs (below). `add_blank` no longer hides a vault blank it couldn't add: the reply
  names the secret and why.
- **Changelog.** `changelog_*` keep writing the worker's `changelog.jsonl`, which is only a journal: the stamp hooks
  (`lib/changelog-stamp.ts`, in every runner) write and commit the entries into the checkout's own `CHANGELOG.md` after
  the card's commit, as on a Mac, and the user sees them when the worker pushes.
- **create_agent** is refused with a message telling the thread to write the agent out for the user: agents are the
  Mac's Settings → Agents.
- **One capability table.** `WORKER_TOOLS` (`lib/worker-tools.ts`) says, per server and tool, whether it works on a worker
  or why not. `toolPrompts` (`lib/weft-prompts.ts`) keeps a group's own prompt (secrets, webhooks, devservers, gog) only
  when some of its tools work and appends `workerToolsPrompt`, the list of what doesn't with why; `WORKER_TOOL_GATE`, a
  PreToolUse hook in `guardHooks`, denies a call to one of those with the same why, so Claude Code, Codex and Goose
  all hear it before the tool runs. Landing a tool on workers is flipping its entry to `true`.
- **Migration** `supabase/migrations/20261102210000_worker_board_tools.sql`: `worker_board_cards`, `worker_new_card`,
  `cloud_worker_lists` and `worker_set_lists`. Applied.
- **Changing a Mac's cron from a worker** is refused by design (below).
- **The other way, built and landing (PR #83).** This Mac's board tools reach worker cards: `list_cards` merges the
  workers' boards and `read_thread` reads a worker thread from its synced pages (`lib/board-tools-hosts.ts`,
  `lib/worker-board-reach.ts`); `create_card` on a `worker://` project (or a name only a worker has) starts it there
  through `startWorkerThread`, always in `default`, as the project's default agent ([below](#agents-across-hosts)); the
  copilot's tags, start, reply, move, stop and answer on worker cards go as `card.update` / `card.message` /
  `card.stop` / `card.permission.answer` rows (`lib/board-tools-copilot.ts`), queued when the worker is offline. Once
  PR #80 lands, an Allow from the copilot is refused unsigned, by design.

### Agents across hosts

Built 2026-11-03. Choosing an agent for a card on another host is a [signed widening](#signed-widening-as-built) only
Weft's own window signs, and a thread's tool can't, so `create_card` to another host never carries one. It doesn't need
to: every host already starts a card that names none as its project's default, and since PR #79 a worker project's
default is a Mac-signed account setting the worker mirrors (`lib/agent-sync.ts`). So the tools send no agent and say
which one runs it; a named agent passes only when it is that default, and any other is refused before anything is sent
(`lib/host-agent.ts`).

```
create_card(folder, agent?)              the default the target uses           check, before sending
Mac ──▶ worker://<id>/<f>   card.create  worker-kinds defaultAgent (signed)     Mac's projectAgent(worker path) ?? builder
worker ──▶ worker://<id2>/<f>  run       worker-kinds defaultAgent (signed)     the mirrored projectAgent(path) ?? builder
worker ──▶ a Mac folder     new_card     new-card.ts marksFromBody: projectAgent  unknown on a worker: any named agent refused
```

- **Mac → worker** (`createWorkerCard`, `lib/board-tools-hosts.ts`): the Mac is where worker-project defaults are set,
  so its own `projectAgent(worker://…)` is what the worker will use. The reply ends "It runs as Copywriter (copywriter),
  that project's default agent."
- **Worker → worker** (`workerCreateCard`, `lib/worker-board-tools.ts`): the sending worker reads the target project's
  default from the same signed setting it mirrors. A worker that trusts no Mac starts every card as Builder.
- **Worker → Mac**: a Mac folder's default stays on the Mac (`workerProjectAgents` mirrors worker projects only), so a
  worker can't check a name: any named agent is refused (`MAC_AGENT_UNKNOWN`), and without one the card lands in
  Backlog with the Mac project's default (`createCardFromBody`), for the user to change before starting it.
- **Threat.** Nothing widens: the agent a card runs as is one the user picked in Settings → Agents, signed where it
  crosses to a worker, and `worker_new_card` still strips `agent` from a worker's payload in the database.

### Crons and webhooks both ways (as built)

Built 2026-11-02 (migration `supabase/migrations/20261102270000_mac_crons_for_workers.sql`, applied).

- **Mac to worker: five list verbs.** `cron.update`, `cron.delete`, `cron.run`, `webhook.update` and `webhook.delete`
  (`lib/host-api/lists.ts`, in `HOST_API` and `HOST_VERBS`; `isListVerb` in `@weft/client`). `args.id` is the item's own
  id on its host, not a card. The drawers' routes (`app/api/crons/[id]`, `…/run`, `app/api/webhooks/[id]`) take a
  `worker:<id>:<item>` id behind `elevated()`, as every cloud act is, and `actOnWorkerItem` (`lib/worker-list-acts.ts`)
  checks the worker is one of the owner's headless workers, inserts the `host` row (folder `-`), waits up to 8 s for a
  claim and 30 s to finish, and answers `{}`, `{ queued: true }` or the worker's refusal as the error. The routes answer
  with no cron or webhook: `useCrons` and `useWebhooks` keep the drawn change and read again after
  `WORKER_LIST_SETTLE_MS` (`lib/worker-item-id.ts`), once the worker has republished; the Mac's 15 s cache is forgotten
  then too (`forgetWorkerListsSoon`). A worker's webhook deleted from the Mac also loses its relay row (the owner's),
  taken down with the Mac's session after the worker confirms (`deleteWorkerWebhook`), held to rows whose `worker_id` is
  that worker, since the relay id comes from the worker's own published list.
- **On the worker.** `cardKinds.host` sends a list verb past the card check to `CardRules.lists`; a host without that
  rule refuses them (`NO_LISTS`), so a Mac's inbox never changes its own crons or webhooks from the network.
  `remoteRefusal` runs `listRefusal` (`packages/weft-client/src/list-policy.ts`): a cron patch may only name `name`,
  `prompt`, `expr`, `mode` (fork or fresh), `enabled`, `startsAt` and `endsAt`, each with its JSON type, and a webhook
  patch only `name`, `events`, `hint` and `registered`, never `target`, `provider` or `secret`; a run or delete carries
  nothing but its id. A cron prompt starting with "!" is a shell line, so it's refused outright: a signed approval for it
  waits on C (PR #49). `listVerb` (`lib/worker-kinds.ts`) runs a cron now in `workerStartMode(cron.permissionMode)`, the
  mode a new card from the network gets (plan as default, bypassPermissions refused), through `runCron`'s new `mode`;
  the row's `card_id` stays empty (it may name only a card the worker published) and `result.cardId` names the run. A
  `cron.update` that re-words the prompt is new work on every later fire, so the worker narrows the cron's own mode by
  the same rule (a bypassPermissions cron drops to `default`) before the scheduler fires the new words.
- **Worker to Mac: read-only.** Each Mac publishes a summary of its own crons (`lib/mac-crons.ts`, started from the
  prewarm in `lib/copilot.ts`): id, name, schedule, fork or fresh, on or off, next run and the project's name, plus the
  prompt only when it's 120 characters or fewer; never the path, the source card, the fork's session or the runs. It
  upserts `cloud_mac_crons` (owner-only RLS) 2 s after any `crons` event and every 10 minutes, and signed out writes
  nothing. `worker_mac_crons(key)` hands the worker its owner's rows, rebuilding each entry from those fields alone.
  `list_crons` on a worker appends them as `mac:<id>` lines with the Mac's name (`lib/worker-mac-crons.ts`, through
  `BoardLink.macCrons`), and `update_cron`, `delete_cron` and `run_cron_now` refuse a `mac:` id with why: a worker thread
  is the less-trusted side (a box's key, a prompt that can be injected), so a Mac's cron changes only on the Mac.
- **The drawers on a worker project.** `RailContext.workerProject` (the selected worker:// project, from `Board.tsx`)
  makes ⏰ and 🪝 show that worker's own (`lib/use-rail-lists.ts`). `ProjectHost.can` gains `lists` (both hosts) and
  `relay` (this Mac only): ⏰'s switch, Run now, Edit and Delete check `lists`; 🪝's Add, tunnels, Get a public URL and
  Stop relay check `relay`, so a worker's webhook shows its URL (made by a thread there, `lib/relay-worker.ts`) with Mark
  registered and Remove. A cron row names the worker it fires on (`cronSummary`).

### Drawers and mini apps on a worker project (T5, as built)

```
rail:  Board ctx.project (a worker's path too) ─ railProjects(project, folders, vaults) (lib/rail-project.ts)
         ├─ host.can("vault")? the project : repo = twinOf / twinByRepo (lib/worker-twin.ts) ─▶ 🔐 ▲ Supabase Cloudflare BlastCP Slack ✦
         └─ host = the project itself ─────────────────────────────────────────────────────▶ 🖥 Services, GitHub, 🪝
Services: WorkerDevServers ─ shownWorkerDev (lib/worker-dev-view.ts) ─ Log / Restart / Stop ─ askWorker("dev.log") / actOnWorker("dev.restart" | "dev.stop")
GitHub:   /api/github/issues { folder: worker://w/app } ─ runSync ─ syncWorkerIssues (lib/issue-worker.ts) ─ this Mac's gh in the twin ─ sendRun ─▶ `run` on the worker
apps:     WorkerPane ─ SaveAppButton(blob:sha256:…) ─ POST /api/apps ─ saveWorkerPageApp (lib/mini-app-worker.ts) ─ ~/.weft/apps/worker-<sha>/index.html ─ saveApp(file:…, source)
badges:   PileBadge ─ fetchPileReview ─ host can't projectActs, can reads ─ workerPilePrompt(snapshot pile) (lib/pile-worker.ts) ─ a card on the worker
```

- **The twin.** A worker names a project by its folder under the work root, which is the repo's name for a checkout
  cloned there (and the basename `lib/worker-handoff.ts` sends). `lib/worker-twin.ts` finds this Mac's folder of that
  name (`twinOf`), else the vault whose `owner/name` label ends in it (`twinByRepo`): the same rule main uses to pick a
  worker card's vault (`electron/worker-projects.cjs`). Names only: the values stay behind Touch ID in main.
  A name is a guess, so what acts on the repo checks it: the issue sync reads every namesake's remote (`twinsOf`) and
  refuses when they name different repos. The drawers still show the first namesake; the worker doesn't publish its
  remote yet, so a lone Mac folder of the same name but another repo can't be told apart.
- **Which drawer reads what** (`lib/rail-project.ts`, gated on `hostFor(project).can("vault")`, which a worker's host
  answers false): what is per repo (🔐 vault, ▲ Vercel, Supabase, Cloudflare, BlastCP, Slack, ✦ Skills) reads the twin;
  what is per host (🖥 Services, GitHub's issue sync, 🪝 webhooks) reads the worker project itself. With no twin the
  per-repo drawers get the worker path, which matches none of this Mac's folders, so they show nothing for it rather than
  every project. `Board.tsx` now hands the rail the project as it is (`ctx.project`), not `localPath`.
- **Services** (dev-servers.md#on-a-worker): two more host verbs, `dev.restart` (the run's own command again, through
  `restartDev`) and `dev.log` (its last 40 lines, key-shaped text hidden by `redactText`, a first line cut by the log's 4,000-character cap dropped, then held under 2,500 UTF-8
  bytes by `verbResult`'s `tailBytes`, so the row stays under its 4 KB cap). Both refuse a server a thread started in its
  own shell ("can only stop it"), and neither is elevated: they widen nothing. Locally they mount on `POST
  /api/cards/:id/dev` as `rerun` and `log` (`restart` stays the review tour's plan). The drawer's worker rows gain Log
  (read into the row, a second click hides it), Restart (Start once the run ended) beside Stop, and a worker project
  shows only that worker's checkout (`shownWorkerDev`).
- **GitHub issues into a worker project** (github-issues.md#on-a-worker): the drawer asks about the worker project in
  view too (`githubFolders`); its repo is read with this Mac's `gh` in the twin (`workerIssueRepo`, used by
  `lib/github-status.ts` and the sync). `syncIssues(worker path)` sends each new open issue as a `run` (`sendRun`, now
  carrying a title and tags, `runCommand`), with the project's validation skill first, recording each in the same
  `github-issues.json` as it goes (`lib/issue-record.ts`, extracted from `lib/github-issues.ts`), so a repo synced on
  both hosts makes each card once and a failure part way never sends one twice. Only the Run landing works: Backlog and
  Needs you need a card made and left unstarted, which a worker refuses until `card.create` lands (WP2, PR #45), so
  those say so (`WORKER_BACKLOG_LATER`). A card it sent has started, so sync never touches it again, as on a Mac. The
  project's agent isn't sent: a worker refuses an agent from the network (`remoteRefusal`).
- **Mini apps from a worker card** (mini-apps.md#from-a-worker-card): the worker card's pane (`components/WorkerPane.tsx`)
  shows Save as app on a page the card wrote (a `blob:sha256:` page). `POST /api/apps` with that address reads the blob
  with the account's session (RLS: your workspace), refuses anything but HTML, over 5 MB or whose bytes don't hash to the
  address, writes it to
  `~/.weft/apps/worker-<sha16>/index.html` (where a cloud sync pull puts an app) and saves it with `source` naming the
  blob, so `appFor` lights the button on that page. From there it's an ordinary app: the rail opens it on this Mac,
  `cloud_mini_apps` carries it to your other Macs, and Share… serves it at `weft.zip/a/<id>` (the same bytes, already in
  the store). A page's sibling assets don't come along (a worker page is one file today).
- **Badges.** H4's snapshot already fed quality, the scout, the pile and Backlog. The pile's commit walk-through now
  works on a worker project: `fetchPileReview` writes its prompt from the snapshot's pile (`lib/pile-worker.ts`: the
  counts, plain `git add -- … && git commit -- …` by path, the same never-stash rules) and the card starts on the worker.
  Re-scout and the sprint plan still say "not on a worker's projects yet".
- **Not in T5.** 🪝 webhooks and ⏰ crons for a worker project wait on T1 (PR #43, open when T5 was built): the 🪝
  drawer reads the worker project and so shows none. The worker's own secrets list is T2. No migration.

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
  that card, nonce and command ([H8](#secrets-on-a-worker-h8-the-per-use-seal-as-built)). The worker opens it, runs, and redacts as the Mac does. The other
  secrets tools and a dev server's env follow the same rules ([T2](#the-vault-on-a-worker-t2-as-built)).
  `fill_field` stays desktop-only: the pane is on the Mac.
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
  terminal a pty in one project folder, opened only by a signed approval (Signed widening, below); refused without one
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
- **A worker card's browser rides it too.** A `browser-<16 hex>` device has no video m-line: `useLineFrames`
  (`lib/use-line-frames.ts`) adds only the input channel, and the worker sends the page's screencast JPEGs down it,
  length-prefixed like the video channel, with pointer and keys coming back up ([worker-browser.md](worker-browser.md)).
- **The terminal opens only signed.** A pty is a shell, and H2 refuses a shell from the network because whoever holds the
  account's session can insert a row. A line is no better: the sealed offer proves that only the worker answers, not that
  Weft's own window offered (the worker's key is public, so anyone with the session can seal one). So the `terminal`
  channel's first message must carry a Touch ID approval for that project folder, checked against the Mac key the worker
  pinned ([Signed widening](#signed-widening-as-built)); without one it's refused with `TERMINAL_REFUSAL`.
- **TURN.** `GET /api/rtc-ice` (elevated: a TURN allocation is billed relay traffic) mints Cloudflare credentials for 4 h
  with `CLOUDFLARE_TURN_KEY_ID` and `CLOUDFLARE_TURN_KEY_API_TOKEN`, reused for half that, port-53 URLs dropped; without
  them, or on any failure, STUN alone. The servers ride inside the sealed offer, so the worker relays through the same
  credentials and never needs its own.
- **The route chip.** Each pong calls `setWorkerRoute(workerId, "direct", ms)` (`lib/worker-route.ts`), so the worker
  chip's tooltip reads "direct · 4 ms"; once pongs stop, relay notes take over after 15 s.
- **Migration.** `supabase/migrations/20261102160000_line_command.sql` adds `line` to the kind check (applied), and
  `20261103150000_line_row_shape.sql` lets a browser insert its own sealed offer (applied).
- **Verified** with two real werift peers (`lib/session-line.real.test.ts`): the sealed offer, the answer under the
  one-time key, verbs and their refusals, a pushed event, ping/pong, an ICE restart over the line, and a video m-line
  plus input channel renegotiated over it, and the LAN path over loopback (`lib/lan-line.loopback.test.ts`). Still to try
  by hand: Electron's own Chromium against a real worker through TURN, and the LAN path on a real LAN.
- **Streaming deltas** (2026-11-03, PR #86). Reply text rides `events` as deltas, coalesced over 50 ms, redacted, held
  to whole words and reset when the item settles (`lib/line-deltas.ts`, `lib/line-streaming.ts`,
  `lib/use-thread-live.ts`), so a worker card's reply types out over the line.
- **The LAN path** (2026-11-03, PR #82, [weft-worker.md](weft-worker.md#the-lan-path)). A paired worker advertises
  `_weft._tcp` with a TXT signed by its pairing sign key; this Mac's server checks it against main's pins, seals the offer
  to the pinned box key, posts it signed by the Mac's device key to the worker's port and takes the answer in the reply.
  The Supabase row is the fallback, and each new offer after a drop takes the LAN when a hint is up. Not yet tried on a
  real LAN.
- **weft.zip seals its own offers** (2026-11-03, PR #89,
  [mobile-security.md](mobile-security.md#a-session-lines-offer-sealed-in-the-browser-or-on-the-phone)). `@weft/client`'s
  `sealTo` (libsodium X25519 with Web Crypto HKDF and AES-GCM, byte-compatible with `lib/worker-seal.ts`); `lineOpener`
  inserts the line row under the visitor's session; `offerLine` / `openLine` take the platform's RTCPeerConnection, and
  the desktop offers through them too. weft.zip holds a line to your own worker card (`lib/web-lines.ts`, `useWebLine`):
  verbs through `cloud-host-acts` (never a widening or pasted files), events through `lib/line-thread.ts`, the screen as a
  track.
- **TURN on weft.zip** (2026-11-03, PR #91). `GET /api/web-board/ice` (`lib/web-ice.ts`) mints the same Cloudflare TURN
  credentials as `/api/rtc-ice`, for a signed-in owner of an unrevoked worker; STUN when it can't. Needs
  `CLOUDFLARE_TURN_KEY_ID` and `CLOUDFLARE_TURN_KEY_API_TOKEN` on Vercel production.
- **Not yet.** The phone app wiring `openLine`; Supabase leaving the card-list poll entirely (the workers' board now
  takes `card.list` over each line and reads once a minute while every shown worker has one, H1).

### Signed widening (as built)

```
desktop board ── hostOf(card).act(verb, args) ── actOnLine ── signedArgs: widenChangeOf(verb, args) ≠ null?
                    └─ window.weft.approval.widen({host, card, verb, change, args}) ─ main: Touch ID in its own words ─ Ed25519
weft.zip board ── cloudHostActs.act ── widen(ask) ─ sign.weft.zip/approve?widen=… ─ passkey ─ inserts the host row itself
                                   args.widen = { kind, device, issuedAt, nonce, sig | assertion }
host (Mac inbox, worker daemon, line): cardKinds.host ─ remoteRefusal ─ widenChangeOf ─ rules.widen ─ widenProblem:
   fresh (±2 min) · nonce unused (kept on disk) · no bidi · the host's limits · message rebuilt from its own names ·
   signature against its pins (Mac: main's /pairing/verify, /pairing/passkey-verify; worker: lib/host-signers.ts) · nonce spent
```

H2 refused, from the network, anything that widens what a card can touch, because a `cloud_commands` row or a line message
is backed only by a Supabase session. Since H7 and the desktop signer there are per-action signatures from keys a host
pins, so each refusal lifts when, and only when, the command carries a fresh approval bound to exactly that action.

- **The message** (`packages/weft-client/src/widen.ts`, re-exported by `lib/widen.ts`): canonical JSON (keys sorted at every
  depth) of `{ v: "weft-widen-v1", host, card, verb, change, args, nonce, issuedAt }`. `host` is a Mac's `lib/device-id.ts` id or
  a worker's id; `change` is exactly the widening, read off the command by `widenChangeOf` with remoteRefusal's own rules:
  `cwd` (a worker's project name, a Mac's synced path), `agent`, `permissionMode: "bypassPermissions"`, `readScope`,
  `shell` (`card.shell`), `schedule` (a `card.schedule` "!" line), `terminal` (a project folder; verb `terminal.open`, no
  card) and `create` (`{ agent, folder, prompt }` for a new thread with an agent; verb `card.create`, no card). The `v`
  keeps it from ever reading as an answer's message. `args` binds the rest of the command whole, so a row re-sent with
  the same approval and another title, mode, column, send-at time or CLI is another message: a host verb's args
  without the approval and the card (`widenArgsOf`), a new thread's terms as the host starts it (`createTerms`: prompt,
  title, model, repo, effort, CLI, mode), `{}` for a terminal.
- **The auth** rides as `args.widen` on a host verb (stripped before the handler runs, `withoutWiden`), `payload.widen` on a
  `run`/`new_card`, and `widen` in the terminal's open: `{ kind: "ed25519", device, issuedAt, nonce, sig }` (the desktop's
  Touch ID key or a phone's) or `{ kind: "webauthn", device, credId, issuedAt, nonce, authenticatorData, clientDataJSON,
  signature }` (a passkey on sign.weft.zip). `readWidenAuth` takes only those shapes.
- **The check** (`lib/widen-check.ts` `widenProblem`, called from `lib/host/dispatch.ts` `cardKinds.host` through
  `CardRules.widen`, from `lib/create-widen.ts` for a new thread and from the terminal): within `WIDEN_TTL_MS` (2 minutes)
  of the host's clock; a nonce not seen (on a worker `lib/widen-nonces.ts`, `widen-nonces.json` in its sealed home; on a
  Mac Electron main's `electron/widen-nonces.cjs` over `POST /pairing/widen-nonce`, in memory and sealed with safeStorage
  in `~/.weft/vault/`, failing closed when that copy is gone or garbled, so neither a restart nor a thread rewriting a file
  replays one; taken after the signature checks out so of two racing commands only one runs); no bidi
  override in any string of the change; the host's limits; then the signature over the message **rebuilt from the host's
  own id**. A signed widening also stands in for the Mac's `ELEVATED_REFUSED` rule over what it signed, and only that:
  the rest of the same `card.update` (another mode beside a signed agent) still meets the rule (`unsignedRest`,
  `lib/host/dispatch.ts`). Without an approval the host says exactly what it said before.
- **Passkeys sign less**, as for answers (mobile-security.md): skipping permission prompts and a read grant stay on the
  Mac or a phone (`PASSKEY_TOO_WIDE`). A "!" line (`card.shell`, a `card.schedule` "!" line) from a passkey is refused
  (`PASSKEY_NO_SHELL`) unless the host lets the web approve: a Mac whose Settings → Sync says so (`passkeyShell`); never
  a worker. Where it's allowed, **a passkey is a shell** for whoever holds it: `phoneOnly`'s list (a vault tool, an
  agent's config, a skip flag, `PHONE_ONLY`) still applies, but no list holds against obfuscation. A passkey can move a
  card and change its agent.
- **On a Mac** (`lib/cloud-inbox-cards.ts`): main verifies (`POST /pairing/verify` for a phone's key, never this Mac's
  own desktop key from the network (`OWN_KEY`), `/pairing/passkey-verify` for a paired browser, its counter kept); a new folder must be one switched on in Settings →
  Sync (`macConfine`); a `new_card` with an agent needs its approval over the synced path the inbox resolved.
- **On a worker** (`lib/worker-widen.ts`, `lib/worker-signing.ts`, wired in `scripts/weft-worker.ts`): Ed25519 against the
  **pairing Mac's key**, the one H8 pins from the pairing code the person carried to the box (`lib/worker-mac-keys.ts`,
  `mac-keys.json`), so secret asks and widenings trust the same Mac and no other; passkeys only once that Mac endorsed them
  (below). A new folder (`cwd`) and a terminal must name one of its project folders (`listProjectFolders`), and the card
  then runs in that checkout and is filed under it (`placeUpdate`, `publisher.nameFolder`), and its checkout must really
  sit under the work root (symlinks followed: a project folder linked to `/` is refused); a read grant stays under its
  work root, symlinks followed too. One nonce book per file in the process (`sharedNonceBook`). A token-enrolled worker has no Mac key, so it refuses every widening (`NO_MAC`) until it's paired.
- **Passkeys on a worker** (`lib/host-signers.ts`, `lib/host-endorse.ts`): Settings → Devices → a worker's **Passkeys**
  asks Touch ID once, main signs `weft-endorse-v2` over the **whole set** of passkeys it pinned, for that worker, with a
  generation that only grows (`electron/widen-endorse.cjs` `approval:endorse`), and this Mac's server inserts it as a
  `pin` command (`lib/worker-pin.ts`, `POST /api/worker-board {action:"pin"}`, elevated). The worker checks it against the
  pairing Mac's key (for itself, newer than the generation it holds; within 10 minutes only when the set adds a passkey,
  so a revoke still lands on a worker that was off for a day) and replaces its list in `passkeys.json` (mode 600, sealed
  from threads like the rest of its home), keeping each kept passkey's counter. So a revoke is a smaller set, and an
  older endorsement read off an earlier `pin` row is refused (`ENDORSE_OLD`); the set it holds, sent again, is held.
  The pin's result is a **receipt**: the generation it holds, signed with the worker's pairing sign key (`sign-key.json`,
  `heldMessage`). Main remembers, per worker, the exact passkeys (device, credential, key) it endorsed, the signed set
  and whether a receipt confirmed it (`vault/endorsed-workers.json`, sealed). `lib/passkey-sync.ts` (from the desktop
  board's header every 30 s, one timer per window, `lib/use-passkey-sync.ts`, and at once after Passkeys or a revoke) asks main for every unconfirmed set (`approval:endorse-refresh`,
  which first narrows each to the passkeys still paired here, exactly, without Touch ID), sends it as a `pin`, waits for
  the receipt and hands it to main, which checks it against the sign key it pinned for that worker
  (`approval:endorse-confirm`, `worker-pins.cjs` `signKeyOf`). A pin row a stolen session deletes, one a stolen worker
  key claims and drops, or one an offline worker hasn't taken leaves the set pending: it's sent again. A row still on
  its way is read once per sync rather than sent again, until it's gone or unreadable, failed, or older than
  `PIN_STALE_MS` (a minute), and then a fresh one goes (a second row for a held set is harmless). Until every worker
  confirms, the header's Settings button carries a warn dot and the worker's row in Settings → Devices says
  "passkeys not updated yet". A device id paired again with a new credential
  isn't in a narrowing; adding passkeys asks Touch ID. `approval:endorse {revoke: true}` is an empty set, no Touch ID.
  Since PR #85 a worker also refuses passkey approvals while its set is behind the Mac's signed head (insert-only
  `worker_passkey_heads`, checked in `verifyPasskey`;
  [weft-worker.md](weft-worker.md#passkey-heads-a-worker-never-approves-with-an-outdated-set)), and a device revoked
  on any Mac is dropped by the others and by the workers that pinned it.
- **The desktop's prompt** is main's own words over exactly the fields it signs (`readWidenRequest`, `widenPrompt`): "run
  the shell command make test, for card 1a2b3c4d on the worker m1mini (7f3e…)", naming a worker by the name main pinned
  it under (`worker-pins.cjs` `nameOf`) and any other host by its whole id; what rides with the change too ("(and its
  title with it)", a "!" line's send-at time, a new thread's first message, cut with its length, and its mode, CLI and
  model); a terminal reads "open a full shell (a terminal) in app". Main's copy of the message is proven byte for byte
  equal to @weft/client's (`electron/widen-sign.test.ts`). Main signs nothing the prompt would cut or bend: a field
  longer than it shows (a "!" line over 160 characters), a control or format character (a newline is a second command),
  or a value of the wrong type is refused rather than shown as "…" or a space. Board window only, never the control
  server a thread can call; and a thread driving the board (`board_view`) can't reach the controls that ask for one: the
  terminal drawer (xterm's own textarea, marked or not), the New thread dialog's folder, agent and mode, and the list
  view's folder picker are `data-human-only` (`electron/board-view.cjs`). The card menu is the shell's native menu.
  `board_view` types only once focus really is on the field it named, and checks again right before it types, so a field
  that can't take focus can't leave the typing in the terminal or the reply box. Extra fields riding with a
  `card.update` show with their values.
- **Where the board signs** (`lib/widen-signer.ts`): `actOnLine` signs before it routes, so every caller gets it: the
  menu's `agent:*` and Skip permissions (`remoteMenu(items, { agent, skip })`), the list view's folder picker (a worker
  card's folders are that worker's projects), the thread's "!" line and Read from (`workerTransportVia` gains `shell` and
  `grantFolder` where `canSignWiden()`), a new thread with an agent (`api.create` → `withCreateWiden`), and the terminal.
  `cloudHost.can` turns on `folder`, `agent`, `shell` and `terminal` where the desktop app can sign. With no signer the
  command goes unsigned and the host refuses it in its own words. On weft.zip with a paired passkey, `cloudHostActs`
  hands a widening to `openWidenWindow`: sign.weft.zip/approve?widen=… reads the card itself with its own session and
  refuses one that isn't this account's on the host and folder the link names, or names no owner (`loadWidenCard`), names it by title and
  folder, rebuilds the args from the change alone (`argsFromChange`, a "!" line's send-at time kept and shown), shows
  them whole (`lib/sign-widen-sheet.ts`), signs them and inserts the host row itself (`lib/sign-widen.ts`), so nothing
  the link put beside the change rides along; the web host's menu offers the agent and its transport
  the "!" line.
- **The terminal** (`lib/host-line-terminal.ts`, `lib/line-terminal.ts`): only on the H6 line, never the relay. The drawer
  on a worker project (`lib/board-folders.ts` gives it the worker path where the host `can("terminal")`) uses
  `terminalBridgeFor`, the same bridge shape as `window.weft.terminal`: Touch ID for the folder, then a `terminal` channel
  on the live connection (`SessionLine.channel`, no renegotiation) whose first message is `{ t: "open", folder, cols, rows,
  widen }`. The worker checks it, spawns a login shell in that checkout (`lib/worker-pty.ts`, node-pty, with the daemon's
  own settings and credentials left out of its env: `WEFT_*`, `SUPABASE_*`, `DATABASE_URL`, tokens, secrets, keys, PATs,
  credentials, and any URL with a user and password in it), and carries
  `input`/`resize` in and `data` (16 KB chunks)/`exit` out. One terminal per line at a time; it's killed when its channel
  closes, and every one is killed when the line closes. With no direct line the drawer says so ("The direct line to
  m1mini is down…"). A worker from before signed widening answers every terminal channel with its old refusal
  (`LEGACY_REFUSAL` in `lib/line-terminal.ts`), which the drawer reads as "m1mini needs to update before its terminal works
  here". A shell refused or cut off before it opened reports no exit, so the pane shows that one reason
  (`components/TerminalPaneStatus.tsx`). The drawer opens a worker's terminal only on your toggle for that target
  (`lib/use-terminal-drawer.ts`): picking a worker card with the drawer open for another folder hides it rather than ask
  Touch ID, and plain `t` counts only on the board itself (`onBoardItself` in `lib/hotkeys.ts`).
- **Migration** `supabase/migrations/20261102200000_signed_widening.sql` adds the `pin` kind (applied). The widenings
  themselves ride inside `host`, `run`, `new_card` and the line.
- **Left refused.** A passkey can't skip permission prompts or grant a folder (H7's rule); a Mac card's terminal from
  weft.zip (the web has no line, and a Mac has no terminal service off the desktop); a new thread with an agent from
  weft.zip (the sign page signs host verbs only); "Always" on a worker's Read from (a grant is per card there); the phone
  app, which doesn't build the message yet.

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

Secrets on a Worker start as the per-use seal above (`secret_use`). The vault can now also be kept on the host, opt-in,
each use still behind the Mac's Touch ID ([secrets.md](secrets.md#kept-on-a-worker), PR #88). On a worker card the
desktop's Allow is signed by main after Touch ID once PR #80 lands; the phone approving on a worker (H10) and signing a
local card's Allow are still open.

## Devices and records

- **One address:** every project is `(host, repo)`, with this Mac one host among others, so `worker://` paths and
  `localPath` gates live only inside `hostFor`.
- **One card schema** (H5a, built 2026-11-02): the cloud row is a sealed projection of the host's `Card`, made by one
  module, `lib/card-rows.ts` (`projectCard`, `projectItem`), for a Mac's flush and a worker's publisher alike. Identity
  (`owner_device` and the full path on a Mac; `worker:<id>` and the project name, filled in by the RPC, on a worker), the
  transport (an upsert with the account's session in chunks of 100; `worker_put_card` / `worker_put_items` per card) and
  the sealer (the workspace key on a Mac; on a worker, the workspace key a Mac granted it, PR #92) stay per host. The differences that remain are `RowHost`
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

## What landed on 2026-11-03

The parity day's PRs, one line each, where the sections above don't already carry them. Every migration named here is
applied on production.

- **H1, thin card routes** (PR #77). Every card route but `[id]/files`, commit, release, share and shots is a thin
  wrapper over `runVerb`. `POST /api/cards` runs `card.create` as a local caller (`HostCtx`), the only caller that may
  hand a card off. New verbs: `card.list` (host-level), `thread.page`, `thread.search`, `thread.tool`, `dev.start` and
  `dev.status`. A worker answers `card.list` and `thread.*` as its rows carry them (`lib/worker-reads.ts`, the
  publisher's snapshot), over a row or the line; a Mac refuses both from the network. The workers' board takes
  `card.list` over each line as it comes up and reads once a minute while every shown worker has a live line.
- **YOLO in a worker card's mode picker** (PR #74), where the board signs it (`transport.signsSkip`, the desktop app),
  through `actOnLine`'s signed widening.
- **Worker card fixes** (PR #75): the handed-off local card left out of streaks and XP, ⌘F paging cut tool results in,
  the "at its cap" marks from the worker's own caps, the first-message rerun on your synced backup model.
- **Leases, Realtime snapshots and result GC** (PR #76; migrations `20261103070100_worker_projects_realtime.sql`,
  `20261103070200_command_leases.sql`): [H5](#one-host-program-h5-as-built), [H4](#project-reads-and-the-editor-h4-as-built).
- **The native pane on a worker card** (PR #78, [weft-worker.md](weft-worker.md#pages-from-a-worker)): the
  desktop loads a worker card's uploaded pages and sites in the native `BrowserPane` through the read-only
  `/api/worker-board/page/<sha>` (`lib/worker-native-page.ts`); `WebPane` stays for the live screen, worker-only pages
  and weft.zip; `weft://` links from worker pages are dropped.
- **Crons, the skill set chip and agents on worker cards** (PR #79, migration `20261103120000_account_setting_agents.sql`).
  ⏰ sends `cron.create` (`args.id` is the card) through `hostOf(card).act`, its fields held by `cronCreateRefusal`, the
  worker narrowing the mode and a Mac refusing it from the network. The chip is `card.update { skill: { name, on } }`
  running `setCardSkill` on the host, listing the worker's `skills.list` (skills.sh search off). Agents travel as the
  signed `agents` account setting.
- **Goose, paste and Android on a worker** (PR #81). Goose's provider as a `settings.put` signed by the pairing Mac's
  Touch ID key, checked against the pinned key ([weft-worker.md](weft-worker.md#goose-on-a-worker)). ⌘V on the live
  screen sends up to 2,000 characters of clipboard text on the input channel (idb key presses, `adb input text`, the
  worker browser's `Input.insertText`). Android's live screen is screenrecord H.264 on the same RTP track, switching
  recordings before the 3-minute limit, stills as the fallback.
- **The LAN path** (PR #82): [H6](#the-session-line-h6-as-built), [weft-worker.md](weft-worker.md#the-lan-path).
- **H9 second pass** (PR #84). Thread paging (`thread-page.ts`, `cloud-thread-page.ts` with its opener passed in), board
  grouping (`board-group.ts`), the cloud command shapes, builders and readers, the pending ask (`pending.ts`,
  `pending-sends.ts`), thread find and the transport's shape (`ThreadTransport`, `mergePage`) moved into `@weft/client`,
  re-exported at their `lib/` paths. Still in `lib/`: the transports and hooks, the Mac's `newCardBody` / `answerGrant`,
  the move rules (chimes, unseen), the runner's settling and the model lists `newCardCommand` reads.
- **Devices follow-ups** (PR #85; migrations `20261103080000_worker_pairing_mac.sql`,
  `20261103080100_worker_passkey_heads.sql`). Asks go to the pairing Mac (`cloud_workers.paired_mac`); a revocation on
  one Mac reaches the others (`electron/pairing.cjs` reconcile) and the workers (`worker_mac_state`, `mac-revoked.json`);
  passkey generations as signed heads ([weft-worker.md](weft-worker.md#passkey-heads-a-worker-never-approves-with-an-outdated-set)).
- **Streaming deltas and live file reload** (PR #86): [H6](#the-session-line-h6-as-built), [H4](#project-reads-and-the-editor-h4-as-built).
- **Sealed blobs** (PR #87, [mobile-security.md](mobile-security.md#sealed-blobs)). With sealing on, the files a sealed
  row names go up sealed under `blobAad(org, sha)`: the Mac per card through `Sealer.blob`, a paired browser's pastes
  into a sealed card through `lib/web-upload.ts`; opened by `macReceive`, `lib/web-blob-open.ts` and `useSealedPage`.
  Servers show a 🔒 stand-in.
- **A worker seals too** (PR #92, migration `20261103090000_worker_key_grants.sql`;
  [mobile-security.md](mobile-security.md#sealing-on-a-weft-worker)). Settings → Devices → **Seal…** grants a paired
  worker the workspace key, sealed to its pinned box key and signed by the Mac after Touch ID
  (`electron/worker-key-grants.cjs`); the worker checks it against `pinned()` (`lib/worker-key-grant.ts`,
  `lib/worker-keyring.ts`), and rotation re-grants, Re-pin and Revoke drop and rotate. The worker then publishes sealed
  rows, blobs and pages and holds a row rather than go plain once sealed (`seal-floor.json`); the desktop opens them
  through `POST /sync/keyring` (`lib/worker-board-open.ts`), ⌘F included.
- **Files pasted into a sealed worker card go sealed** (PR #94), with the version the card's row came sealed with
  (`cardBlobSeal`, `lib/worker-board-open.ts`), and Seal… is offered at pairing. A brand-new worker thread (no row yet)
  still sends its files plain.
- **Values kept on a worker** (PR #88, migration `20261103130000_worker_vault_keep.sql`;
  [secrets.md](secrets.md#kept-on-a-worker), [mobile-security.md](mobile-security.md#values-kept-on-a-worker-h8-2026-11-03)).
  Opt-in per worker, project and environment (development and preview only); each use still needs the Mac's Touch ID,
  only the value's trip is saved. A kept value is readable by any code a card on that worker runs.
- **weft.zip seals its own offers** (PR #89, migration `20261103150000_line_row_shape.sql`) and **TURN on weft.zip**
  (PR #91): [H6](#the-session-line-h6-as-built).
- **Goose's key on a worker** (PR #93, migration `20261103160000_goose_key_ask.sql`;
  [weft-worker.md](weft-worker.md#goose-on-a-worker)). Each Goose turn on a paired worker asks the
  paired Mac through a signed `goose_key` ask; main answers only for the provider and endpoint it last signed for that
  worker, after Touch ID, with a Mac-signed `secret_use` (`use: "goose"`) sealed to the pinned box key. The key goes into
  that one Goose process's env, redacted, never kept (`lib/worker-goose-key.ts`, `electron/worker-goose-key.cjs`).

**Built, landing** (open PRs):

- **Signed Allow on worker cards** (PR #80, H7's follow-up). The desktop's Allow on a worker card is signed by main
  after Touch ID over the worker's own names (`lib/answer-signer.ts`, `electron/approval-sign.cjs` reading
  `GET /api/worker-board?ask=`); a worker refuses an unsigned Allow once it pins a Mac or a passkey
  (`lib/worker-approve.ts`, `answerAsKind` on), with a clear refusal for older Macs. Roll-out: update the Mac before
  its workers, or Allows on worker cards are refused and the request stays waiting.
- **This Mac's board tools reach worker cards** (PR #83): [Board tools on a worker](#board-tools-on-a-worker).
- **Agents across hosts** (this change, on top of PR #83): a card a board tool sends to another host runs as that
  project's default agent; another named agent is refused with why ([Agents across hosts](#agents-across-hosts)).

## Still open

Plainly, as of 2026-11-03:

- **Approvals.** The phone approving on a worker (H10); signing a local card's Allow (PR #80 covers worker cards only).
- **Passkey re-pair at weft.zip.** Designed only
  ([weft-worker.md](weft-worker.md#a-passkey-approved-re-pair-designed-not-built)): it needs a phone approver and a
  console code.
- **Sealing files pasted into a brand-new worker thread** (no row yet to take the seal version from).
- **Connectors.** Lending the Mac's gog and gh sign-ins to a worker is not planned: it would need a process boundary,
  and the process split is dropped ([Connectors](#connectors-on-a-worker-not-planned)).
- **The phone app wiring `openLine`** lives in its own repo, `aimhuge/weft-mobile` (`~/dev/weft-mobile`, [mobile.md](mobile.md)).
- **Smaller gaps.** The in-thread `ask_add` input on a worker card; the streak counting a worker's turns; a sealed tool
  output matching ⌘F.
- **Not planned: `fill_field` on a worker's browser.** Cards on a worker run as the daemon's OS user, so a value the Mac
  seals to the worker for typing can be opened by any code a card there runs, breaking fill_field's promise that the
  thread never sees it ([secrets.md](secrets.md#fill_field-on-a-weft-worker-not-planned)).
- **Checked by hand, not yet done.** The LAN path on a real LAN; Electron against a real worker through TURN; Android's
  H.264 live screen on a device (decode and the switch before 3 minutes); the hand checks listed on PRs #78, #81, #86,
  #87, #88, #89 and #92; `CLOUDFLARE_TURN_KEY_ID` / `CLOUDFLARE_TURN_KEY_API_TOKEN` on Vercel production for weft.zip's TURN.

## Phases

Each ships on its own. Status as of 2026-11-03.

1. **H1 card verbs into `host-api`** (built 2026-11-03, PR #77, [above](#what-landed-on-2026-11-03)). The card routes are
   thin wrappers over `lib/host-api`, behaviour unchanged, plus the `card.list`, `thread.*` and `dev.*` reads.
2. **H2 the `host` command** (built 2026-11-02, [as built](#the-host-command-h2-as-built)). `kind = 'host'` with `{ verb, args }`
   and a `result` column; the daemon and `cloud-inbox.ts` run `runVerb`, and `reply`, `answer`, `stop` and `mode` are aliases
   (`new_card` stays the Mac's own kind; a worker's new thread is `card.create`, [board parity](#board-parity-as-built)). **Attachments travel**
   (`lib/attachment-transfer.ts`, [weft-worker.md](weft-worker.md#worker-projects-on-the-desktop-board)); `cloud-inbox.ts`
   receives them and the web composer sends them (H3c), and they go sealed where the card is (PRs #87, #92, #94).
3. **H3 `hostFor` and one open card** (built 2026-11-02, [as built](#hostfor-and-one-open-card-h3-as-built)), with
   **H3b composer parity** ([as built](#composer-parity-h3b-as-built)) and **H3c web board parity**
   ([as built](#web-board-parity-h3c-as-built)).
4. **H4 project reads** (built 2026-11-02, [as built](#project-reads-and-the-editor-h4-as-built)): snapshot rows, the
   editor through file verbs; Realtime snapshots, result GC and live file reload on 2026-11-03.
5. **H5 one host program** (built 2026-11-02, [as built](#one-host-program-h5-as-built)), with **H5a one publish path**
   ([Devices and records](#devices-and-records)); leases built 2026-11-03 (PR #76).
6. **H6 the WebRTC line for everything live** (built). H6a, video on an RTP track (2026-11-02,
   [weft-worker.md](weft-worker.md#the-fast-path)); the session line with `host`, `events` and the terminal, TURN and
   the simulator as a track (2026-11-02, [as built](#the-session-line-h6-as-built)); streaming deltas, the signed mDNS
   LAN path, offers sealed by weft.zip itself and TURN on weft.zip (2026-11-03). Open: the phone opening lines, and the
   by-hand LAN and TURN runs. The line's cost and speed work is in [Cost and speed](#cost-and-speed).
7. **H7 passkey approvals** (built; [mobile-security.md](mobile-security.md#4-passkey-approvals-h7)). Passkeys live on
   their own origin, **sign.weft.zip**, which serves only the pairing and approve pages under a strict CSP; the Mac
   rebuilds the message from its own names and main checks it. The desktop signs too
   ([mobile-security.md](mobile-security.md#the-desktop-signs-too)), and a worker pins the pairing Mac's key (H10).
   The board's Allow asking for that signature on a worker card is built and landing (PR #80); a local card's Allow and
   the phone on a worker are open.
8. **H8 secrets on a Worker** (built). The per-use seal (2026-11-02,
   [as built](#secrets-on-a-worker-h8-the-per-use-seal-as-built)), T2's list, blanks, `set_value`, `push_to_vercel` and a
   dev server's env (2026-11-02, [as built](#the-vault-on-a-worker-t2-as-built)), and values kept on a worker (2026-11-03,
   PR #88, [secrets.md](secrets.md#kept-on-a-worker)), and Goose's key per turn from the Mac (PR #93). Lending gog and gh is
   not planned.
9. **H9 `@weft/client`** for the phone (two passes built). The first (2026-11-02): `packages/weft-client`, plain
   TypeScript (no DOM, React, Next or Node; its own tsconfig and an ESLint rule check that), with the thread-item types,
   the host verb names and arg shapes, the `host` command's builder and readers, the BOARD STATUS parser, `paneFor`,
   `showMinis` and the signed-approval message. The second (2026-11-03, PR #84): paging, grouping, the cloud commands,
   the pending ask, thread find and the transport's shape. The transports and hooks stay in `lib/`.
10. **H10 one device registry** and one pairing flow (built 2026-11-02, [device-registry.md](device-registry.md)):
    `public.device_registry`, `device_revoke` for every kind, Settings → Devices, and Add a worker as a pairing
    (`worker_pair_*`); `worker_enrol` stays for tokens. Follow-ups built 2026-11-03 (PR #85): asks to the pairing Mac,
    cross-Mac revocation, passkey heads. Open: the phone approving on a worker, the passkey re-pair at weft.zip.
11. **Signed widening** (built 2026-11-02, [as built](#signed-widening-as-built)): a new folder, agent or read scope,
    skipping prompts, a "!" line, the terminal over the line and a new thread with an agent run on a remote host with a
    fresh approval for exactly that change, from the desktop's Touch ID key or a passkey; YOLO in a worker card's mode
    picker since PR #74. Open: the phone building the message.
12. **Dropped (2026-11-03):** daemon and cards as separate OS users / processes. Not planned; the threats it would close
    are documented in [secrets.md](secrets.md#kept-on-a-worker) (kept-on-a-worker) and the
    [Connectors](#connectors-on-a-worker-not-planned) section.


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
