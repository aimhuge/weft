# Project hosts: one code path for local and Worker projects

Status: **design** (2026-11-01). Nothing here is built. It follows on from [weft-worker.md](weft-worker.md#worker-projects-on-the-desktop-board),
where a Worker project shows on the desktop board but most of what a local project gets drops out.

## The problem

A project on a Weft Worker is a path, `worker://<worker id>/<folder>`. `localPath` (`lib/worker-project.ts`) turns it
into `null`, and `components/Board.tsx` feeds that to everything that touches a folder, so on a Worker project the
header badges, the terminal, the drawers and the copilot all drop out, and its cards draw `readOnly`. Each of those
features reads the Mac directly: a route under `app/api/*` calls `lib/*` on a path on this disk, or Electron main.
There are two code paths, and every new feature lands on the local one only.

The goal: **full parity**, and ideally **the local project is a worker too**, so the board has one way to reach any
project.

<!-- GAP-TABLE -->

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

<!-- PHASES -->

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
