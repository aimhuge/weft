# Weft Worker

Status: **phase 1 built** (2026-10-29), the rest designed. The **Weft Worker** is a headless agent runner that sits on a
host (a Linux VPS, a home server, a spare machine) and does the actual compute for a card, while the board stays on
your laptop or on the web at `weft.zip/<workspace>/board`. This is the ROADMAP's "Remote workers"
(docs/ROADMAP.md), now P2. [Phase 1, as built](#phase-1-as-built) says what runs today and where it departs from
the design. The rest of the page is the design, the parts of the code it leans on, and the parts it has to add.

## Phase 1, as built

One worker per box, no worker picker on the board. The first box is a Mac mini (`m1mini`), enrolled as
`worker:082722c6…`.

- **The engine is the desktop's, unchanged.** `scripts/weft-worker.ts start` loads `lib/card-starter.ts`,
  `lib/runner.ts` and `lib/store.ts` in plain Node through jiti, with `WEFT_DATA=~/.weft-worker/data`. A run is a real
  card in the worker's own store, driven by the same session, turn translator and guards as on a Mac. The secrets and
  webhook MCP tools throw per call there ("only exists in the desktop app"); that's phase 4. Of the browser tools,
  `open_url` works: see [Pages from a worker](#pages-from-a-worker).
  `lib/store.ts` is imported first and on its own, because the engine's modules import each other in a circle.
- **Identity: key-checked functions, not a Postgres role.** RLS can't read a header, and PostgREST won't log in as a
  custom role with a bearer that isn't a JWT. So the worker calls `worker_*` security-definer functions
  (`supabase/migrations/20261029125616_weft_workers.sql`) with the publishable key, and passes its own `wwk_…` key as
  the first argument. Each function looks up `sha256(key)` in `cloud_workers.key_hash` first. RLS still guards every
  human path. The worker's identity reaches the `card_id` trigger through the `weft.worker_id` transaction setting.
- **Each worker acts for the account that enrolled it.** It obeys only commands that account created
  (`created_by = owner_user`), and its `cloud_cards` rows carry that account as `owner_user` plus itself as
  `owner_worker`. A worker's device id is `worker:<id>`, and `private.owns_device` now accepts a worker you
  enrolled. So the web board's reply, answer and stop commands reach a worker's card unchanged.
- **Enrolment:** `worker_enrol_token(org)` (a signed-in member, valid for an hour, once) → `worker_enrol(token, …)`
  returns the worker id and its key, written to `~/.weft-worker/worker.json` at mode 600.
- **Commands:** `run` (`lib/worker-commands.ts`: a prompt, an optional git URL, a mode from default / acceptEdits /
  auto / plan, never bypass), `mode` and `input` ([The live screen](#the-live-screen)), `clone` and the two sign-ins, `login` and `github_login`, the web's `new_card`, `reply`,
  `answer` and `stop` (`lib/worker-daemon.ts`), and `host`: any verb of `lib/host-api` on a card it runs, `{ verb, args }`,
  with `{ ok, cardId }` or `{ ok: false, error }` written to `cloud_commands.result` through `worker_report`'s `p_result`
  ([project-hosts.md](project-hosts.md#transports)). `reply`, `answer`, `stop` and `mode` run as `card.message`,
  `card.permission.answer`, `card.stop` and `card.update` (`lib/worker-card-commands.ts`, the `Engine`'s one `host`
  method, bound to `runVerb` in `scripts/weft-worker.ts`); the folder grant, `CARD_MODES` and the signed-Allow rule
(`lib/worker-approve.ts`, which a host `card.permission.answer` goes through too) stay checks there. It hears a
  [wake-up](#wake-ups) and reads `worker_pending` at once, with a poll as the backstop, because without a session
  Realtime's row filters show it nothing. It claims with `worker_claim`, which only matches a pending row, and says it's
  up through [Realtime Presence](#liveness), writing its row every 5 minutes.
- **Publishing:** `lib/worker-publish.ts` hears the engine's bus and ships cards and items through `worker_put_card`
  and `worker_put_items`. The rows are the Mac's projection (`lib/card-rows.ts`, one card schema: blobs, splitToolResult,
  redaction, scrub), with the worker's `RowHost`: no thumbs, a failed upload logged and kept as a path, the copilot never
  published (its thread events used to ship it), and one output per tool id in a batch (`worker_put_items` refused two).
  It keeps its queue in memory ([after a restart](#after-a-restart) re-sends what a dead daemon lost), and sends pages and images up as blobs first.
- **Repos:** a command's folder is a project name under the work root, `~/.weft-worker/work/<folder>`
  (`WEFT_WORKER_ROOT` overrides it), not `~/work`: a Mac often has a `~/work` of its own. A missing folder is cloned
  from the run's git URL (https or ssh only). An existing one is used as it is, never pulled. Cards run in the
  checkout itself; worktrees come later.
- **Install:** `install/worker.sh` (served as `weft.zip/worker.sh`, a redirect to the file on main). It checks the
  toolchain, clones Weft into `~/.weft-worker/weft`, enrols, writes the `weft-worker` wrapper into `~/.local/bin`, and
  runs it as the launchd agent `zip.weft.worker` or the systemd user unit `weft-worker`.
- <a id="signing-claude-in"></a>**Signing Claude in:** a background service can't answer the keychain prompt a desktop Claude
  login raises, so the worker runs on a long-lived `claude setup-token` token kept in `~/.weft-worker/worker.env`
  (mode 600), which the wrapper loads. `lib/env.ts` passes `CLAUDE_CODE_OAUTH_TOKEN` to a CLI, except when Weft itself
  runs inside a Claude session. Two ways in: `weft-worker login` on the box, or **Sign in to Claude** on the worker's
  row in Settings → Sync → Workers (`components/WorkerSignIn.tsx`). That button is one click: Electron main runs
  `claude setup-token` on a hidden pty (`electron/claude-sign-in.cjs`) with `$BROWSER` pointed at a two-line script,
  so the CLI hands its approval URL to Weft instead of your default browser. Main opens it in a small window beside
  the click, in the browser pane's session (so claude.ai already knows you), types the code back if Claude's page
  shows one, and reads the token off the CLI's output; the board never shows it. Without the desktop shell you paste
  a token instead. Either way the token never reaches Supabase in
  the clear: on first start the worker makes an X25519 keypair (`seal-key.json`, mode 600) and publishes the public
  half with `worker_set_public_key`. The desktop seals the pasted token to it (`lib/worker-seal.ts`: X25519, then
  HKDF-SHA256, then AES-256-GCM, bound to both keys and the purpose) and queues a `login` command
  (`supabase/migrations/20261029141232_worker_login.sql`). Every member of the workspace can read `cloud_commands`,
  and none of them can open it. The worker opens it, saves it to `worker.env` and restarts itself.
- **The board side:** Settings → Sync → Workers (`components/WorkerSettings.tsx`, `/api/workers`,
  `lib/workers-account.ts`) lists the workspace's workers with their status. Add a worker shows the install line
  with a token, and Send a run queues a prompt. A worker's status comes from [presence](#liveness), then its row.

- **Run on Worker, per project:** a project chip's right-click menu ticks **Run on This Machine** or **Run on Worker**
  (`lib/project-menu.ts`, `settings.workerFolders`, kept apart from the project list since its entries are rebuilt on
  each use). In a worker project, `POST /api/cards` with `start` calls `lib/worker-handoff.ts` instead of
  `startCard`: it picks one of your workers (online, then busy, then offline), sends the card's first message as a
  `run` under the project's folder name and its GitHub remote as `https://github.com/<slug>.git`, and leaves the local
  card in Review with the prompt and a note naming the worker, marked `handedOff: { workerId, commandId }` so the game
  counts the run once, as the worker's card (gamification.md#work-on-a-worker). A failed send deletes the card rather than run it
  locally. Switching on refuses when you have no worker. The run and its replies live on the worker's card, which
  [the desktop board shows](#worker-projects-on-the-desktop-board) under the worker's project.

### Auto-updates

A worker keeps itself on the newest commit of `main`, with no one at the box (`lib/worker-update.ts`,
`lib/worker-update-loop.ts`, `install/worker-rollback.sh`). `main`, not release tags: it's what the installer clones, and a worker fix shouldn't wait
for a dmg. The cost is that **every push to main reaches every worker within seconds, unsigned, and all at once**: there's no
spread across boxes, so a bad commit meets them together and the trial below is what catches it. Push access to the
repo is code execution on every box. That's the same trust `curl | sh` and `weft-worker update` already ask for.

```
push to main, Update now, or the slow check
               git fetch origin main
                 │ newer, not skipped, clean clone on main
no live turn, no clone, no pass in flight ──▶ otherwise the row names the cards, and it tries again when they end
                 │ commands stay queued from here on
update-trial written, then merge --ff-only, pnpm install
                 │ a failed install: reset, no restart, the same commit is tried next time
weft-worker check loads the whole engine in a child
                 │ a commit that won't load: reset, added to update-bad, never tried again
exit 0 ──▶ launchd or systemd starts the new code
                 │ dies 3 times before it's healthy: the wrapper resets and adds it to update-bad
up 60 s and a heartbeat landed ──▶ update-trial deleted
```

- **CI loads the engine first:** `pnpm run check:worker-engine` (`scripts/check-worker-engine.mjs`, in CI's typecheck
  job) runs the CLI's own import block and `loadEngine()` through jiti, as `check` does, so a commit a worker would put
  in update-bad fails its PR instead. It caught two on 2026-11-02 (d83e363): libsodium-wrappers 0.7.16's ESM build
  imports a file it doesn't ship, and jiti takes the `import` condition (fixed by `patches/libsodium-wrappers@0.7.16.patch`,
  which points that condition at the CommonJS build); and `loadEngine()`'s `Promise.all` raced jiti's async imports, which
  hand a half-run module to a second importer (PLUGIN_DIR undefined in `lib/puku-dotenv.ts`), so it loads one at a time now.
- **What counts as busy:** `engine.live`, the runner's real sessions (`busyCards`), for both the update and the row's
  `busy` status. A card waiting on a permission is mid-turn, so it holds the update too, and a forgotten question holds
  it until someone answers. An idle card's CLI does get cut, and resumes from its saved session on the next message, as after a sign-in.
- **How a push arrives:** GitHub posts to `/api/github/push` on weft.zip (`lib/worker-push.ts`), signed with
  `WORKER_PUSH_WEBHOOK_SECRET`. A delivery for `refs/heads/main` of `aimhuge/weft` calls `worker_update_ping` (service role
  only), which sends one empty Broadcast on the public topic `worker-updates`. Every worker joins it on the socket it
  already has (`listenForPushes`, `lib/worker-wake.ts`). The ping names no commit: the worker fetches origin itself.
- **A ping is forgeable, so it's limited.** Anyone with the publishable key can send on a public topic, not just listen.
  A forged ping can cause a fetch of the real origin and nothing else, and a worker fetches at most once a minute. A
  ping inside that minute isn't dropped, or a stranger's ping could swallow a real push: it checks when the minute ends.
  A ping during a check does the same. Update now skips the limit, since only the account that enrolled a worker can send it.
- **First check after a start:** two minutes in, not at once. A new commit is on trial for its first 60 s, and an update
  in that window would overwrite the commit it rolls back to.
- **The slow check:** hourly while the socket is joined, every 15 minutes when it isn't. On joining, it looks once, for
  anything pushed while it was away.
- **Held updates:** the row names the cards, those asking first, up to three: `Update to abc1234 is waiting for 2 cards:
  “Fix login” (needs your answer), “Docs”.` Card events keep that line current without touching the network, and the moment
  the worker is idle it checks. Every card event wakes that, and so do the end of a pass or clone and the 20 s heartbeat tick as a backstop. Titles are
  no new exposure: `cloud_cards` is already readable by the workspace.
- **Update now:** a button on the worker's row, sent as an `update` command that carries nothing. It asks for the same check,
  so it can't cut off a turn. It runs after the pass that claimed it, since a pass counts as busy. A worker that doesn't
  update itself reports that as a failure. The button is off while the worker is offline.
- **Getting this:** a worker needs one update through the old path to learn all of this: it reaches the new code on its
  15-minute check, or `weft-worker update`. Until then a push does nothing for it and the button fails with "doesn't know
  that kind of request".
- **Setting it up:** the `worker-push` blank on 🪝 and `WORKER_PUSH_WEBHOOK_SECRET` in the production vault, pushed to Vercel. Without the secret the route answers 503, and workers carry on with the slow check.
- **Rollback lives outside the clone.** Code that dies at import can't undo itself, so the wrapper runs `rollback.sh`
  before each start. That's a copy in the worker's home, sealed from threads, refreshed only after a commit proves it
  loads. It counts starts in `update-trial.starts`, and past three it resets to the commit in `update-trial`.
- **What it won't touch:** a clone with local changes, off `main` or ahead of it. It says so on the row and waits, since
  a clone is open to threads and someone may be working in it. It only runs in `<worker home>/weft`, so a daemon started
  from a developer's checkout leaves that checkout alone.
- **The row:** `worker_set_build` (`supabase/migrations/20261030204119_worker_build.sql`) puts the build, as
  `0.6.7+abc1234`, and the reason it's behind on Settings → Sync → Workers. A database without the function logs a line
  and carries on.
- **Off:** `WEFT_WORKER_AUTO_UPDATE=0` in `~/.weft-worker/worker.env`.
- **Not updated by this:** the wrapper and the service definition. `weft-worker update` (which re-runs the installer) rewrites
  those, and it's also how a box installed before this gets the updater. A daemon started by hand exits after an update
  and nothing brings it back.

### After a restart

A restart ends every turn on the box, whether it's an update, a sign-in or a crash. On start, before it reads a single
command, the daemon does what a Mac does and tells the cloud (`lib/worker-recover.ts`, `recover` in `lib/worker-daemon.ts`).

```
lib/store.ts loads     Running or pending ──▶ Review, pending cleared, CLOSED_LINE, interrupted (up to MAX_RESUMES)
                         │ no bus event, so without the rest the cloud row stays Running, "Thinking…", for good
recoverCards           undecided permission rows closed; a card that stays stopped gets a note in its thread
                         │ interrupted: whole thread queued. CLOSED_LINE only: the card row
publisher.flush        the web and desktop boards see Review, and Allow goes away
                         │
resumeInterrupted      lib/resume.ts, as on a Mac: RESUME_TEXT into the saved session, resumes + 1
                         │
commands               a reply queued while the worker was down lands after the resume, not beside it
```

- **The store already recovers; the gap was the cloud.** `loadState` runs here as on a Mac, so `column: running` in memory
  means a live turn after a load. On a Mac the board reads that same memory, so no event is needed. A worker's board reads
  `cloud_cards`, which only hears the bus, and `resumeInterrupted` is called from `lib/copilot.ts`, which a worker doesn't boot.
- **Who resumes:** what lib/resume.ts decides. A card with a session that isn't archived goes on, up to `MAX_RESUMES` in a
  row; your own message resets the count. No age limit, as on a Mac: a card cut off days ago carries on too.
- **Stale permissions:** the request lived in the dead process, so an undecided row is closed as `deny`, which reads
  "Denied" in the thread. A turn that still needs it asks again, as a request that can be answered. An `answer` already in
  the queue fails with "That request isn't waiting anymore."
- **Repeats by design:** a card keeps `CLOSED_LINE` until its next turn, so its row goes up on every restart. That's what
  repairs a row a failed publish left wrong. `interrupted` cards aren't retried that way, but a resumed turn publishes itself.
- **Not covered:** a card whose row is stale but whose card this worker's store no longer has.

### Wake-ups

A command reaches a worker in about 200 ms, and an idle worker asks for commands twice a minute, not twenty times
(`lib/worker-wake.ts`, `supabase/migrations/20261030072445_worker_wake.sql`).

- **The ping:** an after-insert trigger on `cloud_commands` calls `realtime.send` with an empty payload on a public
  Broadcast channel. It fires only for a row `worker_pending` would return: a pending command addressed to a headless
  worker, made by that worker's account. A row for a Mac sends nothing. `realtime.send` swallows its own errors, so a
  ping can't fail an insert, and it runs after commit, so a ping can't beat its row.
- **The topic is the secret.** The worker has no session, so the channel has to be public: anyone with the publishable
  key can join any topic they can name. So the topic is `worker-wake:` + sha256(`weft-worker-wake:` + `key_hash`). The
  database computes it from `key_hash`, and the worker from sha256 of its key. No client can read `key_hash`: the
  column grant leaves it out, Realtime drops it from row payloads and refuses it in a filter (so `key_hash=gt.…` is no
  binary-search oracle against the 20 s heartbeat updates), and `realtime.messages` has RLS with no policies.
- **What a leaked topic costs:** when commands arrive, and the power to cause polls. Never a command: they're still
  read only through the key-checked `worker_pending`, and a ping carries nothing but a random id.
- **The daemon's pace:** one socket, joined with the publishable key. `up` asks once, for anything sent while it was
  away, then polls every 30 s. `down` goes back to every 3 s until it rejoins, and so does a worker with no socket:
  Node before 22 has no WebSocket, so the join fails, it logs that, and it stays on the fast poll. realtime-js rejoins
  by itself. A half-open socket can take up to a Realtime heartbeat to notice, and the 30 s poll covers that gap.
- **A ping during a pass isn't lost:** `poll` is single-flight and a pass can take minutes, so a ping that lands during
  one asks for another pass straight after it.
- **Checking a box:** `~/.weft-worker/worker.log` says `wake socket joined` when push is on. No such line, on a build with
  this code, means it's on the fast poll, and the log says why.
- **Not on this path:** liveness, which has its [own topic](#liveness). The desktop's inbox still uses `postgres_changes`,
  since it has a session.

**Proved on production on 2026-10-30**, before the daemon was built, with a throwaway worker, deleted afterwards: a
keyless client joined and got the ping, a wrong topic heard nothing, and `run`, `login` and `github_login` inserted
through RLS each reached `worker_pending` in 147 to 201 ms. A Mac-addressed row and another account's row sent no ping.
A real socket cut read `CHANNEL_ERROR`, rejoined in 1.3 s, and the next ping arrived.

### Liveness

A worker used to write its row every 20 s: about 4,300 writes a day each, just to say it was up. Now it says so on a
Realtime Presence topic, and the row is the slow record (`lib/worker-presence.ts`, `lib/host/beat.ts`,
`lib/worker-presence-watch.ts`, `supabase/migrations/20261102121500_worker_upkeep.sql`).

```
daemon ─ track {status} ─▶ presence topic worker-presence:<sha256(… key_hash)> ◀─ joined by the local server (keyless)
   │                                                                               ▲ topics from worker_presence_topics()
   └─ worker_heartbeat every 5 min, on a status change, and every 20 s while the socket is down ─▶ cloud_workers row
```

- **The topic is the secret**, as with [wake-ups](#wake-ups): `worker-presence:` + sha256(`weft-worker-presence:` +
  `key_hash`). The worker computes it from its key. A board can't, so `worker_presence_topics()` (definer, signed in only)
  hands each user the topics of the headless workers they enrolled in a workspace they're still a member of, and nobody
  else's. A leaked topic shows when that
  worker is up and lets someone show it online when it isn't; it never reaches a command.
- **The beat** (`createBeat`) ticks every 20 s. With the socket up, a tick re-tracks a changed status and writes the row
  only when the status changed or 5 minutes have passed: about 290 writes a day, plus two per turn. With the socket down,
  or no socket (Node before 22), every tick writes the row, as before. On the way out it leaves the topic, then writes
  `offline`. An update counts as healthy when it has been up a minute and its last row write landed.
- **The board's side** is the local server, not the renderer: `presenceWatch()` asks for the topics once (again at most
  once a minute for a worker it has none for), joins each on one keyless socket and keeps it joined (leaving a worker's
  channel once it's off the list, and all of them when the account changes), so each poll of
  `/api/worker-board` and `/api/workers` reads presence from memory. `liveStatus` decides: tracked on presence → that
  status; row seen in the last 60 s → the row (a worker on the fast beat, or one that just said `offline`); topic synced
  but the worker absent → offline; presence unknown (a teammate's worker, a database without the function, the first
  poll) → the row, offline after 11 minutes. A desktop worker's row still beats every 20 s and goes offline after 60 s.
- **What it costs:** a crashed worker drops off presence when Realtime notices its socket close, seconds to a minute.
  A board that can't read presence takes up to 11 minutes to call it offline.

### Expiring finished commands

`cloud_commands` rows used to stay forever. `private.expire_cloud_commands()` (definer, nobody may call it) deletes the
`done` and `failed` rows whose `updated_at` is over a day old, a failed `clone` after 7 days (so Settings → Sync →
Workers keeps saying why it failed), `claimed` rows after 7 days (a Mac or worker that crashed mid-command leaves them
claimed for good), and never a `pending` one, through the partial index `cloud_commands_expirable` on the same statuses.
No migration used pg_cron before this one, so it doesn't install it. Where pg_cron was installed when the migration ran,
it scheduled `expire-cloud-commands` at 04:17 UTC daily. A migration never runs twice, so a project that turns on
Integrations → Cron later schedules it once by hand in the SQL editor:
`select cron.schedule('expire-cloud-commands', '17 4 * * *', 'select private.expire_cloud_commands()');`.

Since `supabase/migrations/20261103070200_command_leases.sql`, a `claimed` row with a lease (below) goes after a day
untouched instead of 7: its host renews, and so touches, it while it runs, so one left alone that long has lost its host.
A claimed row without a lease (claimed by a host older than leases) still waits the 7 days.

### Leases

A host claims a command once (`lib/host/inbox.ts`), so one that died mid-command used to leave the row `claimed` until
expiry, and the board that asked waited on a result that would never come. Now a claim holds a **lease**,
`cloud_commands.lease_until`, three minutes ahead (`supabase/migrations/20261103070200_command_leases.sql`):

- **Taking one.** `worker_claim` sets it; a Mac's conditional update gets it from the `cloud_commands_lease` trigger,
  which also renews it on any write to `lease_until` while the row is claimed (from the database's clock, never the
  client's value) and drops it when the row leaves `claimed`.
- **Keeping it.** The inbox holds the ids of the commands it's running (`createLeases` in `lib/host/lease.ts`, kept in
  `InboxState.leases` so a Mac's survives a module reload), and the host's beat (`lib/host/beat.ts`, `renew`) renews them
  at most once a minute: a worker through `worker_renew(key, ids)`, a Mac by touching `lease_until` under its own session
  (`sessionLine` in `lib/host/identity.ts`, with the new `update (lease_until)` grant). A long clone run aside keeps its
  lease the same way.
- **Losing it.** At the start of a pass, at most once a minute, a host requeues its *own* expired claims, but only `host`
  commands whose verb is safe to run twice: `IDEMPOTENT_VERBS`, the handlers flagged `idempotent: true` in
  `lib/host-api/index.ts`. Today that's the reads: `skills.list`, `files.list`, `files.read`, `settings.get` and
  `dev.log`. A worker calls `worker_reclaim(key, verbs)`, a Mac the invoker function `reclaim_cloud_commands(device,
  verbs)` (its RLS and grants decide, and the lease is read against the database's clock). Everything else (a new card,
  a reply, `run`, a stop, a write, a mode change) stays claimed and is never run again: twice would be worse than never.
  It's the same host that requeues, so a box that's gone for good leaves its rows to expiry.
- **An older database.** Without the migration the functions and the column aren't there; the first such error turns
  leases off for an hour, said once in the log, and the inbox claims and reports exactly as before.

### What's sealed on a worker

Vault values for a card's `mcp__secrets__run` reach a worker sealed to its `seal-key.json` for one run and stay in the
daemon's memory, never on this disk ([project-hosts.md, H8](project-hosts.md#secrets-on-a-worker-h8-the-per-use-seal-as-built)),
unless the user turned on **Keep on this worker** for a project's development or preview set (Settings → Devices → the
worker → Secrets; [secrets.md](secrets.md#kept-on-a-worker)). Then `kept-vault.json` in the home holds those values
sealed to the same box key, written only from a `vault_keep` the pairing Mac signed (`lib/worker-kept-vault.ts`), opened
only for a Mac-signed `secret_use` that names the value's version, and deleted on a signed wipe, when the worker's key
stops working (revoked), on a pairing to another Mac and by `weft-worker forget-macs`. `weft-worker status` says when it
keeps any. It sits beside `seal-key.json`, so code a card runs as the same user can open it: see the threat there.

The secret guard seals the worker's home as it seals the data dir (`reachesWorkerHome`, `lib/secret-guard-files.ts`), in
every permission mode. The folder gate can't do this job: it asks, and **Always** would grant all of `~/.weft-worker` to
every card on the box. Before this, all four secret files passed the guard, and `~/.weft-worker/data/...` by its `~` path
passed with no question at all, since the data dir is free to the gate and the guard's name check only knew `.weft`.
A deny beats an ask, so the prompt never shows and a grant buys nothing here.

| Under `~/.weft-worker` | A thread |
| --- | --- |
| the home itself, listed: `ls ~/.weft-worker`, `ls -la`, the LS tool (not `-R`, not a glob of it) | open: names only, so a thread can find the folders below (2026-11-02) |
| `worker.json`, `worker.env`, `seal-key.json`, `github-credentials`, `kept-vault.json` | refused: the worker's key, its Claude token, its private seal key, its GitHub token, the values a Mac kept here |
| `worker.log`, `update-bad`, `update-trial`, `rollback.sh`, anything new | refused: the log is the daemon's raw stdout and stderr with no redaction pass, so whatever any process printed (an SDK error echoing a request, a CLI's debug output) lands there; `update-bad` keeps the first line of git and pnpm errors, which can carry a credentialed remote URL; `rollback.sh` is a copy of `install/worker-rollback.sh`, readable in the clone |
| `data/`, as on a Mac | refused, save `data/show` and `data/apps` |
| `work/` (or `WEFT_WORKER_ROOT`) | open: it's where cards run |
| `weft/`, the clone of Weft | read and run: a public repo, and `/weft:done` runs `commit.sh` from the plugin inside it. Never changed by a thread: it's the code the daemon and `weft-worker` run, so an edit could turn off the re-pair check (`lib/worker-clone-guard.ts`, 2026-11-02) |

- **A path is judged by where it lands.** Relative paths start from the card's cwd (`fromCwd`, from the hook's own input),
  not the daemon's, and a `cd` on the line moves them. Symlinks are followed, since a checkout is a repo somebody else
  wrote and may hold a link to `../../worker.json`. So a checkout's own `worker.json` is fine and a link to the real one
  isn't. A symlink loop ends and fails closed. `$HOME`, a variable set on the line, a glob like `~/.weft-w*` and any case
  all count.
- **It runs wherever a worker home exists,** so a Mac that is also a worker is covered, and a Mac that isn't still greps for
  `.weft-worker` in this repo.
- **The same limits as the data dir:** it's a strong default, not a sandbox. It sees names on the command line, so a script
  that builds the path at run time, or a recursive search of a folder above the home (`rg --hidden wwk_ ~`), isn't caught,
  and neither is a shell redirect writing into the home.
- **Not sealed by this:** the same tokens by another way in. The daemon's CLIs carry `CLAUDE_CODE_OAUTH_TOKEN` in their
  environment, so `node -e` can name it (only a whole-environment dump is refused), and a GitHub sign-in made through `gh` sits
  in `~/.config/gh/hosts.yml` and answers `gh auth token` and `git credential fill`. The real fix for both is a process
  boundary between the daemon and its cards.
- **GitHub through the connector** (P1, [connectors.md](connectors.md#connectors-on-a-worker-github-p1-as-built)): a paired
  worker's cards get short user tokens minted on weft.zip through `~/.weft-worker/connector.sock`, held in the daemon's
  memory, never on disk. The socket sits in the sealed home, but the helper reaches it by its path, which no tool call names.

### Re-pairing and a lost Mac

A paired worker takes secrets and signed settings from one Mac, the one whose key came in its pairing code
(`mac-keys.json`). To move it to another Mac, or to pair it again into another workspace, that Mac approves the move:
Settings → Devices → the worker → **Re-pair**, paste the new Mac's `wph.…` code, Touch ID, and run the line it shows in
a terminal on the box (`weft-worker enrol wph.… --re-pair --approval wra.…`). The approval lasts 30 minutes and is
good for that worker and that code only ([project-hosts.md](project-hosts.md#re-pairing-a-worker-as-built-2026-11-02)).

**A lost Mac, or a box that trusts none** (enrolled by token, after `weft-worker forget-macs`, or once its Mac was
revoked: the daemon checks every minute and stops trusting a revoked pairing Mac for good,
[device-registry.md](device-registry.md#revoked-on-one-device-untrusted-on-all)): no Mac can approve, so wipe the box's
enrolment and enrol it fresh. In a terminal on the box:

```sh
rm ~/.weft-worker/worker.json ~/.weft-worker/mac-keys.json ~/.weft-worker/passkeys.json
weft-worker enrol <the wph.… code from the new Mac>
weft-worker restart
```

Then **Revoke** the old worker row in Settings → Devices. `work/` and its checkouts stay. `passkeys.json` goes too: the
passkeys in it were endorsed by the old Mac, and the new one endorses its own. `mac-revoked.json` stays, so a revoked Mac
is never trusted on this box again. The secret guard refuses these paths to threads.

`weft-worker status` names the Mac it takes secrets from by its key's fingerprint, or says that Mac was revoked. With
two Macs signed in, the worker's secret and vault asks go only to the one it's paired with (`cloud_workers.paired_mac`,
[device-registry.md](device-registry.md#the-pairing-mac)); when that Mac is away the card hears so, rather than the ask
going to a Mac whose answer the box would refuse.

#### Passkey heads: a worker never approves with an outdated set

Built 2026-11-03 with `supabase/migrations/20261103080100_worker_passkey_heads.sql` (not applied). The pairing Mac sends
a worker its passkey set as a `pin` command, re-sent until the worker's signed receipt; but until a revoke's pin landed,
the worker still took the revoked passkey, and a session that deleted the pin rows could hold that off.

- **The channel.** Whenever main signs a worker's set (`electron/widen-endorse.cjs`: Passkeys, a revoke, a narrowing
  after an unpair or a reconcile) it also signs a **head**, `weft-endorse-head-v1` over {worker, generation, issuedAt},
  with the same approval key, and inserts it in `worker_passkey_heads` before the set goes out; once a day it signs the
  current one again. A failed insert is tried again on the next refresh (in 5 minutes for the same set, at once for a
  newer one).
- **Why it can't be held back.** The table is insert-only for clients (no update or delete grant; only a 30-day prune by
  the database's own clock), so a stolen session can add rows but never remove or change the real head. The worker reads
  every head for itself (`worker_passkey_heads(key)`, at most 501), keeps those its *trusted* Mac key signed for it
  (`lib/passkey-head.ts` `newestHead`: junk, another worker's, another Mac's or a revoked Mac's are skipped) and takes the
  highest generation, so an old head inserted again changes nothing. A read with more rows than it can check (a flood) is
  a refusal, so junk can't push the real head out of sight; it remembers the highest head it has seen in
  `passkeys.json` (`seen`), so the prune never lowers the bar.
- **The rule.** Before a passkey assertion counts (`lib/host-signers.ts` `verifyPasskey`), the worker reads the heads; it
  refuses while the set it holds is older than the newest ("it holds set N, your Mac signed M"), and refuses when it can't
  read them. The Mac's own signature (Touch ID) doesn't depend on it.
- **Limits.** Fail-closed by design: until the migration is applied, or while Supabase can't be reached, a worker takes no
  passkey approvals (the Mac's own still work). A flood of junk rows (owner's session only) stops passkey approvals until
  it ages out. Withholding the Mac's insert itself would need control of the Mac's network.

#### A passkey-approved re-pair: designed, not built

Asked for: re-pair at weft.zip with a passkey, confirmed by a code shown on the box's console, so a lost Mac doesn't
cost a wipe. **Not built, because it doesn't fit the existing approval ladder safely.** A browser passkey is
deliberately the lowest approver: it may not approve a vault secret, skipping permissions or a folder grant ("That one
needs your phone or this Mac", `lib/passkey-phone-only.ts`, `PASSKEY_TOO_WIDE` in `lib/widen-check.ts`). A re-pair
chooses the Mac the box takes *every* secret from, which is strictly more than any of those. Letting a passkey do it
would make the passkey the weakest link for all secrets on the box: whoever holds a browser session and a synced passkey
(an unlocked laptop, a passkey shared through a password manager) could move the box to a Mac of theirs. And the case it
is for, a lost Mac, is exactly when the worker can't learn of a newer passkey set (only that Mac signs one), so a passkey
the user revoked from another Mac could still approve. The wipe needs a real shell on the box, which a thread can't fake
(the secret guard refuses those paths), so it stays the recovery.

What would make it fit, if it's wanted later:

1. **Approver.** A *phone* (the trusted tier) rather than a browser passkey. A worker now pins a phone's Ed25519 key the
   way it pins passkeys, endorsed by the pairing Mac in the same set (`weft-endorse-v3`), with the same heads
   (`lib/passkey-head.ts`), so revoking the phone anywhere stops it (built for Allows only: mobile-security.md, "Phones on
   a worker"); a re-pair would add its own message and check.
2. **Request.** On the box, `weft-worker enrol wph.… --re-pair --remote` (terminal only, as today) inserts a
   `worker_repair_requests` row with its key (worker id, the new code's pairing and workspace, the new Mac key, a random
   12-character console code shown only on the box; the row stores its hash) and polls it.
3. **Approval.** The phone (or sign.weft.zip, if the phone tier is ever opened to passkeys) asks for the console code,
   typed by hand, never in a link, so an approval can't be for a request the person didn't start at the box. It reads the
   request itself, shows the worker's name, the new Mac's fingerprint and the workspace, and signs
   `weft-repair-remote-v1` over {worker, newMacKey, pairingId, orgId, codeHash, issuedAt, nonce}. 30-minute lifetime, one
   use, as `wra.` lines.
4. **Box check.** The approval counts only if the signer is in its pinned set *and* that set is not behind the newest
   head (`latestHead`), then `trustPairingMac` replaces the Mac as today.
5. **Notice.** Every remote re-pair emails the account, as a new connector signer does (`connector_signers`), with a
   link to revoke the worker.

### Worker projects on the desktop board

A project that lives only on a worker shows on the desktop board with its cards, and nothing is copied into the local
store (`lib/worker-project.ts`, `lib/worker-board.ts`, `lib/worker-transport.ts`, `app/api/worker-board`).

- **A project is a path:** `worker://<worker id>/<folder>`. The board's chips, grouping and filter already key on a
  path, so a worker card only needs its `cwd` set to that (`boardFrom`) to file itself. Nothing on the Mac sits at that
  path, and `resolveFolder` refuses it, so a stray one can't start a CLI.
- **The list:** your headless workers' folders (`cloud_workers.folders`) plus the folders of their `cloud_cards`, so a
  project shows with no cards, and a worker too old to report still shows the ones it has cards in. An offline worker's
  projects stay listed. A chip carries the worker's name; a row in More reads `on m1mini` or `on m1mini · offline`.
- **`cards` stays local.** `Board` keeps its own `cards`, and what's drawn reads `boardCards` (`useBoardWorkers`).
  `ownColumns` keeps worker cards out of Archive all, Resume all and Switch all; `localPath` keeps a worker path out of
  the terminal, header badges, drawers and the copilot.
- **A card acts through its host (H3, [project-hosts.md](project-hosts.md#hostfor-and-one-open-card-h3-as-built)).**
  A worker card's tile is no longer read-only: star, archive, stop, Allow / Deny, Wait / This first / Others first,
  ▶ continue and Restart, dragging to another column and its right-click menu (trimmed to rename, tags, star, the
  moves, the modes a worker takes, Run on, New Thread here and archive) each go out as a `host` command
  (`lib/project-host.ts` `hostFor(cwd).act`) and land on the board at once through `lib/optimistic-cards.ts`, which
  `useWorkerBoard` now draws its cards through; a refusal reloads them. Not offered: delete, Share…, the agent, the
  folder, skills, the vault, the dev server, and logging this Mac's CLI in.
- **Reading:** the account's Supabase session lives on the local server, so the renderer polls `/api/worker-board` every
  5 s (once a minute with no worker), and an open thread re-reads its newest page every 2.5 s. A project's snapshot (the
  header badges, [project-hosts.md](project-hosts.md#project-reads-and-the-editor-h4-as-built)) is live: from the first
  snapshot read, the server subscribes to `cloud_worker_projects` over Realtime (`lib/worker-project-live.ts`; the table
  joined the publication in `supabase/migrations/20261103070100_worker_projects_realtime.sql`, and RLS hands each
  member only their workspace's rows), and each change goes to the board as a `worker_project` event, which drops that
  project's cached snapshot and moves its version (`snapshotChanged` and `useSnapshotVersion` in
  `lib/project-snapshot-view.ts`), so the badges read again at once. Without the publication the channel errors or stays
  quiet, it's tried again after 5 minutes, and the badges read as before: on a turn's end, on focus, past a 15 s cache.
- **The thread:** a worker card opens in the board's own workspace (`components/OpenCard.tsx`), like a local one:
  `ThreadPanel` over `workerTransport` (`desktop: false`, `cardEdits: true`), so its header offers rename, tags, star,
  archive and the model picker, and its reply box ↑ edit, fresh and the held-edit choices, each a host verb; the show
  rail projects the items its thread view drew (`lib/worker-shown.ts`), and the pane column is `components/WorkerPane.tsx`
  (in the desktop app, this Mac's native pane on a page the card wrote or a site, as on a local card,
  [below](#pages-from-a-worker); `WebPane` on the live screen, a page only the worker has, and off the
  desktop app; the native pane under Local Simulator). The editor column
  says a worker's files aren't there yet. Reply, answer, stop and mode are the same `cloud_commands` rows the web sends.
- **A new thread:** `POST /api/cards` with a worker path calls `startWorkerThread`, sends a `run` with that folder, makes
  no local card and answers with the worker's name. An offline worker refuses with a message and nothing is sent. A
  reply to an offline worker queues, and the thread says so. There's no Backlog in a worker project.
- **Folder reports:** `worker_set_folders` and `lib/worker-folders.ts` exist, but the daemon doesn't call them yet, so
  until it does a project needs a card to show.
- **Not yet:** attachments on a new thread, Run on Worker's local record cards still sit on the local project, and
  a file pasted into a new thread for a worker goes up plain (a reply's goes sealed once the card is).
- **Sealed threads:** Settings → Devices → the worker → Seal… grants a paired worker the workspace key, sealed to the box key
  the Mac pinned and signed by the Mac's approval key after Touch ID (`electron/worker-key-grants.cjs`). The worker checks it
  against the Mac in `mac-keys.json`, holds the key in memory only (`lib/worker-keyring.ts`, read at start, on a `key_grant`
  ping and every 10 minutes), and from then on publishes its card, items, tool outputs, pages and their files sealed, as a
  Mac's outbox does, and files a Mac or a browser pastes into its sealed cards go up sealed too; both boards open them.
  Add a worker offers Seal… right after pairing while your Mac seals. Once it has sealed, `seal-floor.json` in its home makes a worker with no key hold
  its rows back rather than publish plain. Re-pin and Revoke drop its grants and rotate the key. A token-enrolled worker
  trusts no Mac and stays plain. See [mobile-security.md](mobile-security.md#sealing-on-a-weft-worker).

### Pages from a worker

A card on a worker shows its pages in the pane on both boards, the same way a card on a Mac does on weft.zip. There's no
pane on the box, so a page is a file the card wrote, uploaded as a blob with what it names. The one live thing is a
device's screen ([The live screen](#the-live-screen)).

```
card writes ~/.weft-worker/data/show/plan.html
  │ mcp__browser__open_url(path)                   lib/worker-pane.ts: uploads now, so a failure reaches the agent
  ▼
blob store (lib/blob-store.ts, mayUpload = workerMayUpload)
  │ POST weft.zip/api/worker-blob  Bearer wwk_…    sha256(key) → cloud_workers row → its org, service client
  │ ◀── signed upload URL for <org>/<sha>
  │ PUT to Supabase Storage directly               a Vercel function can't take a 50 MB body
  ▼
card.page and the open_url item carry blob:sha256:<hex>#anchor (lib/worker-publish.ts, lib/card-rows.ts's withUploadedPage)
  ├─▶ web board: WebThreadPanel → WebPane → /api/web-board/<org>/page/<sha>
  └─▶ desktop board: OpenCard → WorkerPane → native pane (pane partition) → /api/worker-board/page/<sha>  (5 s poll of the worker's cards)
                     (WebPane's iframe on the same route off the desktop app)
```

- **The tools:** `scripts/weft-worker.ts` sets `WEFT_WORKER=1`. `open_url` then calls `openOnWorker`: a local page uploads
  before the tool answers (and opens in the worker's own browser too), and a public https address or this box's own dev
  server opens in the worker's headless Chromium, live in the pane. The other browser tools drive that browser
  ([worker-browser.md](worker-browser.md)); only `fill_field` needs the desktop app. `WORKER_BROWSER_PROMPT` replaces `BROWSER_PROMPT` in the thread's prompt,
  so a thread knows the pane works and never tells you to open a file on the box. An image in a reply (`![…](/abs/x.png)`)
  goes up the same way.
- **A review tour's pages too.** A step that names a file on the box (`"path": "/Users/me/.weft-worker/data/show/todos.html#done"`)
  used to reach the Mac as that path, and the pane said "This page only exists on the machine running this card."
  `withUploadedTour` (`lib/review-blobs.ts`, a step of `projectCard` in `lib/card-rows.ts`) sends every such step's page up
  through the same `uploadPage`, inside the same `workerMayUpload` roots, and the row's step reads
  `blob:sha256:<hex>?query#anchor`. `stepUrl` (`lib/review.ts`) and `paneFromUrl` (`@weft/client`) open that as the
  uploaded copy, so the tour works on the desktop board and weft.zip alike. The worker's own card keeps its paths.
- **Writing a page asks nobody.** `acceptEdits` only writes without asking inside the CLI's working directories: its cwd
  and `additionalDirectories`. The show folder is neither, because a card's cwd is its checkout. Nothing on the desktop
  exempts it: an Accept edits card there asks about `~/.weft/show` too. A desktop card goes through because it runs in
  Auto or YOLO, or waits for you. A worker defaults to Accept edits, never runs YOLO, and has nobody at the box, so
  `sessionDirs` (`lib/show-dir.ts`) adds `SHOW_DIR` to `additionalDirectories` for every thread, desktop and worker alike
  (2026-10-31; the desktop asked too). It makes the folder first, because the CLI drops a directory that doesn't exist and asks again. Reads and edits of a page stop asking too.
  Spares get it as well, since it's set where a session's options are built (`lib/runner-session.ts`).
  - **Auto too.** The folder doesn't stop every prompt: a card in Auto on `m1mini` still asked about an Edit in the show
    folder, though Auto on a Mac doesn't. So `ownPageCall` (`lib/worker-pane.ts`) answers a file tool inside `SHOW_DIR`
    from `askAboutCall`, on a worker, in any mode but `default`. It goes by where a path really lands, never counts Bash,
    and runs after the hooks.
  - **Nothing else opens.** Only `data/show` is added, not its parent, and every path past it stays with the secret guard,
    which runs first in every mode and follows links ([What's sealed on a worker](#whats-sealed-on-a-worker)). So
    `show/../../worker.json`, a link in `show` to a sealed file, `data/board.json` and `data/showcase` are all refused.
    `lib/secret-guard-worker.test.ts` holds that line.
  - **Ask me still asks.** A card in `default` mode prompts for a page, because working directories don't change that
    mode. It's the mode you picked, so it stays that way; a card run in it on a worker waits for an answer on the board.
- **Only Claude Code and puku-cli for now.** Their MCP servers run in the daemon's process. Codex and Goose reach Weft's
  tools over the local server (`lib/mcp-bridge.ts`), which a worker doesn't run, so they have no `open_url` yet.
- **What may go up** (`workerMayUpload`, `lib/worker-blobs.ts`). A Mac's rule is "under home and not a known secret". That
  isn't enough here: `worker.json`, `worker.env`, `seal-key.json` and `github-credentials` all pass it, and a page can name
  any path. So a worker's rule is an allowlist: a web file type (not JSON), inside `data/show` or the work root, with no
  dot folder or dot file on the way, after following symlinks. The blob store asks it for every upload, and for a
  stylesheet, which is inlined rather than uploaded. A work root outside home is refused too.
- **The route** (`app/api/worker-blob`) takes the key as a bearer and only a sha. The org comes from the worker's row, so a
  key can only reach its own workspace. A signed upload doesn't overwrite. It can't check that the bytes match the sha,
  and neither can the bucket's member insert policy, so a key can do what a member can and no more.
- **Sandboxing.** The web board is unchanged. The desktop board is stricter, because its frame sits in the board window's
  session. A worker's page is untrusted, so `app/api/worker-board/page/[sha]` sends a CSP with no `http:` source (the page
  can't fetch, load or post anything to 127.0.0.1), and the iframe is `sandbox="allow-scripts"` with no popups or forms. A
  public site is never framed there: its CSP isn't ours, so the pane says so and offers Open ↗. (In the desktop app both
  now load in the native pane instead, [above](#pages-from-a-worker); this frame is what's left off it.)
- **The launch token stays out of frames** (`electron/api-token.cjs`). `attachApiToken` used to put it on every request
  from the board window's session, so a page could navigate its own frame to a local GET with it attached. It now skips
  a frame's navigation (`resourceType` `subFrame`) and anything a frame asks for (`details.frame.parent`, or the
  `initiatorOrigin` of `"null"` a sandboxed frame has, which holds once its frame object is gone), and drops a value the
  frame set itself. A skip alone would have broken this page, since the frame's own load has to pass `guard()`, so a GET of
  exactly `/api/worker-board/page/<sha>` gets the plain read value `1`, as the pane does for pictures. The board's other
  frames need nothing: the intros and the welcome loop are static files in `public/`, the print sheet is a `srcdoc` used
  only on the web, and the share views' frames aren't in the board window. Checked in real Electron 44: the board's fetch
  carried the token, the page loaded on `1`, and a sandboxed frame's self-navigation to `/api/settings` arrived with none.
- **The native pane on a worker card** (2026-11-03). In the desktop app, `WorkerPane` loads a page the card wrote, and a
  site, in this Mac's native pane, so it has the address bar, tabs, zoom, find, Save as app and the browser tools a local
  card's pages have (`lib/worker-native-page.ts`). A blob opens as `http://<this Mac's server>/api/worker-board/page/<sha>#anchor`
  under the card's key, when the card's page changes (a new one, the show rail, the review tour) and not when the card is
  only reopened on it; a site opens as it is (the pane's own session, so the board-session rule above doesn't apply). The
  live screen, a page only the worker has and no page stay `WebPane`, and so does weft.zip. Save as app maps the proxied
  address back to its `blob:sha256:` ref (`savedPageUrl`), so the page still comes home through `lib/mini-app-worker.ts`.
  What lets it load, and what it doesn't gain:
  - `electron/self-url.cjs` stops treating exactly `/api/worker-board/page/<64 hex>` as "Weft itself" (`WORKER_PAGE`); any
    other path on the server still is, so the pane still refuses the board and every other route.
  - `attachPaneAttachments` (`electron/api-token.cjs`) gives the pane's session the plain read value `1` on a GET of that
    path, as the board's frame gets it, and nothing else under the route. The pane partition never carries the launch
    token, so the page can't reach a token-only route, and `1` is what any local process may already send.
  - The route's CSP comes along: `sandbox allow-scripts` gives the page an opaque origin and no popups or forms, and no
    `http:` source keeps it off 127.0.0.1, in the pane as in the frame. The pane's preload exposes `window.weft` to `file:`
    pages only, so the page gets no data bridge.
  - `weft://` links from a worker page are dropped (`isWorkerPageUrl` in `electron/browser-pane.cjs`): its sandboxed frame
    could never follow one, so it can't open a card, the copilot or a pre-filled New thread either. (`reply` and `commit`
    already needed a file page under `~/.weft`.)
  - The pane's control server is unchanged and token-guarded; a worker card's thread runs on the worker, whose browser
    tools drive the worker's own browser, not this pane.
- **`worker_put_card`** fills `cloud_cards.page` and `pages` from the card
  (`supabase/migrations/20261030143806_worker_card_page.sql`), so a phone feed reads a worker's card from its row.
  `page_thumb` stays null: a worker has no pane to capture.
- **The panes follow `card.page` too:** the desktop reads only that. The web reads the thread and falls back to it, since
  its thread loads newest 50 first and a long turn can push the last `open_url` past them.
- **An upload that fails** never holds back the thread: the row keeps the path, and the pane says the page is on the machine
  running the card. From `open_url` itself the agent gets the error.
- **What's sealed: nothing a worker sends.** A worker has no workspace key: `workspace_key_grants` wraps keys to paired
  devices, and pairing is a Mac's. So its cards, items and tool outputs go up plain even with **Seal synced threads** on,
  redacted as a Mac's are, and any member of the workspace can read them. Its page blobs are plain too, but so are a Mac's:
  blob sealing is designed and not wired (mobile-security.md, Gaps). Sealing a worker needs a grant wrapped to its X25519 key
  (`seal-key.json`) and a Mac that pins it. Until then, don't put a secret in a page: redaction doesn't touch page blobs.

### The live screen

`mcp__simulator__watch` on a worker streams the device to the card's pane, and the desktop board can tap it. There's no
window to capture on a headless box and no Electron to capture it with, so this is screenshots, not video.

```
watch ─ simctl/adb screenshot ─ WebP 420 px ─▶ Realtime Broadcast, topic worker-screen:<random>  ─▶ WorkerScreen in WebPane
          lib/worker-screen.ts                 card.page = weft-screen:<token>?device&name&until      (either board)
daemon ◀─ claim ◀─ cloud_commands kind=input ◀─ POST /api/worker-board (elevated) ◀─ click or drag, desktop only
```

- **Format, agreed on the topic:** each board that draws WebP tracks `{ formats: ["webp","jpeg"] }` in the screen
  topic's Presence once it joins (`lib/use-screen-stream.ts`). The worker binds a presence listener and, per frame, sends
  WebP at quality 70 only while at least one board is there and every board there said it takes WebP, and its sharp can
  write it (`agreedType` in `lib/screen-formats.ts`, `frameType` in `lib/screen-frame.ts`; `WEFT_SCREEN_FORMAT=jpeg` forces
  JPEG). Otherwise it's JPEG. A board too old to announce says nothing, so it gets JPEG only when it watches alone:
  beside a new board it's invisible, gets WebP, and stays blank until it updates. On iPhone simulator screenshots at 420 px a WebP
  frame is 8.5 KB against 17 KB for JPEG, for ~15 ms more encoding. The payload is `{ webp }` or `{ jpg }`, base64.
- **Pace:** up to 4 frames a second, sent only when the bytes changed, plus one every 3 s for a board that just opened. A
  still screen costs almost nothing. It ends with the watch (10 minutes, extended by another `watch`).
- **Who can watch:** the channel is public, because a worker has no session, so the topic is the secret, as with
  [wake-ups](#wake-ups). It's 128 random bits per stream and lives only in `card.page`, so a workspace member who can read
  the card's row can watch, and frames go out plain like everything else a worker sends. A share link can't carry it: shares
  read thread items, and a screen is never one.
- **Who can touch:** only commands, never the channel. `input` goes through `worker_pending` (the worker's own account),
  the local route takes it only from Weft's window (`elevated`), the daemon checks the card is its own, and
  `lib/simulator-input.ts` refuses a device that isn't being watched. It skips the queue behind a starting card, as a clone
  does, and a tap asks for a frame at once (`nudgeScreen`). weft.zip watches but doesn't tap yet.
- **The pane's own controls** (`components/web-board/ScreenBar.tsx`), on the desktop board, which can send commands: a
  "☁︎ streaming from <worker>" badge beside the device's name, so it reads as remote and not this Mac; a **device menu** from
  `card.page`'s `devices` (the worker's list, at most 40, written at each watch); **Resume** once the 10 minutes are up; and
  **📱 Start simulator** in the host chip's menu (`components/web-board/HostChip.tsx`, the pane header's "m1mini" chip, which also
  lists the worker's devices while one streams) or the empty pane of a card on a React Native or Expo app (`card.mobileApp`, set by the
  worker when it starts the card, `lib/mobile-app.ts`). Each is an `input` command of kind `watch` with a device or none:
  `watchFromBoard` in `lib/worker-screen.ts` takes the named device, else the booted one, else the first simulator, boots it,
  and streams it. Switching device stops the card's last one. The thread isn't asked, and the agent still has `watch` itself.
- **Latency:** the slow part is the box, not the network. On m1mini `axe` took 1.1 s for a tap, and the command path adds
  its own trips, so a tap's answer takes over a second. This path is the one that works from anywhere. The fast one is H.264
  and taps from `idb_companion`, which a spike got out of the simulator with no window (about 0.7 Mbps). Video doesn't belong
  on Supabase, so it takes [the fast path](#the-fast-path) where WebRTC connects.

### The fast path

A watched iOS simulator or Android emulator also gets H.264 and live input over WebRTC, beside the JPEGs, which never stop. WebRTC finds a direct
route on a LAN or through NAT with no open port, so home and away are one path. Anything that goes wrong leaves the pane on
the JPEGs.

```
idb_companion ─ private unix socket, gRPC ─ daemon ═ WebRTC, encrypted ═▶ <video> in WorkerScreen (RTP track)
  lib/idb-companion.ts                       lib/rtp-video.ts               lib/rtc-video-track.ts
                                             lib/worker-rtc.ts           ═▶ canvas (the "video" channel, older peers)
board ─ sealed offer, elevated input command ─▶ daemon ─ encrypted answer, Broadcast ─▶ board
  lib/worker-board.ts                                     lib/rtc-signal.ts
```

- **The companion** has no login, so it listens on a unix socket in a `0700` folder, never on `--grpc-port`. It starts with
  the watch and ends with it, and `tapAt` and `swipe` use it while it's open, which also speeds the command path. It reports
  the screen's size, so taps work with no AXe on the box.
- **Even sides.** The encoder sends nothing, with no error, unless both sides of the video are even. 0.5 fails on a 1179-wide
  iPhone 16 and a 1206-wide 16 Pro, and full size fails on the iPhone 16, so `evenScale` picks the scale nearest the
  target, never above full size, that lands on exact even numbers (8/9 on the iPhone 16 at full size).
- **Quality** is the pane's menu, kept per board in `localStorage`: low (15 fps, half size, 0.6, 2 Mbps), medium (30 fps,
  full size, 0.85, 8 Mbps, the default: at half size and 0.6 a retina pane drew it soft) or high (60 fps, full size, 0.9,
  20 Mbps). It rides in the sealed offer (`quality`), and `VIDEO` in `lib/idb-companion.ts` turns it into the encoder's
  settings when the video starts, so a new pick closes the line and offers again at once.
- **One line, named channels, one video track.** `answerOffer` takes a map of channel names to handlers, and a `media` hook
  that takes the offer's m-lines before the answer is made. `input` carries the live gesture and keyboard; other live streams
  can add a channel. `renegotiate` answers a later offer on the same peer, a label with no handler goes to `"*"`, and the
  board's ICE servers (TURN) come in the offer. Since H6 a board also keeps a **session line** to each worker it shows,
  with `host`, `events` and `line` channels, and the watched screen rides it as a track
  ([project-hosts.md](project-hosts.md#the-session-line-h6-as-built)); this screen-only line is the fallback.
- **Proving who answered.** The board makes an offer and a one-time key. Its local server seals both to the worker's published
  key (`sealedOffer`, purpose `RTC_PURPOSE`) and sends them as an `input` command. Only that worker can open it, and it answers
  under the one-time key on the watch's Broadcast topic. The topic is public, so an answer that won't open is dropped. Both
  DTLS fingerprints travel inside these protected messages, which keeps anyone from sitting in the middle.
- **Who can watch and touch:** making an offer takes the elevated route, so reading a card buys neither. The line carries both.
  `card.page` only gains `fast=1`, which says the watch takes offers.
- **Gesture and keyboard.** `down`, `move` and `up` are sent as they happen, as fractions of the screen, and a gesture holds one
  hid stream from press to release. Keys go as HID usages (`lib/hid-keys.ts`), down and up. With no line open, a finished tap or
  swipe takes the command path.
- **Paste.** ⌘V on the focused screen sends the clipboard's plain text as one `{ t: "text" }` event on the input channel
  (`pasteEvent`, `lib/rtc-signal.ts`). Only the `paste` event does it, so the board never reads the clipboard on its own,
  and only over an open line: with none, a paste does nothing. It's cut to `PASTE_MAX` (2,000 characters) on the board, and a
  worker drops a longer one. The device types it: on iOS each character becomes its US-keyboard HID presses, Shift
  included (`lib/hid-text.ts`, idb's `text`), as `idb ui text` does it; on Android it's `input text` lines, a newline as
  Enter and a tab as Tab (`textLines`, `lib/adb-input.ts`); the worker's browser takes it whole with CDP's
  `Input.insertText`. A character no US key types (accents, emoji) is dropped on a device; the browser keeps it.
- **Video on an RTP track (H6a).** The board's offer carries a receive-only video m-line limited to H.264 in packetization-mode 1,
  High first, then Constrained Baseline (`offerVideoTrack`, `setCodecPreferences`, jitter buffer target 0). The worker is
  configured for those two codecs only, and `takeVideo` turns the m-line to `sendonly` before answering, so it's all inside
  the existing sealed offer and answer. idb's access units (Annex B; idb encodes High, `640033` at full size) are cut by
  werift's `H264Packetizer` (single NAL, STAP-A, FU-A, 1,100-byte payloads), stamped on the 90 kHz clock as they arrive and
  sent with `sender.sendRtp` (`lib/rtp-video.ts`). The board plays the track in a `<video>`: no decoding code. A lost packet
  costs only its frame: werift answers NACKs from its cache, and nothing queues behind a gap.
- **Fallback.** Both paths ship. The board always opens the `video` channel too. An older worker answers the m-line
  inactive and sends on the channel; a board that offers none (older, or a browser with no H.264 for RTP) gets the
  channel; a track that negotiates but shows no frame before the answer timeout isn't offered again on that board. On the
  channel: a 4-byte length, then one payload, chunked to 16 KB messages on a reliable, ordered channel and put back
  together by `frameReader`; a viewer more than 2 MB behind skips to the next key frame. When the track is in use the
  channel stays silent, and its closing is how the worker hears the board left.
- **Key frames and bitrate.** idb's `video_stream` takes fps, bitrate and key frame interval only in its `Start`
  message and has no key frame request, so both are a restart of the stream: its first frame is always an IDR, 52 to 76
  ms after the restart on m1mini. A new viewer gets a new stream, so it starts on a key frame; a PLI or FIR restarts it, at
  most once a second. The rate starts at the quality's (2, 8 or 20 Mbps) and `bitrateControl` (`lib/rtp-bitrate.ts`) moves
  it on the board's receiver reports: loss after NACK repair, from the running totals over 100-packet windows, above 10%
  cuts it to 0.6× (no more than every 4 s, never under 0.5 Mbps); under 2% for 12 s raises it 1.5× back toward the
  ceiling. REMB is read but not used: the board's estimate follows what arrives, and an idle iPhone sends about 90 kbps.
- **Measured on the track, m1mini to headless Chrome on the same box** (iPhone 16 Pro, medium): High profile negotiated, 1206×2622
  at 22 to 25 fps, 5 ms jitter buffer, 4 to 7 ms decode, 0.06 to 0.1 Mbps with the screen idle. With packets dropped at
  random after the NACK cache, 5% and 30% loss were fully repaired (0 lost, 0 PLIs, rate held at 8 Mbps); 60% made
  PLIs and stepped the rate 8 → 4.8 → 2.9 → 1.7 → 1.0 → 0.6 Mbps over 30 s. Not yet measured: gesture to frame on the
  track, Electron's own board, and any real network.
- **Measured on m1mini, LAN, on the channel:** 198 ms median from a live gesture to the first frame arriving that shows movement (88 to 375 ms,
  13 of 16 detected, before decoding and drawing), 29 fps, about 0.66 Mbps at quality 0.2 and a 2 Mbps cap. Fast scrolling
  showed artifacts at those settings, so it's now 0.6 and 8 Mbps, not yet measured under motion. Nothing's been measured off
  the LAN, and a slow link may need a lower bitrate.
- **weft.zip seals its own offers.** A tab has no Mac server, so `@weft/client` seals in the browser
  (`packages/weft-client/src/seal.ts`: libsodium's X25519, Web Crypto's HKDF-SHA256 and AES-256-GCM, byte for byte as
  `lib/worker-seal.ts`, which `lib/worker-seal-client.test.ts` proves by opening both on the worker's side). Your own open
  worker card holds its worker's **session line** (`lib/web-lines.ts`, `useWebLine` in `components/web-board/useWebHost.ts`):
  the tab reads `cloud_workers.public_key`, seals the offer (`lineOpener`) and inserts the `line` row with its own session,
  which only the worker's owner may do (`private.owns_device`), in exactly the server's shape
  (`20261103150000_line_row_shape.sql`). Over it go the card's verbs (`lib/cloud-host-acts.ts`, never a
  widening or pasted files), its thread's events beside Realtime (`lib/line-thread.ts`) and the watched screen as an H.264
  track. The phone gets the same opener with its own RTCPeerConnection (`openLine`, `packages/weft-client/src/line-open.ts`).
- **TURN on weft.zip.** A web line asks weft.zip's own `GET /api/web-board/ice` (`lib/web-ice.ts`, `webIce` in
  `lib/web-lines.ts`) for its ICE servers, which mints Cloudflare TURN credentials with the desktop's `mintIce`
  (`lib/rtc-ice.ts`; `CLOUDFLARE_TURN_KEY_ID` and `CLOUDFLARE_TURN_KEY_API_TOKEN` on the deployment). Only a signed-in
  visitor (cookie, or the phone's bearer) who owns an unrevoked worker gets them, at most 12 asks a minute per account
  (per instance), never cached (`no-store`); the key never leaves the server, the browser gets the minted username and
  credential (4 h). The servers ride in the sealed offer, so the worker relays through the same allocation. Without a key
  on the deployment, a refusal or any failure, the line opens on STUN alone, and the board stays on the relay where that
  can't connect. The live screen rides the session line as a track, so it relays too.
- **Not yet:** the phone app wiring the opener (it can call `/api/web-board/ice` with its bearer); a screen line of its own
  on weft.zip (the web can't seal the screen's own `input` offer, so it rides the session line or stays on JPEGs). The
  screen's own line on the desktop is STUN only; on a network that blocks direct connections it rides the session line,
  which takes TURN, or stays on JPEGs.
- **Android** (`lib/adb-screen.ts`, built 2026-11-03, not yet run on a device). The emulator's video is `adb exec-out
  screenrecord --output-format=h264 --bit-rate=<rate> --time-limit=180 -`: raw Annex B on stdout, cut into access units by
  `lib/h264-units.ts` (a new frame starts at an AUD, SEI, SPS or PPS after a slice, or at a slice whose first_mb_in_slice is
  0; a 12 ms lull ends the last one, since screenrecord writes nothing on a still screen; an IDR without its SPS and PPS
  gets the last ones seen). Those frames go into the same `rtpVideo` track and `videoChannel` idb feeds, so the board
  can't tell them apart, and the JPEGs keep running underneath as the fallback. screenrecord stops itself at 3 minutes,
  so `rollingVideo` starts the next one at 170 s and switches at its first frame (a key frame), stopping the old one: no
  gap. A recording that ends early is followed at once; one that sends nothing (screenrecord refused) ends the stream,
  and the pane stays on JPEGs. A PLI or a new bitrate restarts screenrecord, as it restarts idb. Quality is bitrate alone
  (2, 8 or 20 Mbps, low at half size), since screenrecord takes no frame rate. Input is one `adb shell` held open for the
  watch, fed `input` lines built from numbers and quoted text only (`lib/adb-input.ts`): a quick still press is `input
  tap`, any other gesture one `input swipe` over the time it took (a long press is a swipe that didn't move; the path
  between isn't replayed); a key that types something is `input text`, Enter, Escape, Backspace, Tab and the arrows are
  `input keyevent`, Shift is held across presses. The size is `wm size` (the override when set), in pixels, the units
  `input` takes. **Needs a device check:** that screenrecord's frames decode in the board's `<video>` (profile and level
  as the emulator's encoder picks them), the switch at 170 s shows no stall, the 12 ms lull doesn't split a large IDR
  on a slow pipe, and how far gesture-to-frame latency lags iOS.
- **Install:** `install/worker.sh` puts idb_companion 1.1.8 in `~/.weft/tools/idb-companion`, pinned by hash, on a Mac with
  Xcode. A failure only skips it, and `lib/idb-companion.ts` also finds it on PATH. idb's GitHub release publishes no digest, so
  the hash is of the file as downloaded. An auto-update runs `pnpm install` but not that script, so an enrolled box needs
  `weft-worker update` to get it.

### The LAN path

A board on the same network as a worker opens its [session line](project-hosts.md#the-session-line-h6-as-built) straight
to the box, found through a signed mDNS hint, with no Supabase round trip: no `line` row, no Broadcast answer. The line
it opens is the same one, its verbs on the same `host` path; only how the offer and the answer travel changes. Supabase
stays the fallback for every step that fails. Built 2026-11-03.

```
worker  lib/worker-lan-start.ts ── multicast-dns ── _weft._tcp  PTR/SRV/A + TXT { v, id, fp, port, at, sig }
                                                                 sig = worker sign key over weft-lan-hint-v1\n id\n fp\n port\n at
        lib/worker-lan.ts  POST /line on 0.0.0.0:<port>
Mac     lib/lan-offer.ts   (this Mac's server, from openWorkerLine)
          1 main: POST /lan-line/keys → the sign key + box key pinned at pairing (electron/lan-line-sign.cjs)
          2 lib/lan-mdns.ts browser: a TXT for that worker id that checks against those pins, fresh (lib/lan-hint.ts)
          3 seal the board's offer to the pinned box key (LINE_PURPOSE); main: POST /lan-line/sign → this Mac's device key
            over weft-lan-offer-v1\n workerId\n issuedAt\n nonce\n sha256(sealed)
          4 POST http://<packet's source address>:<port>/line { v, workerId, sealed, mac }
worker  rate → size → shape → pinned Mac key + fresh + nonce once → unseal → daemon.lanLine: the `line` kind (lib/worker-kinds.ts
        openLine) as the owner's row would run it → lib/host-line.ts answers to the reply, not the Broadcast topic
board   ◀── { answer: sealed under the one-time key } in the /api/worker-board reply ── lib/session-line.ts opens it as before
```

- **Where it runs.** The renderer can't browse mDNS or reach a LAN socket, so this Mac's server does it inside
  `openWorkerLine` (`lib/worker-board.ts`), before the row; the reply's `answer` goes to `createSessionLine`, which feeds it to
  the same `openAnswer` a Broadcast answer takes. The browser (`multicast-dns`, MIT) opens once per server process, on the first
  offer, and only after main answered (off the desktop there is no control server, so no socket is opened); it asks for
  `_weft._tcp` every 30 s and waits up to 400 ms for a hint when it has none. `WEFT_LAN=0` turns it off on either end.
- **Which boxes.** Only a worker paired through Settings → Devices: the Mac needs its pinned sign key (to check the hint) and
  box key (to seal to), and the box needs the Mac key from the pairing code (`mac-keys.json`, to check the offer). A
  token-enrolled box, a box after `weft-worker forget-macs`, and a worker this Mac re-pinned (box key dropped) take the row.
  The worker listens on any free port (`WEFT_LAN_PORT` fixes one) and logs "offering lines on the LAN, port N".
- **Reconnecting.** A dropped line (no answer, ICE `failed`, a channel closed) is offered again after the backoff, and each new
  offer takes the LAN when a fresh hint is up and the row when it isn't; an ICE `disconnected` or a missed pong first tries the
  line's own ICE restart, as before. So a box that moves off the LAN falls back to Supabase on the next try, and one that comes
  back is reached directly again.
- **What's checked, and against what.** The hint: the worker id, the fingerprint of the box key this Mac pinned, an Ed25519
  signature by the sign key it pinned at pairing (never `cloud_workers`), and `at` within 5 min (re-signed every 60 s). The
  offer, in order, cheapest first: 6 tries per address and 20 in all per minute, and 2 being answered at once (429); 64 KB by
  Content-Length and while streaming, 5 s for headers (413); a whole offer for this worker's id (400 / 403); then a Mac key
  this box pinned and hasn't since marked revoked (`mac-revoked.json`, lib/worker-mac-revocation.ts; read on every offer), a signature over this exact sealed offer's digest and this worker id, `issuedAt` within 60 s of the box's
  clock, and a nonce never seen (kept on disk in `lan-nonces.json`, inside the sealed worker home); then the seal opens for
  `LINE_PURPOSE`. Every refusal past the shape is the same 403.
- **Threat model.** *A spoofed advert* (someone on the LAN advertising this worker's id) fails the signature or the
  fingerprint and is never offered to. *A replayed advert* (a real TXT re-sent from another address within its 5 minutes)
  sends the sealed offer to the wrong place: it can't be opened (sealed to the box key), its answer key and TURN credentials
  are inside it, and the board falls back to the row when nothing answers; the cost is the attempt. *A replayed offer* is
  refused by its nonce, and a stale one by its time; one replayed inside the window to the real box would open nothing the
  replayer can use, since the answer comes back sealed under the board's one-time key. *An offer from anyone else on the
  LAN* (anyone can seal to a public box key) is refused without the pinned Mac's signature, so the port gives no more than
  the relay, which takes only the owner's rows. *DoS on the port* is bounded by the rate and size limits, the concurrent cap
  and the timeouts; a flood can make the board fall back to Supabase, never take the line. *DoS on the browser* is bounded by
  64 workers and 4 records each, checked only when a line is offered. The Mac signs with its device key and no Touch ID, as it
  signs settings: what's signed is built in main from checked fields under its own prefix, so it can't stand for an approval,
  and only the server holds the control server's token. A line opened this way can do exactly what a `line` row's can.
- **Tested** with a fake mDNS bus (`lib/lan-mdns.test.ts`) and end to end on 127.0.0.1 (`lib/lan-line.loopback.test.ts`): a
  worker daemon advertises, this Mac's server finds it, checks it, seals, signs and posts, the worker opens the line through
  its own `line` kind, and the board opens the answer; a spoofed advert is ignored and an unpinned Mac refused. Not yet run on
  a real LAN (multicast through a real router, a Linux box's firewall, Electron's server).
- **Not yet.** Reconnecting without a new offer (the address is only used to deliver the offer; ICE does the rest); IPv6
  (the socket is `udp4`); weft.zip and the phone, which can't browse mDNS.

**Local Simulator.** To test by hand with no tap latency, a card can run its build on a simulator on your Mac, with the agent still driving it:
[Local Simulator mode](manual-qa.md).

**Modes.** A worker's card has the mode picker in its thread header, sent as a `mode` command (`CARD_MODES`): Ask me, Accept
edits or Auto, applied mid-turn. It's elevated, and the daemon holds it to the same list, so a row can't buy YOLO. Auto's
blocks come back as a prompt on the board. The simulator tools are trusted (`lib/board-tools-trust.ts`) in every mode, like
the browser's, since they only reach a sandboxed device. In Local Simulator mode that device is on your Mac and an iOS app isn't sandboxed from it, so the Touch ID grant stands in for the prompt ([Security](manual-qa.md#security)).

**Tunnels, the relay and dev servers on a worker** (built 2026-11-02, [tunnels.md#on-a-worker](tunnels.md#on-a-worker),
migration `20261102190000_worker_tunnels.sql` not applied). Each point below is now built: approval is a `tunnel_open`
device call the owner's Mac answers after Touch ID; writes are the key-checked `worker_tunnel_open` and
`worker_tunnel_close`; `install/worker.sh` pins cloudflared; the daemon owns the gate (`lib/worker-reach.ts`);
`mcp__devservers__*` ran on the worker already and now publish to the Services drawer; and the pane gets `/t/<id>` with
Open ↗. The relay goes through the same Mac ([webhooks.md#on-a-worker](webhooks.md#on-a-worker)). The design as it was
set out:

1. **Approval.** Touch ID lives in Electron main. A worker needs a `tunnel` command only the owner's account can send, and
   a thread must not be able to send it itself, so it goes through an elevated board action like an `answer`, and refuses
   a call from a thread's curl.
2. **Writes.** `tunnels` is written as the owner and `ticket_secret` is read only by the service role, so a worker needs key-checked
   `worker_tunnel_open` and `worker_tunnel_close` functions that keep both true.
3. **cloudflared on the box.** `lib/tunnel-cloudflared.ts` pins one release into `~/.weft/bin`. A worker needs that under
   its home, with digests for each platform and arch, including linux, and the install script's say-so.
4. **The gate's lifetime.** The daemon has to own `lib/tunnel-gate.ts` and cloudflared, close them on a restart, and
   refuse the same way when a target isn't http localhost.
5. **A dev server to point at.** `mcp__devservers` needs the desktop too, so a worker needs its own start, stop and status.
6. **The pane.** `/t/<id>` needs a weft.zip session. A sandboxed frame has no cookie and the board window must not frame it,
   so the first version is Open ↗ in the toolbar. `openOnWorker` would then trade a localhost URL for the card's `/t/<id>`.

### Goose on a worker

Goose's provider and endpoint say where a Goose card's traffic goes, so they never sync and are never a plain host
setting (`packages/weft-client/src/host-settings.ts`). Settings → Threads → On a worker shows them for a worker that
reports them (`components/WorkerGooseFields.tsx`), and Save on worker sends them in the same `settings.put` as the host
settings, signed (built 2026-11-03):

- **Signed by the Mac, after Touch ID.** `workerSettings` (`lib/worker-host-settings.ts`) asks main to sign a widening
  over exactly the patch: verb `settings.put`, card `""`, change `{ goose: { gooseProviderId?, gooseBaseUrl? } }`, args
  the whole patch (`signWiden`, `electron/widen-sign.cjs`, whose Touch ID prompt reads "point Goose at the provider … and
  the endpoint …, for the settings on the worker …", and names any host setting riding with it). Without the desktop app
  there's no signer: the fields show greyed and Save doesn't send them.
- **Checked on the worker.** `remoteRefusal` still refuses the Goose fields unsigned (they're foreign to `HOST_SETTINGS`).
  `signedGoose` in `lib/host/dispatch.ts` lifts that only for a `widen` that `widenProblem` accepts against the worker's
  own id, its nonce book and the Mac key it pinned at pairing (`lib/host-signers.ts`); the rest of the patch must then
  pass `remoteRefusal` on its own, so an approval can't carry `allowedFolders`. **A passkey can't sign it**
  (`PASSKEY_NO_GOOSE`, `lib/widen-check.ts`), even where the web may approve a "!" line. A Mac has no `goose` rule, so it
  refuses them from the network as before.
- **Saved.** `applyGooseSettings` (`lib/host-goose-settings.ts`) checks both fields first: a provider in the catalog or
  `""`, an endpoint that's `""` or an http(s) URL of at most 500 characters with no user or password in it. Then it
  saves. `settings.get` reads them back with the host settings.
- **The endpoint reaches Goose.** A worker has no Electron main to grant a key; without one from the Mac (below) Goose
  starts as the plain binary, and `gooseEndpointEnv` (`lib/goose-provider.ts`) still sets the endpoint's own variable (`ANTHROPIC_HOST`, `LITELLM_HOST`,
  `AZURE_OPENAI_ENDPOINT`, `GOOSE_PROVIDER__HOST`), as it now does on a Mac where Goose holds its own key.
- **The key comes from the Mac, per turn, after Touch ID** (built 2026-11-03, with
  `supabase/migrations/20261103160000_goose_key_ask.sql`, not applied). The key stays in the paired Mac's Keychain
  (`electron/goose-token.cjs`); a worker's `worker.env` still can't reach Goose (`cliEnv` drops secret-named variables,
  `GOOSE_DISABLE_KEYRING` is set). Each Goose turn whose provider takes a key asks for it:

  ```
  worker gooseLaunch (lib/goose-launch.ts) on a worker ─ gooseKeyOnWorker (lib/worker-goose-key.ts): openAsk(nonce,
         goose: true) ─ goose_key device call through worker_mac_ask, signed by sign-key.json over [card, box key,
         nonce, expiry, provider, endpoint] (lib/worker-goose-key-wire.ts)
  Mac    lib/device-calls.ts → POST /secrets/worker-goose-key (by call id only) → electron/worker-goose-key.cjs:
         re-read the row with main's session ─ paired worker only (pinned sign key) ─ signature ─ a card its owner
         started (cardOrigin) ─ nonce spent once ─ provider AND endpoint equal what this Mac last signed for that
         worker (electron/worker-goose-set.cjs, recorded by electron/widen-sign.cjs after the settings.put Touch ID)
         ─ the Keychain key ─ Touch ID naming the worker, card, provider and endpoint ─ seal to the PINNED box key for
         gooseKeyPurpose(card, nonce, [provider, endpoint]) ─ Mac-signed secret_use, use: "goose"
  worker deliverSecretUse (lib/worker-secret-asks.ts): Mac signature ─ the open ask ─ opens under the goose purpose
         only ─ same card, nonce, provider and endpoint, the one key name ─ gooseEnvFor (lib/goose-provider.ts) ─
         that one Goose process's env; remember() for redaction; the next turn asks again
  ```

  - **Where the key may go.** Main answers only for the provider and endpoint it last set on that worker under Touch ID,
    so a worker (or anyone holding its `wwk_` key) can't point the key at a new host: changing the endpoint means a new
    signed `settings.put`, whose Touch ID names it. A Mac that never set the pair, or whose record won't open, refuses.
  - **Only that turn's process.** The key goes into the spawned `goose run`'s env (and so to the tools and subagents it
    runs), never the daemon's own env, an argument or a file. Goose's rows (its replies, progress steps, result and a
    failure's error) go through `redactStored` in `lib/goose-runner.ts`, so the key shows as `‹NAME›` in the thread;
    `forgetOnTurnEnd` drops it from memory when the card leaves Running.
  - **What a refusal does.** Denied, no Mac, unpaired or no key saved fails the turn with why, except LiteLLM and a
    custom endpoint, which may run keyless and start plain. Ollama never asks.
  - **Not kept on the worker.** "Keep on this worker" (`vault_keep`) is per project, development or preview; the opened
    plaintext of a Goose key says production, which keeping refuses on both sides, and a kept key would save only the
    trip, not the Touch ID. So every Goose turn on a worker asks Touch ID once.
  - **The threat that stays.** Any code that turn runs on the worker (its shell tool, a script, a dependency) can read the
    key from its env, as the Touch ID prompt says; the worker's other cards run as the same OS user and could read a
    running Goose's env. The key is as safe as that box for as long as the turn runs.

### Cloning onto a worker

The project menu's **Clone from GitHub** form gets a compact picker in the same row when you have a headless worker of
your own: This Mac by default, then each worker, with no new row when you have none. Picking a worker sends a `clone`
command instead of calling `lib/repos.ts`, so no prompt and no thread are needed.

- **The command:** `cloneCommand` (`lib/worker-commands.ts`) takes owner/name, builds the https URL and names the
  folder for the repo, the same project name a later run uses. `kind` is widened by
  `supabase/migrations/20261030061145_worker_github.sql`. The form's input parsing is unchanged, and the worker still
  applies materialise's https/ssh check.
- **On the worker:** `cloneProject` (`lib/worker-paths.ts`) reuses `materialise`, and also checks a folder that's
  already there: it must have the same origin, because two owners' repos can share a name. The daemon runs a clone off
  the poll loop, so a Stop or a reply isn't held behind a clone that takes minutes. Git runs with
  `GIT_TERMINAL_PROMPT=0`, so a missing sign-in fails at once rather than hanging.
- **A folder means a complete clone:** `materialise` clones into a hidden `.cloning-XXXXXX` sibling and renames it into
  place only once the files are out, removing it on failure, because a folder at that path is what "present" trusts: a
  failed checkout used to leave a 181 MB tree with HEAD set, and a resend ran a card in it. Hidden names are refused by
  `repoPath`, so no command can reach a clone in progress. A temp folder over an hour old lost its worker mid-clone,
  and the next clone in that folder removes it. If a run and a clone race, the loser takes the winner's checkout.
- **Git LFS:** the clone is `--no-checkout`, then `git grep` looks for `filter=lfs` in the `.gitattributes` at HEAD. A
  repo that uses LFS gets `git lfs install --local` before its files are written, so a box with the binary but no global
  filters fetches real files, not pointer files. With no git-lfs, the clone stops with a message saying what to
  install. `install/worker.sh` installs git-lfs and its filters, and carries on without them if it can't.
- **The result reaches the desktop:** the form waits on `GET /api/workers?command=` (`lib/worker-command-wait.ts`).
  `explainClone` (`lib/worker-github.ts`) turns git's stderr into a plain message, such as "this worker isn't signed in
  to GitHub". It shows in the menu and as a toast, because the menu can close during a long clone. The worker's row in
  Settings → Sync → Workers keeps your latest failed clone until a newer one works, so a failure outlives the 5 s toast
  and reaches you even from a worker that was offline when you asked. A command nobody claims for a minute comes back
  as queued. The web board's strip leaves worker sign-ins and clones out (`boardCommands`): it would show them as new
  threads.

**Signing GitHub in** follows the Claude sign-in's security model, with its own command (`github_login`) and seal
purpose (`GITHUB_PURPOSE`), so a token sealed for one can't be opened as the other.

- **The token:** you paste it in `components/WorkerGithubSignIn.tsx`, on the worker's row. The link opens GitHub's
  fine-grained token page already filled in. **The scope is Contents read and write** on the repos you pick, which brings
  Metadata read with it, and it expires in 90 days. Read alone would clone but a card couldn't push, and that's the
  least that lets a card finish its work; a classic token's `repo` covers every repo you can reach. A card that should
  open pull requests needs Pull requests write added by hand. There's no one-click flow as there is for Claude:
  GitHub has no `setup-token`, and copying the desktop's own `gh` token would hand the worker far more than it needs.
- **On the worker:** the token is checked with `GET /user` first, so a bad one fails with a real message and stores
  nothing. Then `signInGithub` runs `gh auth login --with-token --insecure-storage` (stdin, never an argument) and
  `gh auth setup-git`. If gh is missing or refuses the token (it wants `read:org` on a classic one), it writes a mode-600
  `~/.weft-worker/github-credentials` and points git's `store` helper at it. Both are scoped to github.com, so a clone
  from another host never sees the token, and the empty helper entry clears macOS's keychain helper, which a service
  can't answer. No restart: git asks its helper afresh each time.
- **What it touches:** `gh` and `git config --global` are the box's user's, not the worker's own. On a box you also
  use by hand, this changes that user's GitHub sign-in. Every card on the worker can use the token.
- **The row:** `worker_set_github` publishes the account and `signed_in`, `expired` or `none`, never the token. The state
  comes from `git credential fill` and `GET /user`, so it reports what git would really use, including a sign-in made
  by hand on the box. It's checked at start, hourly, after a sign-in and after a failed clone. A 401 is expired; a
  rate limit or no network leaves the row as it was. `listWorkers` reads these columns in a second query, so a database
  without them only loses the line.

### The desktop as a headed worker

A signed-in Weft desktop that syncs a folder already takes the web board's commands (`lib/cloud-inbox.ts`), so it is a
worker in all but name: a **headed** one, with the browser pane, the vault and webhooks a headless box lacks. It lists
itself in Settings → Sync → Workers beside the headless ones (`supabase/migrations/20261029141006_desktop_workers.sql`).

- **The row:** `cloud_workers.kind` is `headless` or `desktop`; a desktop row carries its `device` (the Mac's sync
  device id) and is one per (account, device). It has no key: `desktop_worker_beat` upserts it as `auth.uid()`, and
  its `key_hash` is never a hex digest, so no key can act as it.
- **The beat** (`lib/desktop-worker.ts`, through the host core's `createBeat`, [project-hosts.md](project-hosts.md#one-host-program-h5-as-built)) rides the inbox's 30 s check: only while the inbox listens (signed in, a
  folder synced), so a Mac that sleeps, signs out or stops syncing reads as offline a minute later. It says `busy`
  while any thread runs. It never throws: a database without the function just leaves the Mac off the list.
- **A run sent to it** (`sendRun` looks the worker's kind up itself) is a plain `new_card` for its device, not a `run`.
  The inbox finds the folder by path or by a project name exactly one synced folder has (`syncFolderFor`).
- **The list** marks the Mac you're on (`here`): it's left out of Send a run, a desktop row has no Remove (it would
  only beat back), and Run on Worker (`pickWorker`) never picks a desktop.

Not yet: leases and reclaim, the worker picker and chip (phase 2), shared claims (phase 3), MCP and the vault on the
host (phase 4), worktrees per card, and streaming deltas to the web.

### One code path with local projects

How a Worker project gets everything a local one has (one handler layer, `hostFor`, one open card, the WebRTC line for
everything live, passkey approvals, one device registry) is designed in [project-hosts.md](project-hosts.md), with its
gap table and phases.

Since H4 the daemon also publishes each folder's header reads (quality, the scout's last report, the pile and the
Backlog) to `cloud_worker_projects` through `worker_put_project` (`lib/worker-projects.ts`, started in
`scripts/weft-worker.ts`: every 5 minutes, 20 s after a card change, never mid-turn), and answers the editor's
`files.*` verbs, putting a result over the row's 4 KB in the blob store through `Engine.carry`
([project-hosts.md](project-hosts.md#project-reads-and-the-editor-h4-as-built)).

A worker card's thread header has the ⏰ and the ✦ skill set chip too: the ⏰ makes a cron on the worker with
`cron.create` (args.id the card; the worker narrows its mode, crons.md#on-a-weft-worker), and the chip lists the worker's
own skills and sets one with `card.update { skill }` (skills.md). Your agents from Settings → Agents, and each worker
project's default agent, sync to the worker with your signed account settings (agents.md#on-a-weft-worker), so an agent
you made exists there, and a new thread there that names none starts as the project's default.

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
read scope) plus the project identity. `reply`, `answer` and `stop` are reused verbatim. Since H2 every card action
also has the generic `host` kind ([project-hosts.md](project-hosts.md#transports)), and those three run as its verbs.

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

<a id="folder-grants-today"></a>**Folder grants today** are local to the machine running the card. A worker's card offers
**This card** and **Always** on the desktop board and on weft.zip, and the choice travels as a scope on the `answer`
command (`AnswerPayload.grant`). The worker reads the folder from its own pending request, then writes `Card.readScope`
or its own `settings.allowedFolders`, so Always means that worker and every card on it. The command carries no path,
so it can buy only what the prompt on screen asked for, the way `RUN_MODES` leaves out `bypassPermissions`. The details
are in [the folder gate](thread-guards.md). A worker on an older build ignores the scope and treats the answer as Allow
once. **Taking one back:** Settings → Security lists this Mac's folders only, so a worker's Always stays until
`allowedFolders` is edited in that worker's own settings file. Workers obey only their owner's commands
(`worker_pending`), and an Allow (with its grant) must be signed by the pairing Mac's desktop key or a passkey it
endorsed there (`lib/worker-approve.ts`, [mobile-security.md](mobile-security.md#answers-on-a-worker-built-2026-11-03)),
once the worker pins either; the desktop board signs every Allow on a worker card after Touch ID. If grants move to Supabase as below,
keep both rules: the folder comes from the machine's own pending request, never from a client, and Always stays per
worker.

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

1. **Installs the toolchain.** Checks for `git`, `curl`, `node` 20+ and `git-lfs`, and installs what is missing — with
   `apt-get` on Linux, with `brew` on macOS. A compiler toolchain is added only if the project needs one.
2. **Clones the worker.** Pulls Weft's worker into `~/.weft-worker`. It [updates itself](#auto-updates) from then on;
   `weft-worker update` does it by hand.
3. **Enrols itself.** Calls the API with the workspace's service key, gets back a worker id and its own key, and
   writes both to `~/.weft-worker/worker.json` with mode `600`.
4. **Runs as a service.** A `systemd` unit on Linux, a `launchd` agent on macOS. It starts on boot, restarts on
   crash, and says it's up on Realtime Presence, with a row write every 5 minutes.

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
   `cloud_worker_leases` with an expiry, renewed on heartbeat, makes them reclaimable. Built as a column instead
   ([Leases](#leases)): `cloud_commands.lease_until`, renewed from the beat, reclaimed only for idempotent verbs.
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
