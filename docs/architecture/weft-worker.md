# Weft Worker

Status: designed, not built (2026-10-28). The design of the **Weft Worker**: a headless agent runner that sits on a
host — a Linux VPS, a home server, a spare machine — and does the actual compute for a card, while the board stays on
your laptop or on the web at `weft.zip/<workspace>/board`. This is the ROADMAP's "Remote workers"
(docs/ROADMAP.md), now P2. Nothing here is implemented yet; what follows is the design, the parts of the code it
leans on, and the parts it has to add.

The one-sentence version: **Weft already has a remote control plane, but not a remote compute plane.** The web
board already commands a Mac across the network through `cloud_commands`; the CLI, though, always spawns on the
board's own machine. A worker is a second implementation of the executor behind that same command bus. The board,
the thread rendering, the reply box, the guards' vocabulary and the web transport all stay as they are.

## The decisions this design is built on

These were settled before the design was written, and each one narrows what follows.

| Decision | What it settles |
| --- | --- |
| The name is **Weft Worker** | Not "runner" — a runner is what it does, a worker is what it is. |
| The guards are **centralised in Supabase** | The claim, overlap and folder-grant authority moves into the database, so a Mac and a worker can share a repo. See [The guards move](#the-guards-move). |
| Workers are **priced**, one included on Pro | A plan allowance, not a meter: a worker is a thing you have, not usage you spend. $20 per worker per month, Pro includes one. See [What it costs](#what-it-costs). |
| The repo is a **persistent checkout per project**, cards work in worktrees of it | Exactly what the Mac does. No clone-per-card, no credentials churn. |
| The host **authenticates with a service key** | A per-worker key, not a human session. See [Identity](#identity). |
| **All four backends**, on the worker's own toolchain | Claude Code, puku-cli, Codex and Goose all work on a worker, and each uses the version the project pins. |
| **No container image** | The install is a bootstrap script on any Linux or macOS box. See [Installing on a box you already have](#installing-on-a-box-you-already-have). |
| **A worker runs on macOS too**, not just Linux | The daemon is platform-neutral; the install script branches on the platform. A Mac mini is a first-class worker. |

## What the code already gives us

Five findings decided the shape of this design. Each was read in the source, not assumed.

**The command plane is already host-agnostic.** `lib/cloud-commands.ts` is a kind/payload/status envelope
(`new_card`, `reply`, `answer`, `stop`), addressed to a `target_device` and a `folder`, claimed with a conditional
update so a command cannot run twice (`lib/cloud-inbox.ts:151`). The browser inserts a row and does not know or
care what a Mac is. A host id fits `target_device` unchanged, and the four existing kinds already mean "act on
this card" — a host can honour all of them.

**The turn translator already speaks the wire protocol.** `lib/runner-turn.ts:36` is
`handle(id, session, msg: SDKMessage)`, and it accepts *synthetic* messages: the Codex runner
(`lib/codex-runner.ts:55`) and the Goose runner (`lib/goose-runner.ts:50`) both fabricate SDK messages from their
own CLIs' event streams. A worker that speaks the same protocol on the wire reuses the **entire** board-side
rendering layer unchanged — a remote turn's items are byte-identical to a local turn's, because the same
translator produced them.

**The run descriptor already exists.** `Spec` (`lib/runner-state.ts:72-102`) is a complete, JSON-serializable
description of a CLI run: cwd, backend, permission mode, model, effort, session id, read scope, skills off,
copilot, persona, agent, provider. It is almost exactly the payload a host should accept, so no new "run
descriptor" type is needed.

**The overlap "guard" is not a guard.** `lib/overlap.ts` never blocks — it renders the board's "Also running here:…"
line from `Card.touchedFiles`. The guard that actually blocks is the **claim** guard (`lib/claim-guard.ts`), and it
asks rather than denies. This matters for the centralisation: only the claim authority has to become shared state
to preserve today's behaviour; the overlap line can be derived from claims.

**The guards split cleanly into local and shared.** Read through the source, the guard set divides in two:

- *Local by nature* — the secret guard (reads local `.env`), the git guard (reads local git), the route-import
  and import guards (read local files), the check guard (local script serialisation), the restart guard (counts
  local busy sessions), and the symbol parser `lib/symbols.ts` (parses the local file). None of these can move: the
  files they read are on the host that runs the card.
- *Shared by nature* — the **claim** guard (`lib/claim-guard.ts`, `lib/claim-hooks.ts`, `lib/claims.ts`), the
  **yield** mechanism ("me first", `lib/precedence.ts`, `lib/yields.ts`), the **folder grant** list
  (`Card.readScope`, `settings.allowedFolders`), and the **pending permission** (`lib/runner-ask.ts`). Each of
  these answers a question about *another card*, which is exactly the question two machines cannot answer
  locally.

## The shape

```
┌─ board (laptop) or weft.zip/<workspace>/board ────────────────────────┐
│   desktop: ThreadTransport = localTransport  (localhost, x-weft-token)│
│   web:     ThreadTransport = useCloudTransport (INSERT cloud_commands) │
└──────────────────────────────┬────────────────────────────────────────┘
                               │ Supabase Realtime + 30 s poll
┌──────────────────────────────▼────────────────────────────────────────┐
│  Mac (Weft desktop) — lib/cloud-inbox.ts: claim → run → report        │
│  Worker (weft-worker) — lib/worker-daemon.ts: claim → run → publish   │
│      new_card → lib/card-starter.ts                                   │
│      run      → lib/runner.ts (the same engine, headless)             │
│      reply    → lib/runner.ts sendUserMessage                         │
│      answer   → lib/runner-pending.ts answerPermission                │
│      stop     → lib/runner.ts stop                                    │
└──────────────────────────────┬────────────────────────────────────────┘
                               │ cloud_cards / cloud_thread_items / cloud_tool_outputs
                        ┌──────┴──────┐
                        │  Supabase   │ → the web board reads it live
                        └─────────────┘
```

The Mac is not special. It is one implementation of "claim a command, run a turn, publish the items". A worker is a
second implementation with a different filesystem. Every layer above the executor — thread rendering, the reply
box, permission prompts, the web board, the share view — is unaffected.

## The three new pieces

**A worker registry.** A `cloud_workers` table: id, org, name, platform, arch, labels, capabilities, status,
`last_seen_at`. A worker enrols itself and heartbeats. This is what turns the web's "Waiting for your Mac" into a
real liveness signal: a sleeping Mac's presence is unknowable, a worker's is not. `public.devices`
(`supabase/migrations/20261027163113_team_vault.sql:116`) is close in shape — it already has a platform (and already
allows `'linux'`) and `last_seen_at` — but it is scoped to vault keys and has no `org_id`, so a separate table is the
cleaner fit. The `platform` check constraint is the existing one: `('darwin', 'linux', 'win32')`.

**The worker daemon.** `weft worker`: headless Weft, no Electron. It enrols, claims the commands addressed to it,
materialises the repo, spawns the CLI, and publishes the turn back as thread items. It is the same `lib/runner.ts`
engine, running without the shell around it. `WEFT_DATA` (`lib/store.ts`) is the existing override for where the
store lives, so a worker can keep its own `~/.weft` equivalent.

**Worker addressing.** A card's host becomes explicit. Today a card belongs to a device implicitly, through
`cloud_cards.owner_device`. It becomes a worker id, and the card's `cwd` becomes a repo identity plus a host path.
`cloud_sync_repos` (`supabase/migrations/20261026145209_cloud_sync_repos.sql`) is the existing precedent for a
portable repo identity that follows a project to another machine.

## The command protocol

Minimally, and in a way that keeps the web board working against a plain Mac unchanged:

```
-- cloud_commands (widened)
   target_device  →  target_worker       -- a worker id, or a device id for a Mac
   kind           →  + 'run'            -- run this spec on the target worker

-- new: cloud_workers
   id uuid pk, org_id, name, platform, labels jsonb,
   capabilities jsonb, status, last_seen_at, created_at

-- new: cloud_worker_leases
   command_id pk, worker_id, expires_at, renewed_at
```

The `run` kind carries a `Spec`-shaped payload (backend, model, repo and path, permission mode, skills, agent,
read scope) plus the project identity. `reply`, `answer` and `stop` are reused verbatim.

The worker writes to the same tables the Mac writes to: `cloud_thread_items` for the thread, `cloud_tool_outputs`
for cut tool results, `cloud_cards` for card state. Because `handle()` is the shared translator, the items are the
same ones a local turn produces.

## The guards move

This is the biggest single piece of work, and the decision was explicit: the guard authority is **centralised in
Supabase**. The alternative — a worker running a reduced local set — is faster but leaves a Mac and a worker able
to edit the same file at the same time, which is the one thing Weft's safety model exists to prevent.

### What has to change in the data

Today a claim key is an **absolute real path** plus a symbol:

```ts
// lib/claim-keys.ts:9
export function claimKey(file: string, symbol: string = WHOLE_FILE) {
  return `${file.replace(/%/g, "%25").replace(/#/g, "%23")}#${symbol}`;
}
```

`/Users/fotoflo/dev/weft/lib/claims.ts#findClash` and `/srv/work/weft/lib/claims.ts#findClash` are the same file and
two different strings. **A claim key cannot cross a machine until it is re-anchored to the repo.** So a claim
becomes `(repo, path relative to the repo, symbol)`:

```sql
create table public.cloud_claims (
  org_id     uuid not null references public.orgs (id) on delete cascade,
  repo       text not null,             -- the portable project identity
  file       text not null,             -- repo-RELATIVE, not absolute
  symbol     text not null,             -- '*' for whole-file; '/'-joined nested path
  card_id    text not null,
  worker_id  uuid references public.cloud_workers (id) on delete cascade,
  granted_at timestamptz not null default now(),
  primary key (org_id, repo, file, symbol, card_id)
);

create table public.cloud_yields (
  org_id     uuid not null references public.orgs (id) on delete cascade,
  card_id    text not null,
  to_card_id text not null,
  file       text not null,             -- repo-relative
  primary key (org_id, card_id, to_card_id, file)
);
```

The clash predicate is unchanged in meaning — same file, and same symbol, or either is `*`, or one symbol path
prefixes the other (`lib/claims.ts:24-29`) — but it becomes a SQL predicate. The prefix test is the fiddly part:
`'Board'` must prefix-match `'Board/moveFocus'` but not `'Boarding'`, so it needs
`left(a.symbol, length(b.symbol) + 1) = b.symbol || '/'`, not `LIKE 'Board%'`.

### The race the local version has

Today's sequence is check → ask → edit → record:

- `claimPreHook` computes the keys the call *would* claim and checks them (`lib/claim-guard.ts:75-100`).
- The user may be asked; the edit runs; `claimRecorder` then records the keys in `PostToolUse`
  (`lib/claim-hooks.ts:15-20`).

Between the check and the record, another card can pass the same check. Two cards can both be told they own
`lib/claims.ts`. **Centralising in Postgres closes this**, because the check and the reservation can be one
statement — insert the claim with a unique index and let the conflict be the answer:

```sql
create unique index cloud_claims_reservation
  on public.cloud_claims (org_id, repo, file, symbol);
```

The RPC takes the keys, and returns the same `Verdict` shape the local guard produces, so `lib/guards/ask.ts` does
not change:

```ts
// lib/guards/decide.ts:29
export type Verdict =
  | { decision: "allow"; context?: string; feedback?: string }
  | { decision: "deny"; reason: string }
  | { decision: "ask"; reason: string };
```

One RPC, one shape, one code path for the local Mac and the remote worker. The Mac's guard calls it; the worker's
guard calls it. Neither knows which is which.

### The shape of the split

```
PreToolUse hook
  ├─ local guards (secret, git, import, check, restart)  → run on the host
  ├─ local symbol parse (lib/symbols.ts)                  → run on the host
  └─ shared guards (claim, yield, folder grant)           → RPC to Supabase
        ↓
      Verdict { allow | deny | ask }
        ↓
  deny → the reason goes back to the model, the turn continues
  ask  → a row the board can answer; the card moves to Needs you
```

The **folder guard** splits too. Its logic (`lib/folder-guard.ts:117-131`) is entirely local — it compares a path
against the card's scope on the machine that holds the file. But the *grant list* (`Card.readScope`, and
`settings.allowedFolders`) is shared state, because a grant given on the Mac must hold on the worker. So the
grant is stored per worker path, and the local check stays local.

## Identity

A worker is not a person. Today every write path assumes a signed-in human:

- `cloud_commands.created_by` is `uuid not null default auth.uid() references auth.users (id)`.
- `cloud_cards.owner_user` is `uuid not null default auth.uid() references auth.users (id)`.
- `private.owns_device(device)` answers "is this device yours?" **by proxy** — a device is owned iff the caller has
  at least one `cloud_cards` row for it (`20261018130000_cloud_commands_device_ownership.sql:19-30`). A worker has
  no cards of its own, so it owns nothing.
- `private.is_card_owner(org, card)` is the same shape, and it guards every write to `cloud_thread_items` and
  `cloud_tool_outputs`.
- `vault_grants.granted_by` is `not null references auth.users (id)`.

**The decision: a service key.** Each worker gets a long random secret, shown once at creation and stored on the
worker in `~/.weft-worker/worker.json` with mode `600`. The app shows only the first and last four characters, and
"Rotate" issues a new one.

The key is presented as a bearer token. The question is how the database recognises it, because **RLS policies can
read `auth.uid()` and the row's own columns, but not an HTTP header**. Three shapes, and the one chosen:

| Shape | How it works | Verdict |
| --- | --- | --- |
| (a) A dedicated Postgres role | A `weft_worker` role with `LOGIN`, carrying the worker id in a session setting; policies read it. | Chosen. RLS keeps doing the work, and the identity is auditable per worker. |
| (b) The service role | The worker holds the org's secret key; RLS is bypassed and authorisation moves into application code. | Rejected: it hands every worker the whole org's data and loses the policy layer that the centralised guards depend on. |
| (c) A human-shaped session | A dedicated `authenticated` user per worker. | Rejected: `auth.uid()`-based helpers then "work", but every card is owned by a fake human and the audit trail lies. |

With (a), the two `not null references auth.users (id)` columns need to change. The cleanest shape is to make the
actor nullable and add a sibling worker id:

```sql
alter table public.cloud_commands
  alter column created_by drop not null,
  add column created_worker uuid references public.cloud_workers (id) on delete cascade;

alter table public.cloud_cards
  alter column owner_user drop not null,
  add column owner_worker uuid references public.cloud_workers (id) on delete cascade;
```

and a `private.owns_worker(worker uuid)` helper in the same shape as `private.owns_device`, so the insert policy
becomes `private.owns_device(target_device) OR private.owns_worker(target_worker)`.

The worker key itself never sits in a column. It is a hash: `cloud_workers.key_hash` holds `sha256(key)`, and a
`security definer` function verifies it and returns the worker id. The raw key exists only on the worker.

## The repo on the worker

**The decision: a persistent checkout per project, cards work in worktrees of it.** Exactly what the Mac does, and
it is the right answer for three reasons: the project's own toolchain is already installed there once; a worktree
of it is instant; and the worker's `node_modules` is the one the project actually pins.

- **The checkout** lives at `~/work/<repo-name>` on the worker, cloned once and `git pull`ed when it is stale. The
  credentials are the worker's own — a deploy key or a token the user adds on the box, not the user's laptop keys.
- **The worktree** is per card, in the worker's own pool under `~/.weft-worker/worktrees/`. `lib/worktree-deps.ts`
  clones `node_modules` with `cp -c`, which is an **APFS clone** and does not exist on Linux
  (`lib/worktree-deps.ts:36`). The worker picks per platform: `cp -c` on macOS, `cp --reflink=auto -a` on Linux
  where the volume supports it, and a plain copy or a fresh install from the lockfile where it does not.
- **The path translation** is the piece that makes claims work. The card's `cwd` is a repo-relative path; the
  worker resolves it against its own checkout root. The Mac and the worker then agree on "the same file" because
  they agree on the repo and the relative path.

`lib/worker-paths.ts` is where this belongs: one function, `repoPath(repo, relative)`, used by the claim guard, the
folder guard, the runner's cwd, and the overlap check.

## Installing on a box you already have

**The decision: no container image.** An image would pin the toolchain, and the card's CLI has to match the repo's
version — each of the four backends installs its own way, and a project pins them in `devDependencies`. A worker
that runs the *project's own* toolchain is what makes "all four backends work" true. So the box installs the CLIs
the project asks for, and the worker runs them.

The install is a bootstrap script, fetched over HTTPS and run with `sh`:

```sh
curl -fsSL https://weft.zip/worker.sh | sh
```

It does four things:

1. **Installs the toolchain.** Checks for `git`, `curl` and `node` 20+, and installs what is missing — with
   `apt-get` on Linux, with `brew` on macOS. A compiler toolchain is added only if the project needs one.
2. **Clones the worker.** Pulls Weft's worker into `~/.weft-worker`. A `git pull` updates it later;
   `weft-worker update` does that for you.
3. **Enrols itself.** Calls the API with the workspace's service key, gets back a worker id and its own key, and
   writes both to `~/.weft-worker/worker.json` with mode `600`.
4. **Runs as a service.** A `systemd` unit on Linux, a `launchd` agent on macOS. It starts on boot, restarts on
   crash, and heartbeats every 20 seconds.

Two things this design has to be honest about. First, the script runs code as the user who ran it — it is
`curl | sh`, and the same caution applies as to any installer. Second, it needs the workspace's service key to
enrol, so the flow is: the app generates a **one-time enrolment token** (short-lived, single use), the script
exchanges it for the worker's own key, and the app shows the token to paste on the box. The workspace's long-lived
key never leaves the app.

The script is also where a "cloned sub-repo" would fit if Weft ever splits the worker out of the main repo: the
clone URL is one line in the script, so the shape survives that move.

### macOS and Linux, side by side

**A worker runs on macOS too.** The daemon is the same Node process on both; only the install and the worktree
mechanics differ. A Mac mini is a perfectly good worker — it is idle most of the time, it is on a fast disk, and
it is already trusted with the user's credentials.

| | Linux | macOS |
| --- | --- | --- |
| Package manager | `apt-get` (Debian, Ubuntu, and the VPS images built on them) | Homebrew (`brew install node git`) |
| Service manager | `systemd` unit, `systemctl enable --now` | `launchd` agent under `~/Library/LaunchAgents/`, `launchctl bootstrap` |
| Toolchain install | `apt-get install -y` | `brew install` |
| `node_modules` copy | `cp --reflink=auto -a` where the volume supports it, plain copy otherwise | `cp -c` — the APFS clone, already in `lib/worktree-deps.ts:36` |
| Firewall / ports | `ufw` or the VPS provider's rules | macOS asks once, per binary, on first listen |
| Secrets | the worker's own `.env` and git credentials | the same, plus the macOS Keychain where the CLI wants it |

**The one place macOS is genuinely better is the worktree pool.** `lib/worktree-deps.ts` clones `node_modules`
with `cp -c`, an APFS copy-on-write clone: 1.5 GB costs no disk and takes ~13 s. Linux has no equivalent, so the
worker falls back to `cp --reflink=auto` (reflink, on btrfs/XFS) or a plain copy, or a fresh install from the
lockfile. **So a macOS worker takes a warm worktree in ~20 ms and a Linux worker takes ~15 s.** That is not a
reason to prefer one — it is a reason the worker should keep a pool on both, and it is the same pool the desktop
already keeps (`lib/worktree-pool.ts`).

**Apple Silicon is not a special case, and there is one thing to watch.** The four backends ship arm64 macOS
binaries, so an M1 or M2 runs them natively; the worker itself is a Node process and is architecture-agnostic. The
watch item is **Rosetta**: a repo whose native dependencies are x86-only (`node_modules` with a prebuilt
x64 binary) will not install on arm64 without Rosetta 2. The worker should detect the mismatch at install time —
`process.arch` of the worker against the lockfile's platform markers — and say so plainly rather than failing with
a linker error 3,000 lines deep. If Rosetta is present, the worker can run the CLI under it and say which mode it
is in, so a card's output explains itself.

**A Mac mini worker also has one advantage nobody designs for: the guards' local half is already good.** The
secret guard reads a local `.env`, the git guard reads local git, the import guard reads local files — all of
that is the same code the desktop runs. A macOS worker is the *least* surprising worker, because it is the desktop
minus the window.

**And one thing to be careful about:** a macOS worker is a Mac. The desktop app and a worker on the same machine
must not fight over the same store, the same `~/.weft` directory or the same git credentials. The worker uses its
own `WEFT_DATA` (`lib/store.ts`), its own `~/.weft-worker`, and its own checkout root — the same separation the
desktop already uses for its own worktrees.

## The hard parts

A worker is not "the Mac, but headless". These are the places it differs, pulled from the code rather than
imagined.

1. **Identity.** Covered above — the service key, the role, and the two `auth.users` columns.
2. **Paths.** A card's `cwd` and a command's `folder` are Mac paths (`lib/cloud-sync-cards.ts:25`). Cards address a
   repo identity and a host-relative path; the worker translates to its own absolute path.
3. **Repo materialisation.** The persistent checkout and the worktree pool, above.
4. **Guards.** The centralised claim and folder-grant authority, above. The biggest piece of work.
5. **Cross-card claims.** `lib/claims.ts` coordinates symbol ownership between cards. Claims become rows in
   Supabase, so a Mac and a worker respect each other.
6. **Weft's own MCP tools.** The CLI calls back into the board's local server for `mcp__browser__*`,
   `mcp__board__*`, the secrets and the dev servers (`lib/runner-session.ts:218`); the Codex path already bridges
   them over `http://127.0.0.1:${PORT}` (`lib/codex-runner.ts:239-243`). A worker needs its own MCP endpoint, plus a
   tunnel for anything board-local. The webhooks relay (`mcp__webhooks__relay`) is the existing NAT-traversal
   precedent in the repo.
7. **Pending permissions.** An ask resolves an in-process `Promise` (`lib/runner-ask.ts`). It has to become state:
   the worker publishes the pending, the board answers with the existing `answer` command, the worker resolves.
8. **Leases.** A crashed worker leaves rows `claimed` forever (`lib/cloud-inbox.ts:151`) — that is true of the Mac
   today too, but on a Mac a human sees the board and clicks Cancel. On a headless box nobody does.
   `cloud_worker_leases` with an expiry, renewed on heartbeat, makes them reclaimable.
9. **Worktrees.** `cp -c` is an APFS clone; it does not exist on Linux. A macOS worker gets the fast path the
   desktop already has; a Linux worker needs `cp --reflink=auto` or a plain copy. Isolated cards need a worktree
   implementation that picks per platform.
10. **Secrets.** The 🔐 vault is device-keyed and Touch-ID gated on the Mac (`electron/vault.cjs`). The team
    vault (`public.devices` + `vault_grants`) is the model for a worker: another enrolled machine with its own
    sealed key.
11. **Deltas.** Streaming text is local-only today (`lib/runner-turn.ts:50`); the web gets items at turn end. A
    pre-existing gap, but a worker makes it obvious, because remote turns are long.
12. **File previews.** Diffs are read from local disk (`lib/runner-turn.ts:186`). The worker computes the preview and
    ships it, or the file comes over the blob store.

## How the board picks a worker

A card's host is one field. Today a card belongs to a device implicitly; a worker-aware version makes it explicit
without adding board chrome — SOUL.md is firm about screen space on a 13" Air.

- **Per-project default.** The project menu records which worker runs its cards, on the line where the folder
  already is. No new board chrome.
- **Per-card override.** Editable from the card's existing menu. The card's header shows a small worker chip, like
  today's `cli · model` chip, so you know where it is running.
- **Fallback.** If the chosen worker is offline, the card says so and offers the others. It never silently runs
  somewhere else.

On the web board, "New thread" already inserts a `new_card` command addressed to a device. The same dialog gains a
worker picker, and the command is addressed to a worker. The web's "Waiting for your Mac" copy becomes
worker-aware, and with a heartbeat it can say "worker offline" instead of waiting forever.

## Where it sits on the board

`ThreadTransport` has the right shape for a third implementation, and the web board already has the `variant`
seam that hides what a given host can do (docs/architecture/cloud-sync.md).

| Board | Transport | Who runs the CLI |
| --- | --- | --- |
| Desktop, local | `localTransport` | The Mac itself |
| Desktop, remote card | `localTransport` + a `targetWorker` on the card | A worker |
| Web (`/<workspace>/board`) | `useCloudTransport` | A Mac *or* a worker |
| The worker's own board | a new `workerTransport` | Itself, locally |

One consequence worth stating plainly: a worker-hosted board is *easier* than a remote Mac, because the web board
never needs to reach the worker's filesystem. Only the command protocol crosses the network.

## What it costs

A worker is a **thing that exists**, not usage you spend. Weft's usage ledger (`org_usage_charges`, with its
`puku_tokens` meter) counts consumption, and its doctrine is explicit: the balance is derived, not counted, and a
counter drifts from the rows that justify it. A worker is not a counter — it is a row in a table. So the worker
count is a **plan allowance**, sitting next to seats, exactly the way `canHaveMembers` works today
(`lib/billing/plan-gate.ts:46`).

**The decision: $20 per worker per month. Pro includes one worker; every worker after that is $20/month.**

The price is **per worker, per month** — it does not change with how much the worker runs, how many cards it takes,
or how long they take. A worker is a seat for a machine, and a seat costs the same whether it is busy or idle.

| Plan | Workers | Price |
| --- | --- | --- |
| Free | 0 | $0 |
| Open Source / Education | 0 | $0 |
| Pro | **1 included** | $20/mo |
| Team | **1 included**, per workspace | $9/seat/mo |
| Every additional worker | each | **$20/mo** |

So a Pro workspace with three workers pays $20 + $20 + $20 = **$60/month**. Team adds the per-seat price on top of
the same worker allowance.

The shape in code follows the package's own rule — *gate on a capability or a limit, never on a plan id*
(`node_modules/@aimhuge/billing/dist/catalog.d.ts:16-17`). The plan gains a number, not a new plan id:

```ts
// lib/billing/plans.ts — a worker allowance, alongside blastcp
export interface Plan extends BasePlan<PlanId> {
  blurb: string;
  blastcp: BlastcpTier;
  /** Workers this plan includes. 0 on free; 1 on pro and team. */
  workers: number;
}
```

The workers themselves are rows, in a new `org_workers` table, and the plan's number is the cap. A DB-enforced
version follows the mini-app quota precedent (`private.org_plan()` plus a trigger, from
`20261024124411_app_share_quota.sql`), so the cap holds even against a client that tries to add a fourth worker.

**What the $20 buys, and what it does not.** The worker runs on the *user's* box: the VPS bill, the tokens the CLI
burns and the compute are theirs. What Weft charges for is the worker slot and the hosted pieces that make it
useful — the web board, the centralised guards and claims, the hosted command plane, the share view. There is no
per-minute metering, because there is no compute of ours to meter.

**The rollout trap.** `STRIPE_PRICE_*` env vars are derived from `catalog.paid`
(`lib/billing/stripe-env.ts:18-20`), and the package refuses every checkout if any required price is missing. Extra
workers are not a new plan tier, so they do not add a price env var — but if the "extra worker" line is ever
modelled as its own Stripe product rather than a quantity on the Pro subscription, that changes: a second
subscription per org is forbidden by `org_subscriptions`' primary key on `org_id`, so it would need a new table, a
new webhook path and a change to `@aimhuge/billing`. **The quantity-on-the-subscription shape avoids all of that.**

## The phases

Each is independently shippable and independently useful. The first two already deliver what people actually ask
for — "run this card on my server".

1. **The daemon, single worker, no board.** `weft worker` starts, enrols, claims `run` commands, spawns the CLI,
   publishes items. The board stays on the laptop; the worker is a black box with one job. This phase also ships
   the bootstrap script (Linux **and** macOS), the service-key enrolment, and the `launchd`/`systemd` service.
2. **Addressing and liveness.** `cloud_workers`, heartbeats, the worker picker, the worker chip, "worker offline",
   leases and reclaim.
3. **Guards and claims go shared.** The centralised claim, yield and folder-grant authority in Supabase, keyed by
   repo-relative paths, so a Mac and a worker can safely share a checkout. The races the local version has get
   closed here.
4. **Host-side MCP and secrets.** The worker serves its own board tools and draws from the team vault.
5. **The worker's own board.** `workerTransport`; the worker serves a board to any browser. This is where
   "Headless server mode" (docs/ROADMAP.md) and "Remote workers" converge: a headless Weft *is* a worker plus a
   board.

## Files

New: `lib/worker-daemon.ts` (the daemon), `lib/worker-registry.ts` (enrolment, heartbeat), `lib/worker-transport.ts`,
`lib/worker-paths.ts` (path translation, repo materialisation), `lib/shared-claims.ts` (the shared claim authority and
its RPC), `install/worker.sh` (the Linux and macOS bootstrap), and migrations for `cloud_workers` +
`cloud_worker_leases` + `cloud_claims` + `cloud_yields`.

Touched: `lib/cloud-commands.ts` (the `run` kind), `lib/cloud-inbox.ts` (share the claim and lease logic),
`lib/cloud-sync-cards.ts` (worker identity), `lib/runner-state.ts` (`Spec` gains a worker target),
`lib/worktree-deps.ts` (a Linux worktree), `lib/claim-guard.ts` and `lib/claims.ts` (the shared authority),
`lib/billing/plans.ts` (the worker allowance), and the `auth.users` FK changes on `cloud_commands` and
`cloud_cards`.

Docs: this file, its entry in docs/architecture/MAP.md, README.md, and the ROADMAP line.
