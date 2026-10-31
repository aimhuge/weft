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
  plan, never bypass), `clone` and the two sign-ins, `login` and `github_login`, and the web's `new_card`, `reply`,
  `answer` and `stop` (`lib/worker-daemon.ts`). It hears a
  [wake-up](#wake-ups) and reads `worker_pending` at once, with a poll as the backstop, because without a session
  Realtime's row filters show it nothing. It claims with `worker_claim`, which only matches a pending row, and
  heartbeats every 20 s.
- **Publishing:** `lib/worker-publish.ts` hears the engine's bus and ships cards and items through `worker_put_card`
  and `worker_put_items`, built like the Mac's rows (`lib/cloud-sync-rows.ts` scrub and splitToolResult, redaction).
  It keeps its queue in memory, and sends pages and images up as blobs first.
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
  with a token, and Send a run queues a prompt. A worker that hasn't heartbeat in 60 s reads as offline.

- **Run on Worker, per project:** a project chip's right-click menu ticks **Run on This Machine** or **Run on Worker**
  (`lib/project-menu.ts`, `settings.workerFolders`, kept apart from the project list since its entries are rebuilt on
  each use). In a worker project, `POST /api/cards` with `start` calls `lib/worker-handoff.ts` instead of
  `startCard`: it picks one of your workers (online, then busy, then offline), sends the card's first message as a
  `run` under the project's folder name and its GitHub remote as `https://github.com/<slug>.git`, and leaves the local
  card in Review with the prompt and a note naming the worker. A failed send deletes the card rather than run it
  locally. Switching on refuses when you have no worker. The run and its replies live on the worker's card, which
  [the desktop board shows](#worker-projects-on-the-desktop-board) under the worker's project.

### Auto-updates

A worker keeps itself on the newest commit of `main`, with no one at the box (`lib/worker-update.ts`,
`install/worker-rollback.sh`). `main`, not release tags: it's what the installer clones, and a worker fix shouldn't wait
for a dmg. The cost is that **every push to main reaches every worker within 15 minutes, unsigned**, so push access
to the repo is code execution on every box. That's the same trust `curl | sh` and `weft-worker update` already ask for.

```
every 15 min   git fetch origin main
                 │ newer, not skipped, clean clone on main
no live turn, no clone, no pass in flight ──▶ otherwise the row says it's waiting, and the next check asks again
                 │ commands stay queued from here on
update-trial written, then merge --ff-only, pnpm install
                 │ a failed install: reset, no restart, the same commit is tried next time
weft-worker check loads the whole engine in a child
                 │ a commit that won't load: reset, added to update-bad, never tried again
exit 0 ──▶ launchd or systemd starts the new code
                 │ dies 3 times before it's healthy: the wrapper resets and adds it to update-bad
up 60 s and a heartbeat landed ──▶ update-trial deleted
```

- **What counts as busy:** `engine.live`, the runner's real sessions (`busyCards`), not the store's `running` column: a
  daemon that died mid-turn leaves its card there for good, and that would hold updates back forever. A card waiting on
  a permission is mid-turn, so it holds the update too, and a forgotten question holds it until someone answers. Its row
  says so. An idle card's CLI does get cut, and resumes from its saved session on the next message, as after a sign-in.
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
- **Not on this path:** the heartbeat stays at 20 s. The desktop's inbox still uses `postgres_changes`, since it has a
  session.

**Proved on production on 2026-10-30**, before the daemon was built, with a throwaway worker, deleted afterwards: a
keyless client joined and got the ping, a wrong topic heard nothing, and `run`, `login` and `github_login` inserted
through RLS each reached `worker_pending` in 147 to 201 ms. A Mac-addressed row and another account's row sent no ping.
A real socket cut read `CHANNEL_ERROR`, rejoined in 1.3 s, and the next ping arrived.

### What's sealed on a worker

The secret guard seals the worker's home as it seals the data dir (`reachesWorkerHome`, `lib/secret-guard-files.ts`), in
every permission mode. The folder gate can't do this job: it asks, and **Always** would grant all of `~/.weft-worker` to
every card on the box. Before this, all four secret files passed the guard, and `~/.weft-worker/data/...` by its `~` path
passed with no question at all, since the data dir is free to the gate and the guard's name check only knew `.weft`.
A deny beats an ask, so the prompt never shows and a grant buys nothing here.

| Under `~/.weft-worker` | A thread |
| --- | --- |
| `worker.json`, `worker.env`, `seal-key.json`, `github-credentials`, `worker.log`, `rollback.sh`, `update-trial`, `update-bad`, anything new | refused |
| `data/`, as on a Mac | refused, save `data/show` and `data/apps` |
| `work/` (or `WEFT_WORKER_ROOT`) | open: it's where cards run |
| `weft/`, the clone of Weft | open: a public repo, and `/weft:done` runs `commit.sh` from the plugin inside it |

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

### Worker projects on the desktop board

A project that lives only on a worker shows on the desktop board with its cards, and nothing is copied into the local
store (`lib/worker-project.ts`, `lib/worker-board.ts`, `lib/worker-transport.ts`, `app/api/worker-board`).

- **A project is a path:** `worker://<worker id>/<folder>`. The board's chips, grouping and filter already key on a
  path, so a worker card only needs its `cwd` set to that (`boardFrom`) to file itself. Nothing on the Mac sits at that
  path, and `resolveFolder` refuses it, so a stray one can't start a CLI.
- **The list:** your headless workers' folders (`cloud_workers.folders`) plus the folders of their `cloud_cards`, so a
  project shows with no cards, and a worker too old to report still shows the ones it has cards in. An offline worker's
  projects stay listed. A chip carries the worker's name; a row in More reads `on m1mini` or `on m1mini · offline`.
- **`cards` stays local.** `Board` keeps its own `cards` for everything that acts, and only what's drawn reads
  `boardCards`. `ownColumns` keeps worker cards out of Archive all, Resume all and Switch all; `localPath` keeps a
  worker path out of the terminal, header badges, drawers and the copilot. A worker card draws `readOnly` and opens.
- **Reading:** the account's Supabase session lives on the local server, so the renderer polls `/api/worker-board` every
  5 s (once a minute with no worker), and an open thread re-reads its newest page every 2.5 s. There's no Realtime here.
- **The thread:** `components/WorkerOpenCard.tsx` is the web board's `ThreadPanel` with `workerTransport`
  (`desktop: false`), so it offers what weft.zip offers, beside the browser pane. Reply, answer and stop are the same
  `cloud_commands` rows the web sends.
- **A new thread:** `POST /api/cards` with a worker path calls `startWorkerThread`, sends a `run` with that folder, makes
  no local card and answers with the worker's name. An offline worker refuses with a message and nothing is sent. A
  reply to an offline worker queues, and the thread says so. There's no Backlog in a worker project.
- **Folder reports:** `worker_set_folders` and `lib/worker-folders.ts` exist, but the daemon doesn't call them yet, so
  until it does a project needs a card to show.
- **Not yet:** attachments on a new thread, Run on Worker's local record cards still sit on the local project, and
  sealed rows (a worker publishes in the clear today).

### Pages from a worker

A card on a worker shows its pages in the pane on both boards, the same way a card on a Mac does on weft.zip. There's no
pane on the box, so nothing is streamed live: a page is a file the card wrote, uploaded as a blob with what it names.

```
card writes ~/.weft-worker/data/show/plan.html
  │ mcp__browser__open_url(path)                   lib/worker-pane.ts: uploads now, so a failure reaches the agent
  ▼
blob store (lib/blob-store.ts, mayUpload = workerMayUpload)
  │ POST weft.zip/api/worker-blob  Bearer wwk_…    sha256(key) → cloud_workers row → its org, service client
  │ ◀── signed upload URL for <org>/<sha>
  │ PUT to Supabase Storage directly               a Vercel function can't take a 50 MB body
  ▼
card.page and the open_url item carry blob:sha256:<hex>#anchor (lib/worker-publish.ts, the Mac's withUploadedPage)
  ├─▶ web board: WebThreadPanel → WebPane → /api/web-board/<org>/page/<sha>
  └─▶ desktop board: WorkerOpenCard → WebPane → /api/worker-board/page/<sha>  (5 s poll of the worker's cards)
```

- **The tools:** `scripts/weft-worker.ts` sets `WEFT_WORKER=1`. `open_url` then calls `openOnWorker`: a local page uploads
  before the tool answers, a public https address is noted as it is, and localhost is refused with the reason. The other
  browser tools say they need the desktop app. `WORKER_BROWSER_PROMPT` replaces `BROWSER_PROMPT` in the thread's prompt,
  so a thread knows the pane works and never tells you to open a file on the box. An image in a reply (`![…](/abs/x.png)`)
  goes up the same way.
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
  public site is never framed there: its CSP isn't ours, so the pane says so and offers Open ↗.
- **The launch token stays out of frames** (`electron/api-token.cjs`). `attachApiToken` used to put it on every request
  from the board window's session, so a page could navigate its own frame to a local GET with it attached. It now skips
  a frame's navigation (`resourceType` `subFrame`) and anything a frame asks for (`details.frame.parent`, or the
  `initiatorOrigin` of `"null"` a sandboxed frame has, which holds once its frame object is gone), and drops a value the
  frame set itself. A skip alone would have broken this page, since the frame's own load has to pass `guard()`, so a GET of
  exactly `/api/worker-board/page/<sha>` gets the plain read value `1`, as the pane does for pictures. The board's other
  frames need nothing: the intros and the welcome loop are static files in `public/`, the print sheet is a `srcdoc` used
  only on the web, and the share views' frames aren't in the board window. Checked in real Electron 44: the board's fetch
  carried the token, the page loaded on `1`, and a sandboxed frame's self-navigation to `/api/settings` arrived with none.
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

**What a worker tunnel would need** (docs/architecture/tunnels.md runs on the desktop only):

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
- **The beat** (`lib/desktop-worker.ts`) rides the inbox's 30 s check: only while the inbox listens (signed in, a
  folder synced), so a Mac that sleeps, signs out or stops syncing reads as offline a minute later. It says `busy`
  while any thread runs. It never throws: a database without the function just leaves the Mac off the list.
- **A run sent to it** (`sendRun` looks the worker's kind up itself) is a plain `new_card` for its device, not a `run`.
  The inbox finds the folder by path or by a project name exactly one synced folder has (`syncFolderFor`).
- **The list** marks the Mac you're on (`here`): it's left out of Send a run, a desktop row has no Remove (it would
  only beat back), and Run on Worker (`pickWorker`) never picks a desktop.

Not yet: leases and reclaim, the worker picker and chip (phase 2), shared claims (phase 3), MCP and the vault on the
host (phase 4), worktrees per card, and streaming deltas to the web.

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

<a id="folder-grants-today"></a>**Folder grants today** are local to the machine running the card. A worker's card offers
**This card** and **Always** on the desktop board and on weft.zip, and the choice travels as a scope on the `answer`
command (`AnswerPayload.grant`). The worker reads the folder from its own pending request, then writes `Card.readScope`
or its own `settings.allowedFolders`, so Always means that worker and every card on it. The command carries no path,
so it can buy only what the prompt on screen asked for, the way `RUN_MODES` leaves out `bypassPermissions`. The details
are in [the folder gate](thread-guards.md). A worker on an older build ignores the scope and treats the answer as Allow
once. **Taking one back:** Settings → Security lists this Mac's folders only, so a worker's Always stays until
`allowedFolders` is edited in that worker's own settings file. Workers obey only their owner's commands
(`worker_pending`) and have no paired phone, so an answer on a worker isn't signed. If grants move to Supabase as below,
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
