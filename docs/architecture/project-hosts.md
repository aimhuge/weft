# Project hosts: one code path for local and Worker projects

Status: **design** (2026-11-01, merged with "one engine, two transports" 2026-11-02). Phase H1 is in progress; H2 (the
`host` command) is built ([below](#the-host-command-h2-as-built)). It follows on from [weft-worker.md](weft-worker.md#worker-projects-on-the-desktop-board),
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
| Model, CLI, effort on an open card | `switch-backend`, `rerun-model` | a badge only |
| Agent | PATCH `agent` | none |
| Rename, tags, star, archive, move, delete | PATCH, `CardActions` | none: the tile is `readOnly` |
| ↑ edit, Restart, Fresh | `messages`, `fresh` | none |
| "!" shell | `shell` | none |
| Wait, Me first, Others first | `permission` | none |
| Stop a subagent task | `tasks/[taskId]/stop` | none |
| Attachments in a reply | `/api/attachments` | images and PDFs travel as blobs on `reply`, `run` and `new_card` (`lib/attachment-transfer.ts`, 2026-11-02) |
| Send later, review panel, skills chip | `desktop: true` | none |
| Show rail, editor | Board's open card | none: `WorkerOpenCard` is a separate layout |
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
- **Not yet:** the board's UI for it (H3), the inbox as an attachment receiver, the web composer as a sender.

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
fork, `WebThreadPanel`/`WebPane` beside `ThreadPanel`/`BrowserPane`, plus `WorkerOpenCard`, merges into Board's own:
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
IndexedDB and can't sign. **Passkeys** close that: weft.zip and the desktop sign each approval with a WebAuthn key in the
Secure Enclave, bound to `weft.zip`, which the host pins through the existing pairing flow (the QR secret plus a Touch ID
on the Mac). The approval binds the host, card, pending request, tool, an input hash, a nonce and an expiry, and the host
checks it on one verify path for every view. The weak spot is a script injected into weft.zip, so the board gets a strict
CSP, and the riskiest asks (a vault value, skipping permissions) stay native on the phone or the Mac.

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

- **Polling, before the line exists.** The board re-reads an open worker thread's newest 50 full items every 2.5 s
  (`workerThreadPage`, `THREAD_PAGE_SIZE`) and every worker card's full row every 5 s (`workerBoard`). It asks for what's
  new instead (`seq` after the last one it has, `updated_at` after the last read), polls at 2.5 s only while a card runs,
  30 s when idle, and not while the window is hidden.
- **The route shows.** A worker's chip reads "direct · 4 ms" or "relay · 600 ms", so a fallback is visible.
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
3. **H3 `hostFor` and one open card.** `ProjectHost`, `LocalHost`, `CloudHost`; worker tiles lose `readOnly`; the open
   card merges, so worker cards get the show rail, the pickers, the menus and ↑ edit.
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
7. **H7 passkey approvals.** One signed-approval path for weft.zip, the desktop and the phone.
8. **H8 secrets on a Worker.** The per-use seal first, then the vault in the host behind H7.
9. **H9 `@weft/client`** for the phone: the transports, verbs and view models as one package.
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
