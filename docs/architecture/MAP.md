# MAP.md: where things live in Weft

The detailed file map, moved out of SOUL.md (2026-10-24) so it isn't loaded into every thread. SOUL.md says who
Weft is and how to work here; this file says where each feature's code lives. Read the part you need, then the
matching doc below. When a feature lands, add or update its entry here and in its own doc, not in SOUL.md.

## Docs in this folder

- `admin.md` — the super-admin gate (`SUPER_ADMIN_EMAILS` or a `super_admins` row, via `lib/admin.ts`), the `/admin/users` (real Last seen from `user_active_days`, a per-account activity drawer), `/admin/billing`, `/admin/coupons` and `/admin/settings` pages and the admin kit they share (`components/admin/`), the rail's 🛡 Admin icon, the data routes in `app/api/admin/*`.
- `overview.md` — what Weft is end to end: the Electron shell, the Next.js server, cards-as-threads, the loop with the user.
- `board.md` — the board screen's structure: `Board.tsx` owns state and wiring, hooks under `lib/` decide, layer components draw; the column view and the list view (the board as a sheet on glass, on the sheet kit with its columns in `lib/list-sheet.ts`, `components/list-grid.css`); how to add a column extra, shortcut, palette item or dialog flag.
- `sheet.md` — the sheet: any list of rows as a Google-Sheets-like table on glass, from `@aimhuge/sheet` (aimhuge/components: column specs, sorts, filters, type-to-search, `SheetTable`, type-ahead menus, saved state, `sheet.css` mapped to Weft's palette in `app/globals.css`); what Weft keeps: the board list's spec, bands and tree (`lib/list-sheet.ts`, `lib/list-tree.ts`) and superadmin Users (`lib/users-sheet.ts`).
- `desktop-shell.md` — `electron/` itself: main, preload, tray, dock, `weft://` links, the start screen, the terminal drawer, and the packaging allow-list that decides what `app.asar` ships (`electron/packaged-deps.test.ts` guards it).
- `threads-and-sessions.md` — the runner: one Agent SDK `query()` per Claude Code/puku thread, the Codex runner, sessions, queues, rewind, warm spares.
- `thread-guards.md` — the guard set every CLI runs behind: secret/restart/git/check/route-import/claim guards and the folder gate in `lib/guards/` (`hooks.ts` the set, `decide.ts` runs it on one call, `ask.ts` what an ask becomes); Claude Code and puku-cli get it through `guardedCli()`, Codex and Goose through their own hooks posting to `app/api/guards/[cli]/[event]` (`lib/guards/codex.ts`, `goose.ts`, `hook.ts`); a turn whose guards can't be installed doesn't start.
- `composer.md` — the reply box's modes: `lib/reply-mode.ts`'s table of chip, primary and ▾ menu per state, and what's still planned (one dock for every ask, one server-side queue).
- `limits.md` — the three limit stores (the model's own cap, the CLI's weekly and 5-hour windows), the pure gate in `lib/limit-reset.ts`, the server-decides rule, the new-thread path that waits for a spent limit instead of failing, and the upgrade path that frees a model the moment the plan gives it room again.
- `questions.md` — a thread's AskUserQuestion end to end: the panel above the reply box, keys, previews in the pane, answers and `annotations` back to the CLI.
- `weft-worker.md` — the Weft Worker: a headless agent runner on a host (a Linux VPS, a Mac mini) that does the compute for a card while the board stays on the laptop or on the web at `<workspace>/board`; the `run` command kind, the `cloud_workers` registry and its heartbeats, the `cloud_worker_leases`, worker addressing, the **centralised guards** (the claim, yield and folder-grant authority in Supabase, keyed by repo-relative paths), the **service-key identity** and its Postgres role, the persistent-checkout-and-worktrees repo model, the bootstrap install on Linux or macOS (`apt-get` or `brew`, `systemd` or `launchd`), the worker pricing ($20 per worker per month, one included on Pro), and the twelve places a worker is not "the Mac, but headless" (the secrets, the pending permissions, the MCP tools).
- `skills.md` — skill sets: the library (Weft's, project, yours, plugins), a project's default set seeded from usage, a card's own, and how each runner gets it at session start; and the repo-analysis skill's four read-only scripts (size, import graph, docs drift, commit history).
- `subagents.md` — how threads delegate to subagents and how Settings → Models picks their model.
- `account.md` — the optional Weft account (Supabase Auth, PKCE, `weft://account-callback`, `~/.weft/account.json` in the Keychain).
- `teams.md` — workspaces, members, roles, email invites on weft.zip; the `requireOrg` gate and why it's not `@aimhuge/teams`'s.
- `teams-vault.md` — the shared 🔐 vault, step 4 of `secrets.md`; team shapes and what's built vs. design.
- `billing.md` — Free and Pro per workspace, `@aimhuge/billing`, PlanMeter, the admin console (plans, refunds, resets, Stripe mode per org), coupons and referrals, what's built and what's still TODO.
- `secrets.md` — the 🔐 vault: device key, on-disk encryption, IPC, Touch ID, agent tools, dev-server env, Supabase sync.
- `webhooks.md` — the 🪝 rail drawer, the `mcp__webhooks__*` tools, the relay URL, `webhook_deliveries` on Supabase.
- `vercel.md` — the ▲ rail drawer: token in the Keychain, `.vercel/project.json`, env push from the vault, deploys, `vercel_events` Realtime.
- `supabase.md` — the Supabase rail drawer: token in the Keychain, `supabase/.temp/project-ref`, state, unapplied migrations, the Migrate card.
- `cloudflare.md` — the orange-cloud rail drawer: API token in the Keychain, Worker/Pages links in `~/.weft/cloudflare-links.json`, wrangler `account_id` and deploys.
- `blastcp.md` — the BlastCP rail drawer: OAuth+PKCE, MCP-tool reads, `~/.weft/blastcp-links.json`.
- `connectors.md` — Settings → Connectors: CLIs your threads use for your own accounts; gog (Google Workspace) shipped in the toolchain, its OAuth client and browser sign-in.
- `simulators.md` — `mcp__simulator__*`: iOS simulators and Android emulators through simctl, adb and AXe, the live view in the pane, Settings → Connectors → Simulators.
- `site-notes.md` — shared notes about the sites the browser pane drives: the per-card trail, the after-turn Haiku capture, what `open_url` hands a card (wrapped as untrusted reference data), the local / team / public tiers on weft.zip (`site_notes`, `site_note_versions`, `site_note_reports`, service-role only), confirmation by 3 other users, staleness, and the scrub and safety pipeline.
- `agent-browser.md` — how threads drive the browser pane: the accessibility snapshot and its refs, real mouse and key input, hover, viewport sizes, and CDP console and network errors (`electron/pane-ax.cjs`, `pane-input.cjs`, `pane-keys.cjs`, `pane-cdp.cjs`).
- `crons.md` — crons: a thread run again on a schedule as a new card (fork or fresh), the ⏰ editors in the rail, thread header and New thread, run stacks on the board, the create_cron tools, and the two crons Weft runs for itself (the weekly repo analysis and the daily growth summary).
- `slack.md` — the Slack rail drawer: bot + app tokens in the Keychain, Socket Mode in main, commits/pushes (reflog), deploys and card status to a channel, `/weft` and @Weft start cards, weft.zip card links, a channel per kind of update, and growth (new user, new team, payment) with a daily summary.
- `puku-trial.md` — the puku trial: a puku thread with no Puku login runs through the deployed Weft's proxy on Weft's own key, day-long token, per-account daily cap.
- `goose.md` — the Goose backend: one `goose run` process per turn and its `stream-json` events, the provider catalog and the BYO key, the grant that puts the key in Goose's env without it ever reaching the board, and the per-card `GOOSE_PATH_ROOT`.
- `email-forwarding.md` — `weft.zip` mail → Resend → Svix-signed `email.received` → one inbox.
- `github-issues.md` — a project's open GitHub issues become Backlog cards, one direction, polled every 5 min, instant sync via the deployed relay.
- `project-seed.md` — a new project's starter Backlog: up to 6 parked cards (agent docs, Supabase migrations, your issues, failing checks, a TODO cluster), once per project, Re-seed from the project menu; the shared project-open hook.
- `mini-apps.md` — pages saved from the browser pane as tiles on the left rail below Services: `~/.weft/apps.json`, `/api/apps`, the pane's Save as app button, right-click menu, My mini apps on the profile, Share… at `weft.zip/a/<id>`, and public links' previews (title, description, branded card).
- `mini-app-hosting.md` — design, not built: React folder apps bundled by Weft and served from weft.zip with declared reads and cloud secrets ($0), and full Next.js apps on Weft-hosted Workers for apps that need server code.
- `growth.md` — 📈 Growth, Weft's own data app: which numbers it counts and why. The account-level reads (`supabase/migrations/20261018054110_growth_reads.sql`) and the in-app ones (`20261024041130_growth_in_app_reads.sql`: cards pushed per day, in-app engagement per day, and a retention table that counts an account as retained only if it pushed a card, moved one or ran a turn that week, rather than merely signed in). Versions: the signed-in Mac reports its version once a day (`lib/app-version-sync.ts` → `app_versions`, `20261029075755_app_versions.sql`) and `growth_versions` counts accounts per version.
- `r2.md` — Cloudflare R2 as the read copy of `weft-blobs`: Supabase stays where blobs are written, `lib/r2-mirror.ts` copies each object once (on a read that fell back, a daily cron, `pnpm r2:backfill`) and records it in `blob_mirror`; readers sign presigned R2 URLs after the same access checks, Supabase as fallback; rollback with `WEFT_BLOBS_R2=off`.
- `infra-live.md` — the live infrastructure read behind the repo-analysis report: the guarded route (`app/api/infra/live`), the Postgres side (`public.infra_live()`) and the Analytics-log egress read, and the bridge that lets a `file:` page ask for them without holding Weft's launch token.
- `tags.md` — ★ star and tags (the GitHub-label-style rules, the catalog in `~/.weft/tags.json`, the 🏷 drawer, pills on the card); replaced the library.
- `dev-servers.md` — Weft-owned dev servers and the rail's 🖥 Services drawer: `mcp__devservers__*`, why not Bash `run_in_background`, how the process tree is split and killed, the task strip's per-task Stop.
- `editor.md` — the open card's four columns (thread, editor, pane, show), the editor (CodeMirror, TipTap markdown with diff3 saves, Changes vs. HEAD), the files route and its safety, `weft:open-file`, inline diffs.
- `file-drop.md` — files dragged from Finder: the hand-off store, the window router, the `dropTarget` composers, why waiting files go in on the next task.
- `show-rail.md` — the browser pane's 72 px rail of one mini per turn and per page, its dots, fallbacks and browser history, and the two events that sync it with the chat.
- `board-view.md` — `mcp__board_view__*`: a thread's eyes and hands on the board window itself, fixed scripts, the token-guarded control server.
- `keyboard-shortcuts.md` — the shortcut registry, the `?` sheet, the printed sheet, tooltips, key badges, the `ModifierHint` component.
- `themes.md` — System/Light/Dark, a scene (one of Weft's pictures behind the board with its own palette), or a theme you prompted up.
- `web-states.md` — weft.zip's loading skeletons, host-aware error page, 404 and the shared pane's load/fail states.
- `error-boundaries.md` — `CrashGuard.tsx`, `BuildErrorBar.tsx`, the `guarded()` import wrapper, why a build error never reaches a boundary.
- `welcome-tour.md` — the welcome's narrated 96-second tour: three HyperFrames pages, the live player and beat messages, Kokoro voice and pad, the MP4 render for weft.zip.
- `welcome-dialog.md` — the welcome dialog itself: first launch vs. the replay preview, the steps and their chrome, and why a replay closes on Escape, the backdrop and ✕ while first launch does not.
- `feedback.md` — the feedback path behind the (now removed) footer dot: Haiku's interview (`lib/feedback.ts`, `app/api/feedback`), the summary-only wrap-up, the copy in `~/.weft/feedback`, and weft.zip's collector (`lib/feedback-send.ts`, `app/api/feedback/collect`) that stores it in `public.feedback` and posts it to the team's Slack webhook. The dot that used to open it is gone from the board; the collector needs both halves up (the table applied and the webhook on Vercel) or a summary reaches weft.zip and no channel.
- `feature-intros.md` — the narrated video each tool drawer, the New thread dialog (in the browser pane, `lib/pane-intro.ts`; the pane shows the splash with rotating tips from `lib/new-thread-tips.ts`, each drawer's with ▶ Watch), the code quality dialog and the leagues play on ▶, never on their own: the pages in `public/intros/`, the splash poster every one opens on (the feature's own icon, its name and one line about what it does), `pnpm intros:narrate`, the render (`pnpm intros:render` / `pnpm intros:encode` / `pnpm intros:verify`, `scripts/render-intros.mjs`, `scripts/encode-intros.sh` and `scripts/verify-intros.sh`) and the blank-frame trap that makes a broken render look finished, when `useFeatureIntro` opens one (big, in a ¾-window modal that shrinks into the drawer and plays on; a click pauses it, and so does a dialog or achievement opening over it, `lib/intro-cover.ts`), the seen set in `localStorage` and Reset tips.
- `gamification.md` — the header's 🔥 chip and "Your loom" dialog: streaks, XP, badges, the builder card, the production-ready tree.
- `quality.md` — the header's code quality checklist: coverage, file size, lint, types, guardrails; the refactor scout and the score's last 10 points.
- `commit-pile.md` — the header's "+N/-N" uncommitted counter and the Review card that walks the pile to a clean commit.
- `updates.md` — the Squirrel.Mac JSON feed, the download fallback, the tag-triggered signed release, `CHANGELOG.md` notes.
- `changelog.md` — every project's changelog in `~/.weft/changelog.jsonl` and `changelog_entries`: the `mcp__board__changelog_*` tools, the commit stamp, the Changelog dialog, releasing into CHANGELOG.md.
- `keep-working.md` — the menu bar icon's switch to keep the Mac awake with the lid shut so threads keep running in a bag.
- `analytics.md` — GA4 and PostHog on every weft.zip page after the visitor's consent, never on a local board: the consent banner, the host and `isDeployed()` gates, `track()`, the event table, `data-track` links.
- `faq-site.md` — `docs/FAQ.md` as the weft.zip FAQ: the home page's six questions, `/faq` rendering the whole file, how GitHub-shaped paths, image rows and heading ids map onto the site.
- `marketing-site.md` — the weft.zip home page's own sections: the content split across `lib/home.ts` / `lib/home-release.ts` / `components/home/*`, the pricing section reading its prices off the billing catalog, `loadHome()`'s parse-error fallback, and `data-track`.
- `cloud-sync.md` — server-side cards: the outbox, the content-addressed blob store, thread paging, the `cloud_*` tables and their policies.
- `profiles.md` — public profiles at `weft.zip/@username`: `profiles.username`, the `/@` → `/u/[username]` rewrite, what the page shows and never shows.
- `sharing.md` — a card's share link on weft.zip: thread + pane, live; the `@aimhuge/share` modes and gate, `cloud_shares`, the sandboxed pane, redaction.
- `copilot-suggestions.md` — the copilot's empty-chat chips: what Haiku reads, the one run per board labeled by project, the client filter, setup gaps and `setup_status`.
- `limits.md` — the three limits a thread can meet (the model's own cap, the CLI's weekly and 5-hour windows), their stores, the start gate and the plan-upgrade path (`lib/limit-upgrade.ts`).
- `limits-burndown.md` — the status strip's `5hr` / `7d` hover chart: a week of 15-minute bars for the 5-hour limit left against the weekly one, and why each CLI has its own plan.
- `worktrees.md` — isolated cards, the opt-in git worktree per card: its CLI, Bash, dev server and commits live there, and Done lands its branch back.
- `copilot-initiative.md` — the copilot's check-ins: when it speaks first (a morning idea, a refactor after work lands), the caps, QUIET, the launcher's dot and the off switch.
- `copilot-personas.md` — the copilot's personas (Wingman, Founder, Captain): the prompt each adds, the lane header picker, why a switch starts a new chat.
- `agents.md` — a card's agent: the soul that opens its system prompt and the skills it turns off (Builder, Weft's own; Copywriter, Weft's voice; yours from Settings → Agents): editing and resetting built-ins from GitHub, each project's default, the pickers, why agents skip spares.

When a new doc lands in this folder, add it here on the same change.

## File map

- `electron/main.cjs`: shell; starts Next, windows, tray, dock, `weft://` links, global hotkey;
  `electron/startup-screen.cjs` runs the start screen and shows why the board didn't load (Retry, Logs, Quit);
  `electron/startup-timer.cjs` times every launch into `~/.weft/startup.jsonl` (`node electron/startup-timer.cjs` lists them).
- `electron/browser-pane.cjs`: native browser pane, one page per card; token-guarded control
  server on 127.0.0.1 for agents, IPC for the board (`electron/preload.cjs`); `electron/pane-pages.cjs`
  saves each card's page to `~/.weft/pages/` so it comes back after a restart. `electron/pane-visibility.cjs`
  holds the rule for when the pane shows: opening a card brings it back, even with no page loaded yet
  (the board's placeholder fills the slot meanwhile), and the board alone hides it. `electron/pane-origins.cjs` is the
  per-card allowlist of hosts a thread may open; a host outside it asks the user with Touch ID (`authorizeThreadOpen`).
  `electron/pane-error.cjs` shows a failed load's reason, with Try again and Back, instead of Chromium's blank page.
  `electron/pane-cdp.cjs` is each page's one CDP session (console and failed-request buffers); `electron/pane-input.cjs`
  drives the page through it (trusted click, keys, type, select, scroll, wait, viewport, snapshot routes) with
  `electron/pane-ax.cjs` (the accessibility outline and its refs), `electron/pane-keys.cjs` and `electron/pane-element.cjs`
  (the one way a page's element is found, by ref or selector) with `electron/pane-selector.cjs` (the selector compiler:
  CSS plus Playwright's text pseudo-classes like `:text-is("Settings…")`; docs/architecture/agent-browser.md).
  `electron/pane-escape.cjs` decides which key the pane replays into the board: a focused page swallows
  the keys the board never sees, so Escape is replayed there, where it closes the newest layer (and with
  nothing open, flips board and list view). Escape types nothing, so it arrives as a rawKeyDown — the
  rule takes that too, or the board never hears the key.
- `electron/menus.cjs` + `electron/keep-working.cjs`: app menu, menu bar icon, dock; Keep Working (awake with the lid shut, until threads finish).
- `electron/updater.cjs` (+ `electron/update-window.cjs`, the Software Update window) + `scripts/release-feed.mjs` + `.github/workflows/release.yml`: updates from GitHub Releases (Squirrel.Mac's JSON
  feed, a download fallback when unsigned, a quiet install once nothing runs and nobody's at the Mac) and the tag-triggered signed release; `CHANGELOG.md` holds each version's notes, which Weft commits itself after a version bump (docs/architecture/updates.md). `lib/release-splash.ts` + `lib/release-splashes.json` + `lib/use-release-splash.ts` + `components/ReleaseSplash.tsx` + `scripts/release-splash.mjs`: the "What's new" splash shown once after an update, written by the Copywriter at release time. `.claude/skills/release/SKILL.md`: the repo-only `/release` run (commit, bump, splash, tag, build on a mini, publish, check weft.zip).
  `scripts/bundle-toolchain.mjs` stages what the app ships for a fresh Mac (node, npm, pnpm, puku-cli without telemetry, claude, all on
  my own Electron, plus gog, the checksum-pinned Google Workspace CLI), which `appendToolchain()` in `electron/env.cjs` puts at the end of PATH.
- `electron/folder-access.cjs` + `lib/folder-access-tool.ts`: `mcp__board__request_folder_access`, called by a thread that got "Operation not permitted" on
  Downloads, Documents or Desktop (never on launch): lists the folder so macOS shows its allow prompt, else a dialog with an Open Settings button.
- `lib/worktrees.ts` + `lib/worktree-pool.ts` + `lib/worktree-deps.ts` + `lib/worktree-start.ts` + `lib/worktree-land.ts` + `lib/worktree-done.ts` + `lib/worktree-port.ts` + `lib/work-dir.ts` + `lib/use-isolate.ts` + `lib/use-branches.ts` + `lib/branch-name.ts` + `components/IsolateMenu.tsx` + `app/api/worktrees`:
  isolated cards, opt-in: `card.isolated` / `card.worktree` / `card.worktreeBranch` (a branch picked or named in the New thread dialog's isolate menu), a worktree under `~/.weft/worktrees/<repo>/<id>` on `weft/<slug>` from a warm pool (APFS clone of node_modules, offline install; ~20 ms to take), held first send (`sendMessage` → `isolate`), `workDir(card)` for the CLI, claims, `!` shell and dev servers (own `PORT`), the folder gate's fence and the git guard's own-worktree rule, and landing on Done (`settleWrapUp`/`archiveWhenIdle` → `hooks.land`: commit, rebase, `merge --ff-only`) (docs/architecture/worktrees.md).
- `lib/folder-guard.ts` + `app/api/folders`: the folder gate, a PreToolUse hook that asks before a file tool or Bash command reaches outside the card's project (Allow once / This card / Always, `settings.allowedFolders`; Settings → General's **Trusted folders** row adds one through the same POST and `DELETE` on that route is the revoke, since "Always" is otherwise a one-way door); in every thread via `guardedCli()` (docs/architecture/thread-guards.md).
- `electron/terminal.cjs` + `components/TerminalDrawer.tsx`: the terminal drawer (node-pty shell over IPC, xterm.js).
- `lib/card-repoint.ts`: the one rule for re-pointing a card that is already running — refuse while a turn is
  running, end the CLI's session, then patch the card. The order is the point: the session's wind-down can write the
  card's session id and stats back, so the patch comes last. Its callers keep the runner they already reach for
  (`lib/backend-switch.ts` through `runner-state`'s hooks, the card route through `lib/runner.ts`).
- `lib/card-starter.ts`: the one way to start a card to do one thing — make it, let the caller set it up, then start
  its first turn. The setup step is where a Slack card is posted to its channel and saved (`lib/slack-inbound.ts`), so a
  turn that fails at once lands in the card's own thread rather than opening a stray one; the theme card
  (`lib/custom-themes.ts`) and the cloud inbox (`lib/cloud-inbox.ts`) start their cards the same way.
- `lib/runner.ts`: one Agent SDK `query()` per Claude Code or puku thread, its public API (send, queue, stop, retry, login); Codex uses `lib/codex-runner.ts` with `codex exec --json` and resumes by session id. Behind it
  `lib/runner-state.ts` (sessions, shared maps, `hooks` back into runner.ts: the modules below it, `lib/backend-switch.ts` and `lib/classifier-denial.ts` among them, send, end and re-point a thread through `hooks.send`/`endSession`/`setModel`, so nothing imports runner.ts back and no load-time cycle runs through it), `lib/done-override.ts` (puts back the model a Done move swapped in), `lib/runner-session.ts` (start and drive a CLI,
  warm spares, the BUILD fingerprint), `lib/runner-turn.ts` (what the CLI sends during a turn; `lib/runner-tasks.ts` writes a `<task-notification>` row when a background task ends) `lib/runner-steer.ts` (a message sent mid-turn goes into the CLI, which takes it in after its next tool call; docs/architecture/threads-and-sessions.md#mid-turn-messages) and `lib/runner-ask.ts` (permissions; an MCP server's elicitation, such as the Supabase MCP confirming destructive SQL, comes to Needs you through `onElicitation` in `lib/elicitation.ts` with its form in `components/ElicitationForm.tsx`, docs/architecture/thread-guards.md#mcp-elicitations; auto mode's classifier denials, which never reach `canUseTool`, are asked about after the turn by `lib/classifier-denial.ts`: **Allow once and retry** / **Keep denied**, docs/architecture/thread-guards.md#auto-modes-classifier-denials);
  puku-cli via `pathToClaudeCodeExecutable` (`lib/cli-path.ts`), whose gateway drops the system prompt, so its first message carries
  the folder, CLAUDE.md/AGENTS.md and Weft's prompt instead (`lib/puku-context.ts`); every CLI starts in its own process group so its children end
  with it (`lib/cli-process.ts`), and `lib/cli-reaper.ts` ends the orphans a killed server left behind. The init's model plus the effort (the card's, else `effortLevel` from the CLI's settings, `lib/cli-defaults.ts`)
  land in `stats.runsOn`, which the header's CLI chip shows (`BackendBadge`). `editLastMessage()` is ↑ in the reply box: it rewinds the
  session to before your last message (`lib/edit-last.ts`, `lib/rewind.ts`) and sends the edit.
- `lib/goose-runner.ts` + `lib/goose-recipe.ts` + `lib/goose-runner-events.ts`: Goose (the Rust CLI agent from Block), our fourth
  backend and the first whose model you bring yourself — a turn is one `goose run` process (`lib/runner-session.ts` `driveGoose`, no
  spare to keep warm) reading `--output-format stream-json` on stdout, one JSON object per line, parsed into four kinds (message,
  notification, error, complete; a notification is told apart by the `progress` key it carries, since Goose's own payload has no tag).
  Goose's `run` takes one input — `--text`, `--instructions` or `--recipe`, mutually exclusive — so a Weft turn is `--text` plus
  `--system`, and the recipe is rendered beside it for reproducibility, not run: `lib/goose-recipe-store.ts` writes it once per turn,
  before Goose starts and from the same plan and prompt the argv is built from, under the card's own Goose state root
  (`lib/goose-state.ts`: `~/.weft/goose/<card id>/recipes/turn.yaml`) — in Weft's space, never in the user's working tree, and a failed
  write never fails the turn. The provider key never reaches the board: the server
  asks Electron main for a one-time grant over the control server and `electron/goose-env.cjs` starts Goose with the key in its env
  (`lib/goose-launch.ts`, `electron/goose-ipc.cjs`, `electron/goose-token.cjs`), so the plaintext path is main's Keychain → the
  helper's env → Goose's env, and the recipe is a prompt, not a policy (docs/architecture/goose.md). A provider can take
  a custom endpoint (the catalog's `extraEnv`: Anthropic's `ANTHROPIC_HOST`, Azure's endpoint, LiteLLM's host) and a typed
  model id (`freeModel`), and the drawer's **Puku** button sets all three for Puku's gateway in one save
  (`lib/goose-provider.ts` `PUKU_GOOSE`, `lib/use-goose-selection.ts` `setAll`).
  Goose has **no `goose auth`**: its status is `goose info --check`, a provider check whose "Provider/Model/Auth" lines are read for a
  configured, working key (`lib/login-status.ts` `parseGooseStatus`), and its login is the interactive `goose configure` wizard, which
  needs a real TTY — so, like Codex, it opens in a Terminal window (`lib/login.ts`, `lib/login-terminal.ts`).
  A Goose card runs its own model (`lib/runner-state.ts` `specFor`; the Settings model only fills in "Your BYOK model"), its
  subagents are Bash `goose run --text` calls that inherit `GOOSE_PROVIDER`/`GOOSE_MODEL` from `gooseEnv()` (`lib/subagents.ts`
  `GOOSE_DELEGATE`, no Agent tool), and its commits are signed `Co-Authored-By: Goose (<model>) on Weft` through its system
  text (`lib/attribution.ts` `gooseAttributionPrompt`), since Goose has no attribution setting.
  The models a user named in Settings → Models → Bring your own key (`gooseNamedModels`, owned by `lib/goose-models.ts`) show
  by name in every model menu, with their id beside them. **A name says "this runs on Goose"** — the names are a Goose list, so
  a name outranks a shared list naming the same id ("puku-ai-2.8" is puku-cli's own, but named there it runs on Goose) and the
  row's picker value carries the `goose:` prefix, which `bareModel()` takes off before the id reaches the CLI.
  A notification carries no structured payload, so the files a Goose turn touched are read out of its progress text
  (`lib/goose-progress-paths.ts`, a pure function of the string): a run of path characters with a separator or an extension, never a flag
  or a URL, and no trailing sentence period. The runner keeps only the paths that resolve inside the card's own folder and folds them
  into `card.touchedFiles`, so the overlap warning sees what the turn actually touched.
- `lib/env.ts` `guardedCli()`: Claude Code and puku-cli's CLI env and Bash guards: `lib/secret-guard.ts` (no .env reads; the
  rules live in `lib/secret-guard-files.ts` — a `.env`, the `~/.weft` data folder (save `~/.weft/show/`, the pages threads
  render in the pane), the CLI's own `~/.claude` transcripts —
  `lib/secret-guard-bash.ts` for the shell, and `lib/secret-guard-tool.ts` for the file tools (Read, Edit, Write, Glob,
  Grep and LS — a thread that may not read a .env may not write, glob or list one either); `lib/shell-parse.ts` is the
  parser behind them, with `lib/shell-quoting.ts` spelling a word (a `$(…)` substitution's path-like words, ANSI-C
  quoting), so `cat $(echo .env)` is the same read as `cat .env`),
  `lib/restart-guard.ts` (no restarting Weft mid-turns), `lib/git-guard.ts` (no `git stash`, `reset --hard`, path
  checkout/restore or `clean -f` in the shared tree), `lib/check-guard.ts` (no `tsc` or `eslint` run directly where the
  project's `pnpm typecheck`/`pnpm lint` take turns through `scripts/one-at-a-time.mjs`; plain Claude Code sessions get it from `.claude/settings.json`), `lib/route-import-guard.ts` (refuses an edit that makes `app/**/page.tsx`,
  a layout, a `route.ts` or middleware import a module that isn't there yet, or export a segment config cacheComponents refuses; `lib/prerender-check.ts`), `lib/claim-guard.ts` (symbol claims: asks before an edit to a top-level
  symbol another busy card is editing, with **Wait** until it lets go, `lib/permission-wait.ts`, or **This first** / the holder's **You first** to put the held card ahead, `lib/precedence.ts` + `lib/yields.ts` + `lib/waits-on.ts` + `components/YouFirst.tsx`, with both cards' faces on the prompt, `components/CardFace.tsx`; `lib/claims.ts`, parsed by `lib/symbols.ts`; the prompt's readable diff and reason chip are `lib/edit-preview.ts` + `components/PermissionInput.tsx`; a card other cards are waiting on carries a "blocking N" chip, `components/BlockingMark.tsx` + `lib/waits-on.ts`, and the write that lands releases the waiters, `lib/blocking.ts`; a wait never closes a loop, so two cards can't wait on each other and gridlock: the card goes ahead instead, `lib/wait-chain.ts`), and for Bash `lib/bash-claims.ts` (asks before a line that writes a claimed file, claims what Bash wrote while no other card's Bash ran (`lib/bash-writers.ts`; else the writer is unknown and nobody claims it), drops claims on files `git status` sees clean, tells a failed check which failures are another card's: `lib/bash-writes.ts`, `lib/dirty-files.ts`, `lib/failure-owners.ts`) (docs/architecture/thread-guards.md). The two guards share the flow itself — read the card, prune the yields, look for a clash, ask — in `lib/claim-hooks.ts`; they differ only in how the claim keys are worked out.
  Codex gets the filtered `cliEnv()` but not these per-tool hooks; `lib/codex-runner.ts` asks it not to read `.env` files. It does get
  Weft's MCP tools, over HTTP: `lib/weft-mcp.ts` builds the servers every CLI gets, `lib/mcp-bridge.ts` opens a per-turn token and
  `app/api/mcp/[server]` serves them to `codex exec --config mcp_servers.*`. Puku and Codex don't read `.claude/skills` or Codex `CLAUDE.md`,
  so `lib/skills.ts` `skillIndex`/`skillInvocation` list a folder's skills and expand `/name`, and `lib/puku-context.ts` sends Codex the project's `CLAUDE.md`. `cliEnv()` also drops secret-named and key-shaped variables from your shell's env (`lib/secret-detect.ts`), and the loader hooks (`NODE_OPTIONS`, `LD_PRELOAD`, the `DYLD_*` family) by name whatever they hold; the control
  server's token is a 0600 file, `~/.weft/shell-token` (`electron/shell-token.cjs`, read by `lib/shell-token.ts`), never an env var.
- `scripts/check-staged.sh` + `scripts/secret-scan.mjs` + `scripts/staged-imports.mjs`: the pre-commit hook; gitleaks, or without it Weft's own key shapes on each added line,
  then a staged file importing an untracked one (named), then tsc and eslint on a copy of the index (docs/architecture/thread-guards.md). The git guard refuses `--no-verify` and moving `core.hooksPath`.
  The Composer flags a pasted or typed key the same way (`components/SecretPaste.tsx`).
- `lib/changelog.ts` + `lib/changelog-tool.ts` + `lib/changelog-stamp.ts` + `lib/changelog-files.ts` + `lib/changelog-git.ts` + `lib/changelog-write.ts` + `lib/changelog-sync.ts` + `lib/changelog-render.ts` + `app/api/changelog` + `components/ChangelogDialog.tsx`:
  every project's changelog, kept by Weft instead of a CHANGELOG.md every card edits at once. A thread records what it shipped with
  `mcp__board__changelog_add` (an append-only `~/.weft/changelog.jsonl`, mirrored to Supabase `changelog_entries` while signed in); the entry names its card,
  the card's commit that touches its files stamps its sha (draft → committed, `changelog_edit { sha }` corrects one; a Bash hook in `guardedCli()` and the commit walk-through), and right after it
  Weft writes and commits CHANGELOG.md alone, in the background; a commit that bumps package.json's version gets that version's section.
  Nobody runs a release step (`pnpm changelog:release`, `lib/changelog-release.ts`, is only for a bump Weft didn't see). The read-only dialog opens from the project menu and the palette (docs/architecture/changelog.md).
- `lib/schedule.ts` + `lib/scheduler.ts` + `components/SendLater.tsx`: "Send later" replies; the server sends them at their
  time, by default the next 5-hour reset. A message held on a card waits for a reason — the restart, the card's own turn, a free
  thread slot, or a time the user picked — and `lib/scheduled-hold.ts` is the one place that writes it, so the flag saying when it
  goes lives in one file. The server's polls run on `lib/tick-clock.ts`, the one 15-second clock the scheduler and the crons share.
- `lib/cron-schedule.ts` + `lib/crons.ts` + `lib/cron-run.ts` (+ `lib/cron-store.ts`, `lib/cron-tools.ts`, `lib/cron-form.ts`, `lib/cron-stacks.ts`,
  `lib/cron-fold.ts`, `components/CronButton.tsx`, `CronsDrawer.tsx`, `CronSwitch.tsx`, `CronStack.tsx`): crons, a thread run again on a schedule, each run a new
  card forked from the source (`Card.forkOf` → `forkSession` in `specFor`) or fresh; the rail's ⏰ drawer and the stacked runs
  (docs/architecture/crons.md).
- `lib/thread-slots.ts` (+ `maxThreads()` in `lib/settings.ts`, `holdSend` in `lib/runner.ts`, `freeSlots` from the turn end and `lib/scheduler.ts`):
  the cap on threads running at once; docs/architecture/threads-and-sessions.md#cap-on-running-threads.
- `lib/shell.ts` + `lib/bang.ts` + `app/api/cards/[id]/shell`: `!` in a reply box runs a shell command in the card's folder; its
  output shows in the thread (`ShellLine` in `components/ThreadItems.tsx`) and goes to Claude with your next message.
- `lib/status.ts` + `lib/settings.ts`: the BOARD STATUS protocol (thread prompt and its parser).
- `components/QuestionForm.tsx` + `components/QuestionParts.tsx` + `lib/question-answers.ts` + `lib/question-keys.ts` +
  `lib/question-preview.ts`: a thread's AskUserQuestion, asked the Claude Code way above the reply box, whose composer is its
  one input (own answer or a note, sent as `annotations`); option previews open in the card's browser pane; text typed on the
  Submit tab goes with the answers as a note on all of them (`buildReply`'s `general`).
  A send, number key or click in the first 800 ms (`ARM_MS`) is held, a rejected `onAnswer` re-enables the form, and Skip / Chat about this decline it (`onDecline`, docs/architecture/questions.md).
- `lib/reply-mode.ts` + `components/ReplyButtons.tsx` + `components/ReplyModeChip.tsx`: the reply box is in one mode at a time
  (Send, Queue, Answer, Run, Replace, Send fresh when the cache is cold, Send at the reset when the 5-hour window is used up), named on a
  chip in the box and on its primary, with the rest in a ▾ menu, a Done button while idle and ■ Stop in its own slot (docs/architecture/composer.md).
  `lib/lost-session.ts`: a card whose CLI session is gone restarts through Send fresh instead of failing every message.
  `lib/splice.ts` + `lib/splice-brief.ts` + `lib/splice-diff.ts`: Send fresh, a new CLI session in the same card started from a brief
  (Haiku summary pre-baked on the scheduler's tick, what's open, the diff of the thread's own edits) instead of re-sending a cold history.
- `lib/limit-reset.ts` + `lib/start-gate.ts` + `lib/use-start-gate.ts`: one answer for "when does this reset?", for every limit a thread
  can meet — the model's own cap (`~/.weft/model-limits.json`), the CLI's weekly window and its 5-hour window (`~/.weft/limits.jsonl`).
  Pure and read as data, so the server (`lib/start-gate.ts`) and the browser (`/api/limits/plans`) agree. A new thread on a spent model
  doesn't get its first turn now: the New thread dialog's button reads "Start at 2:30am" and `startCard` (`lib/new-card.ts`) schedules
  the prompt for the reset instead of starting a thread that dies in Needs you. The reply box reads the same gate, so a model's own cap
  reaches it too (docs/architecture/limits.md).
  The plan limits are **per CLI** — each CLI has its own plan (Claude Code on Anthropic's subscription and reads the claude.ai account's
  windows, puku-cli on Puku's and has no Anthropic plan limit), so the strip's numbers and the chart's history are the open card's CLI's
  own, and a puku thread is never gated by Claude Code's spent window. `lib/plan-pools.ts` is where that mapping lives
  (docs/architecture/limits.md, docs/architecture/limits-burndown.md).
  `lib/limit-kind.ts` sorts a hit into the plan's window or one model's own cap: the SDK names which
  (`five_hour`/`seven_day` are the plan's, `seven_day_opus`/`seven_day_sonnet` are a model's), and a per-model
  cap is kept out of the plan log so it gates that model alone — filed as a plan window it gated every model on
  the plan, and picking another model in the composer changed nothing.
  `lib/limit-upgrade.ts` is the other half: a plan upgrade leaves the per-model caps stale, so it compares the
  CLI's per-model weekly windows against the caps Weft holds and frees the ones whose window has room again and
  is still open — from the 15-minute poll (`lib/limit-poll.ts`, which then wakes the cards parked on them via
  `lib/limit-resume.ts`) and from a card's own turn (`lib/runner-turn.ts`).
- `components/SettingsDialog.tsx` + `lib/settings-nav.ts`: Settings, full window over a scene, pages down the left (General, Laptop mode, Models,
  Threads, Security, Automations, Shortcuts, Accounts, Teams, Sync); Laptop mode is `components/LaptopModeCard.tsx` + `LaptopModeRules.tsx` over `electron/keep-working*.cjs`; Models holds every model pick, new threads' through `components/NewThreadDefaults.tsx`;
  the settings themselves live in `lib/settings.ts` (the front every caller imports), with the model picks in
  `lib/settings-models.ts` and the file on disk and its read/write pair in `lib/settings-store.ts`;
  the four rows (NewThreadDefaults, SubagentPicker, CopilotPicker, DonePicker) share `components/Pickers.tsx`
  (`ModelPicker`, `EffortPicker`) on top of `components/ModelSelect.tsx`, every model menu in Weft: one group per CLI ("Claude Code", "puku-cli", "Codex", "Goose") driven by `MODELS` in `lib/new-thread.ts`. **No row lets the CLI choose** — every row is a model, and a menu with nothing picked shows the model that CLI runs; the two CLIs whose model lives in their own config (Codex, Goose) each keep one row for it ("Codex’s configured model", "Your BYOK model"), and a `cli` prop makes that row move the thread to its CLI, so the New thread dialog and Settings → Models → New threads have no separate CLI control. The Goose group's rows are the **chosen provider's** own models (`gooseModelsFor` in `lib/goose-provider.ts`) plus the ones the user named (`components/GooseNamedModels.tsx`, Settings → Models → Bring your own key), each provider serving its own ids — OpenRouter's `anthropic/claude-opus-4.1` is not Anthropic's `claude-opus-4-1` — and a Goose row's picker value is prefixed `goose:` so it can't be mistaken for another CLI's same id (`lib/new-thread.ts` `gooseValue`/`bareModel`). `components/ModePicker.tsx` is a menu, not a native select, so each permission mode shows what it does under its name.
  Every model any CLI serves is on offer in every one of them, and picking a model moves the card to the CLI
  that serves it (`lib/backend-switch.ts`), and a changed default reaches an open New thread dialog at once through
  `subscribeDefaults` (`lib/new-thread.ts`, `lib/use-new-card-dialog.ts`). The menu itself is a combobox
  (`components/ModelTypeahead.tsx`), not a native select: it can be typed into, searches every CLI's rows at once
  (by label, by id, by the id in the row's value), and closes on a pick.
  Security (`components/SettingsSecurityPage.tsx`) holds the default permission mode and `components/TrustedFolders.tsx` (the folders threads may read outside their project, from `SettingsView.allowedFolders`, each revocable through `DELETE /api/folders`); Security also holds `components/TokenExpiry.tsx` (when each saved sign-in runs out, reusing `expiryNote()`; only BlastCP expires, and only the expiry crosses from main — the tokens stay in the Keychain; a BlastCP sign-in made through your Weft account renews itself, one made in the browser never re-consents quietly).
- `components/DbSelect.tsx` + `lib/db-picker.ts` `rankItems`: the one "Link <folder> to…" picker every provider drawer shares
  (▲ Vercel, Supabase, Cloudflare, 🚀 BlastCP — `components/VercelPicker.tsx`, `SupabasePicker.tsx`, `CloudflarePicker.tsx`, `BlastcpPicker.tsx`).
  `DbSelect` draws the search box, the loading/empty notes and the row list; each picker supplies its rows, its own score
  (`matchScore` in its `*-view.ts`) and its row markup (`DbRowLines`), and `rankItems` does the shared filter-then-sort. A fifth
  provider is one file that calls it, not another list UI to write. `lib/db-picker.ts` also owns the two helpers all four view modules
  used to carry byte-identical copies of — `norm` (the name comparison behind every `matchScore`) and `shownFolders` (the drawer's
  top-bar-project-or-all filter) — plus the `Tone` type the providers' `STATES` maps and `components/tone.ts`'s `TONE` palette share.
  `components/TokenForm.tsx` is the same idea one layer up: the paste-a-token form ▲ and Supabase use, and `components/tone.ts`
  (`TONE`, `SMALL`, `LINK`, `BODY`) the class strings they all shared. Cloudflare's two-step setup-token form and BlastCP's OAuth sign-in
  stay their own components — they aren't that shape. `components/FolderRow.tsx` is the same story for the linked-folder row all four
  of those drawers draw (the bordered card, the folder name with its Link/Unlink buttons, the unlinked line, the red line for a link
  that failed to read); each supplies its own details as children and Supabase its third "Link CLI…" button. GitHub's drawer keeps
  its own row — it has no Link/Unlink pair and no link object, just a sync switch.
- `components/BackupModelPicker.tsx` (`backupModel`): Settings → Models → Backup model. The model the first-message-failed banner reruns the card on
  (when the very first turn came back with an error — a rate limit, mostly), and the model every thread moves to when the model it was on has hit its limit.
  Any model any installed CLI serves, plus an "Off — no backup" leading option
  that hides the Rerun button. Behind it `lib/backend-switch.ts` `rerunOnModel` clears the session on a model change and `sendMessage`s the last user
  message with `echo: false`; `app/api/cards/[id]/rerun-model` is the route, the banner (`components/FirstMessageErrorBanner.tsx`) is the only caller.
- `lib/model-limit.ts` + `lib/model-fallback.ts`: which model hit which limit, and where a thread goes instead. Plan limits are per model
  (Opus has its own weekly cap, Sonnet another), so `lib/rate-limit.ts` records the hit per model in `~/.weft/model-limits.json` and the pickers mark a
  used-up model ("— at its limit"). A cap is cleared when its own window passes — or when the PLAN changes: `lib/limit-upgrade.ts` compares the CLI's
  per-model weekly windows (`seven_day_opus`, `seven_day_sonnet`, `model_scoped[]`) with the caps Weft holds and frees the ones whose window has room
  again and is still open, from the 15-minute poll (`lib/limit-poll.ts`, which then wakes the cards parked on them) and from a card's own turn
  (`lib/runner-turn.ts`). `fallbackFor` moves an exhausted model to the user's backup (across CLIs, if need be), and every thread kind asks it:
  the New thread dialog (`lib/use-new-card-dialog.ts`), a running thread (`lib/runner-turn.ts`), the copilot (`lib/copilot.ts`), the Review all card
  (`lib/use-board-actions.ts`) and the `/weft:done` wrap-up (`lib/automations.ts`). With no backup set, Weft never guesses a model the user didn't pick.
  The reset a limit message names is read in the zone the message names, on that zone's own calendar day — "resets 1:00am (Asia/Bangkok)" at 2am
  Bangkok is tomorrow's 1am, not yesterday's — so the window ends when the CLI says it does.
- `lib/subagents.ts` + `components/SubagentPicker.tsx`: when threads delegate to subagents and on which model (Settings → Models → Use for subagents,
  any model any CLI serves: forced through `CLAUDE_CODE_SUBAGENT_MODEL` / `PUKU_CLI_SUBAGENT_MODEL` on its own CLI, a headless `-p` run on the other).
  `lib/tasks.ts` + `lib/task-ledger.ts` + `lib/tasks-view.ts` + `components/TaskStrip.tsx`: each thread's subagents and background commands from the CLI's
  task events, on `card.tasks` (the strip above the reply box, ⑂N on the card); idle CLIs with live ones stay open, and ones a CLI exit cut off are named to the thread's next message.
- `lib/automations.ts` `doneOverrides` + `components/DonePicker.tsx`: Settings → Models → Run /weft:done on picks the model (any model any CLI
  serves) and effort `/weft:done` uses on a Done move; both model menus are `components/ModelSelect.tsx`; `app/api/cards/[id]` moveCard snapshots the card's own picks into `preDoneModel` /
  `preDoneEffort` (and `preDoneBackend`, when the backup moved the card to another CLI) and `lib/runner.ts` `restoreDoneOverride` puts them back after the wrap-up.
- `components/ReviewAllPicker.tsx`: Settings → Models → Review all picks the model of the Review column's "Review all" card (`reviewAllModel`, any model any CLI serves;
  `Board.tsx` `reviewAll` reads it at click time and the card starts on the CLI that serves it).
- `components/CopilotPicker.tsx`: Settings → Models → Copilot picks the model the copilot thread runs on (any model any CLI serves). The pick is read once when the
  card is first made (`lib/copilot.ts` `ensureCopilot`), so it takes effect on the next "New chat" in the copilot lane; with no pick, the copilot runs on
  whatever its CLI chooses, or the model you last picked for new threads (`lib/new-thread.ts` `modelFor`).
- `lib/puku-dotenv.ts` + `plugin/env/puku-bash-env.sh`: puku-cli is a Bun binary that loads the `.env` files of its folder, so a project keeping its own `PUKU_AI_API_KEY` there (BlastCP) made puku threads "Not logged in" while `auth status` said logged in. A puku thread starts with each Puku sign-in variable you didn't set as blank (Bun skips a set one), and `PUKU_CLI_ENV_FILE` unsets the blanks before each Bash command so the project's own tools still read its `.env`; joined in by `backendEnv` (`lib/puku-idle.ts`).
- `lib/puku-trial.ts` + `lib/puku-trial-token.ts` + `lib/puku-proxy.ts` + `lib/puku-proxy-usage.ts` + `app/api/puku/*`: the Puku trial (`reserve` holds what a request could cost before it goes out, against the account's and the whole trial's daily caps, `puku_trial_global_usage`; `metered` charges a reply however it ends, so a client that hangs up still pays); a puku thread with no Puku
  login, while you're signed in to Weft, runs through the deployed Weft's proxy on Weft's own key (signed day-long token read by puku's
  `apiKeyHelper` from `~/.weft/puku-trial-token`, per-account daily cap in `puku_trial_usage`; docs/architecture/puku-trial.md).
- `lib/billing/*` + `lib/billing-actions.ts` + `app/[orgSlug]/billing` + `app/api/billing/*` + `components/BillingStatus.tsx`:
  Free and Pro per workspace (@aimhuge/billing; Pro meters Puku tokens in the proxy through PlanMeter; docs/architecture/billing.md).
  Open Source and Education are $0 plans granted for 12 months (`lib/billing/grants.ts`; the end lives in `trial_end`); the sign-in callback runs the GitHub check
  (`lib/billing/oss.ts` bar: active OSI-licensed public repo, 25 stars or 20 commits in 90 days; `lib/billing/oss-grant.ts`; the billing page's **Check my GitHub now**
  is `checkOpenSourceNow`). Regional Pro (`lib/billing/regional.ts`, `regional-pick.ts`): World Bank income groups pick a price variant passed to Checkout.
  The upgrade dialog (`components/UpgradeDialog.tsx`, `lib/use-upgrade.ts`, `lib/billing/upgrade.ts` + `plan-cards.ts`): in-app pricing opened by every paywall
  (an invite on Free, shared-app room, the free Puku cap, the Upgrade buttons); `lib/billing/checkout.ts` `startUpgrade` starts Checkout for the billing page, the
  weft.zip dialog and the desktop's `/api/account/billing/checkout` → weft.zip `/api/billing/checkout`, back to `app/checkout/done` (billing.md "The upgrade dialog").
  Team seats (`lib/billing/seats.ts`): adding, inviting in or removing a person moves a Team subscription's quantity to the member count (billing.md "Team seats").
  The BlastCP bundle (`lib/billing/blastcp-bundle.ts`, `app/api/billing/blastcp`): the tier a user's plan gives them (Creator for every Team seat and a Pro/OSS/Edu owner), which BlastCP reads and applies (billing.md "BlastCP usage").
  The pricing cards' way in (`lib/billing/plan-link.ts`, `app/billing/page.tsx`, `components/team/OpenUpgrade.tsx`): `/billing?plan=pro|team` → sign-in → `/<slug>/billing`, which opens the upgrade dialog.
  The admin console (`lib/billing/admin/*`, `app/(admin)/admin/billing`, `app/api/admin/billing/*`): one workspace's plan changes, seats, cancel and Free-now, refunds,
  people, discounts and **Reset billing state**, each on the Stripe client for the mode its ids live in (`stripe-keys.ts` `detectMode`), each leaving an `admin.<op>` audit row.
  Coupons and referrals (`lib/billing/admin/coupons.ts`, `/admin/coupons`, `lib/billing/referrals.ts` + `referral-webhook.ts`, `referral_codes`/`referrals` tables):
  Stripe promotion codes per mode, and a referral code per workspace whose completed checkouts credit the referrer (billing.md "Admin console", "Coupons and referrals").
- `lib/home.ts` + `lib/home-release.ts` + `components/home/*` + `components/GoogleAnalytics.tsx` + `components/HomeErrorFallback.tsx` +
  `app/home/page.tsx` + `app/opengraph-image.tsx` + `public/brand/board.png` + `lib/faq.ts` + `app/faq/page.tsx`: the weft.zip home page (its short FAQ links to `/faq`, which renders `docs/FAQ.md`; the FAQ's pictures are `public/brand/faq/`), which `app/page.tsx` renders at
  `/` instead of the board when `isDeployed()` (`VERCEL` or `WEFT_HOME`); the home is loaded through `loadHome()` (a cached dynamic
  import in `lib/home.ts`) so a parse error in it can't 500 the board route — the parse-error companion to
  `lib/route-import-guard.ts`; `home.css` is plain prefixed CSS because `next.config.ts` sends every `.css` through the Tailwind loader,
  which drops CSS-module exports. `HomeErrorFallback` (the dark plain page both routes render when `loadHome()` returns an error) is a server component.
  Its sections: `components/home/Pillars.tsx` (the five things Weft stands on, `PILLARS` in `lib/home.ts`), `components/home/Plans.tsx`
  (Free, Pro and Team priced off the billing catalog in `lib/billing/plans.ts` — a price change moves the page, nothing is retyped —
  each card ending in its way in: the download, or **Get Pro** / **Get Team** through `/billing` to Checkout —
  and `components/home/FaqTeaser.tsx` for the six questions).
  Analytics: GA4 (`components/GoogleAnalytics.tsx`, in `app/layout.tsx` when `isDeployed()`) and PostHog (`instrumentation-client.ts`) on every
  weft.zip page and never on a local board (`lib/analytics-gate.ts` refuses local hosts, `lib/analytics-server.ts` the server off Vercel);
  `lib/analytics.ts` `track()` sends one event to both, and `data-track` attributes let server components' links opt in (docs/architecture/analytics.md).
  Both wait for consent: `components/ConsentBanner.tsx` (in `app/layout.tsx` when `isDeployed()`) stores the visitor's answer through `lib/consent.ts`
  (`whenConsented()` starts PostHog, the GA snippet fetches gtag.js only on a yes); `app/privacy/page.tsx` is the Privacy Policy, beside
  `app/terms/page.tsx`, with `components/ConsentChoice.tsx` to change the answer; both are in the footer (`components/home/HomeChrome.tsx`).
  The one desktop exception: anonymous onboarding stats (`lib/telemetry.ts` + `lib/telemetry-events.ts` allow-list + `lib/telemetry-send.ts` + `app/api/telemetry` → weft.zip `app/api/telemetry/collect` (capped per address and refused cross-site by `lib/telemetry-limit.ts` on `lib/fixed-window.ts`) → PostHog; switch `components/StatsSwitch.tsx`, `~/.weft/telemetry.json`).
- `lib/feedback.ts` + `lib/feedback-store.ts` + `lib/feedback-send.ts` + `app/api/feedback` (`/send`, and weft.zip's `/collect`): the feedback path behind the (now removed) footer dot. Haiku interviews you, you check its summary, and it's kept in `~/.weft/feedback`, stored in `public.feedback` and posted to the team's Slack (docs/architecture/feedback.md).
- `lib/slack-oauth.ts` + `lib/slack-webhook-store.ts` + `app/api/slack/oauth` (`/install`, `/callback`): the Slack OAuth install that hands over the feedback channel's incoming webhook. Slack has no Web API method for incoming webhooks, so the address can only be *given*, by an install — `/install` sends the user to the channel picker, `/callback` exchanges the code (with the app's Client ID and Secret) and stores the URL in `public.slack_webhooks`, where the collector reads it. The URL is a credential, so it never passes through a log or a page (docs/architecture/feedback.md).
- `lib/file-drop.ts` + `lib/use-file-drop.ts` + `components/FileDrop.tsx`: files dragged from Finder anywhere in the window; a composer takes
  its own drop, a card opens with them in its reply box, an open thread (`data-drop-target`) gets them, empty board opens New thread; files wait
  in the store until the target composer (`dropTarget`) mounts.
- `lib/review.ts`: `weft-review` tour blocks. `lib/review-feedback.ts` + `components/ReviewPanelTour.tsx` + `components/ReviewPanelHeader.tsx`: the review tour's per-step feedback drafts (`weft.review.<cardId>.<step>` in localStorage), the header's unsent count, and the flush that sends every waiting note with the approval (docs/architecture/threads-and-sessions.md "Review tour"). `lib/devserver.ts` + `lib/devserver-list.ts` + `lib/devserver-tools.ts` + `components/ServicesDrawer.tsx`:
  dev servers Weft runs for threads (`mcp__devservers__*`) and review tours; `lib/task-stop.ts` is the task strip's per-task Stop (docs/architecture/dev-servers.md).
  `lib/services.ts` + `lib/services-snapshot.ts` + `lib/services-kill.ts` + `app/api/services` + `lib/use-services.ts` + `lib/services-view.ts` + `lib/services-prefs.ts` + `components/ServicesDrawer.tsx`:
  the rail's 🖥 Services drawer, every process Weft spawned (one `ps` of the tree under Electron, split by thread CLI, dev server, terminal and other) with CPU, memory, End and a refresh-rate cookie.
  `lib/dev-commands.ts` + `lib/dev-launchers.ts` + `lib/dev-launchers-view.ts` + `components/DevLaunchers.tsx`: its Dev servers section, first in the drawer above the usage numbers: each working folder's dev command (package.json, Procfile, Rails, Django, deno, Makefile, wrangler) with Start, or Stop and Restart, whether it started or restarted and which card started it (its name opens the card); Weft's own folder is listed last as the board itself, with a link to its address that opens outside the pane. A thread's name in the services list opens its card.
- `plugin/skills/*`: my own skills (`/weft:done`, `/weft:commit`, `/weft:preview`, `/weft:setup-done`,
  which installs tests, docs and strict lint on a project before `/done`; `/weft:done` also keeps this file current);
  `lib/skills.ts` lists skills, `lib/automations.ts` turns "When … run …" rules into turns.
  `lib/skill-library.ts` + `lib/skill-usage.ts` + `lib/skill-sets.ts` + `lib/skill-set-actions.ts` + `app/api/skills/set` + `components/SkillsDrawer.tsx` + `components/SkillsChip.tsx`:
  skill sets, a thread gets only its project's skills (an off-list per folder seeded from what its transcripts ran, plus the card's own
  changes), as Claude Code `skillOverrides`/`enabledPlugins` settings when its CLI starts and a filtered skill index for puku and Codex (docs/architecture/skills.md).
  `lib/skill-registry.ts` + `lib/skill-cache.ts` + `lib/skill-install.ts` + `lib/skill-scan*.ts` + `lib/skill-license.ts` + `lib/skill-review*.ts` +
  `app/api/skills/{search,remote,review,scan}` + `components/SkillSearchResults.tsx` + `components/SkillScanPill.tsx`: a ✦ filter also searches skills.sh;
  a hit is kept by hash in `~/.weft/skill-registry`, scanned statically (code, prompt injection, telemetry, license) and by a Sonnet review shown in the
  pane, then installed into `~/.claude/skills`; your own skills get the same scan and a ⚠ (docs/architecture/skills.md#the-skill-scan).
  `lib/skill-thread.ts` + `lib/skill-tools.ts`: a hit's name opens a thread on it that shows its skills.sh page, scans and reviews it with
  `mcp__board__skill_preview`/`skill_review`, and installs it on your yes with `mcp__board__skill_install`.
- `lib/quality.ts` + `lib/quality-view.ts` + `app/api/quality`: the header's code quality checklist (coverage via `lib/coverage.ts`,
  file size, lint, types, guardrails); `lib/scout.ts` + `lib/scout-view.ts` + `app/api/scout`: the refactor scout, a cached
  read-only Sonnet run whose findings take the score's last 10 points so it never hits 100. `components/QualityBadge.tsx`
  draws it, `components/ScoutDialog.tsx` (a `Modal`) starts a card per finding; its hover bubble is `components/Tip.tsx` (native titles don't show in Electron).
- `lib/welcome.ts` + `lib/welcome-preview.ts` + `lib/welcome-client.ts` + `app/api/welcome` + `components/WelcomeDialog.tsx` + `components/WelcomeIntro.tsx` (Get ready: `components/WelcomeLoop.tsx`, a live HyperFrames loop of the board with your project names from `public/welcome/loop.html` + `lib/welcome-loop.ts`, rendered to `public/brand/welcome-loop.mp4` by `pnpm welcome:render`, which joins `public/welcome/beats.html` (tools, the 🔐 vault, panes, quality, profile; cut before its shortcuts) and `public/welcome/outro.html` (download Weft) after it into `weft-tour.mp4` for weft.zip's homepage; the welcome plays `intro.html` (Welcome to Weft) → loop → beats (ending on Weft's keyboard shortcuts: double-click or ⌘N, Esc, ⌘K, ?), handed off by `public/welcome/live.js`, which posts the beat on screen so WelcomeLoop puts Sign in with GitHub over the profile beat and starts each page's voiceover (`lib/use-welcome-tour.ts`, `lib/welcome-voice.ts`; tracks from Kokoro via `pnpm welcome:narrate`, `scripts/narrate-welcome.mjs`), and each CLI's login, with puku-cli's Try free for the Puku trial when no agent is logged in: `lib/welcome-trial.ts`) + `components/WelcomeAccount.tsx` (signed out, the required GitHub sign-in between Get ready and the projects) + `components/WelcomeSteps.tsx` (the projects, with the history switch) + `components/WelcomeFirst.tsx` (the first thread, starters, a real open-card screenshot, and the shortcut sheet's pitch when there's a printer) + `components/WelcomeFooter.tsx` (the footer's buttons and the step bar above them, with the replay's ✕) + `lib/onboarding-events.ts` (window events that open New thread with a prompt or open a card) + `components/HistorySettings.tsx`: first launch's welcome, for everyone, history or not, ending on a running thread; the session sync (`lib/import-sync.ts`) adds no cards until it's answered, a board with cards is adopted silently, and `countsAt` keeps opted-out history off the game. Settings → General changes it; the avatar's menu and the command palette replay it, and a replay closes on Escape, the backdrop or ✕ while first launch does not (docs/architecture/welcome-dialog.md).
  `lib/use-anchor-rect.ts` + `components/EmptyBoardStart.tsx`: after the welcome, the empty board's start panel (New thread, the welcome's starters) once the board has loaded with no cards and no filter.
- `public/intros/<id>.html` + `public/intros/player.js` + `public/intros/kit.css` + `public/intros/splash-timing.js` + `lib/feature-intros.ts` + `lib/use-feature-intro.ts` +
  `components/FeatureIntro.tsx`: the short narrated video each tool drawer, the New thread dialog, the code quality dialog and the
  leagues play when you press ▶ by the title, never on their own (docs/architecture/feature-intros.md). Each page is plain HTML plus a paused GSAP
  timeline; `player.js` plays it live (`?live=1`, with its own voice), injects the splash poster every intro opens on (the feature's
  own icon, its name and one line about what it does, read out of the page's `.head` row) and takes `?t=` to hold a frame. The
  splash's timing (hold, fade, lead) is in `splash-timing.js`, which the page and the three render scripts read, so the poster's
  length can't drift from the voice's delay or the video's length.
  The voice comes from `pnpm intros:narrate` (`scripts/narrate-intros.mjs`); the shareable video is rendered by
  `scripts/render-intros.mjs` (frames, headless Chrome seeking the paused timeline), `scripts/encode-intros.sh` (mp4, narration
  delayed by the splash and loudness-normalised) and `scripts/verify-intros.sh` (duration, AAC track, voice start, loudness, and the
  poster frame pulled out of the finished video) — `INTROS_DIR`/`OUT_DIR` move the compositions and the output, so the same scripts
  run on a machine that has the sources synced but not the repo.
- `lib/activity.ts` + `lib/game*.ts` + `lib/craft.ts` (the skills each Done card's transcript ran, behind Craft) + `lib/project-checks.ts` + `app/api/game`: streaks, XP, badges, the builder card and the
  production-ready tree, from the append-only `~/.weft/activity.jsonl`; `components/GameBadge.tsx` is the header chip and
  `components/LoomDialog.tsx` its dialog, titled Wefter Profile (docs/architecture/gamification.md). A level-up's popup
  (`components/AchievementPopup.tsx`) opens on its rank's picture (`public/brand/levels/<rank>.webp`, BlastCP renders of our
  hovercar wearing the emblem) with an "Episode" number and a line of story from `lib/level-lore.ts`, read aloud from `public/brand/levels/voice/` (`scripts/narrate-levels.mjs`); **Replay last achievement**
  (avatar menu, palette) reopens the last popup through `lib/achievement-replay.ts`. `lib/usage-scan.ts` + `lib/usage.ts` read every Claude Code and puku-cli transcript
  incrementally (`~/.weft/usage.json`) into tokens per day and plan-limit hits, which `components/LoomUsage.tsx` charts and the Limits badges read
  (`lib/limit-badges.ts`: 5-hour and weekly ladders to 1,000, burn-speed, same-day and in-a-row badges). The newer families are one pure module
  each on `lib/badge-kit.ts`, gathered by `lib/extra-badges.ts` (time, spend, craft, more, league, explorer badges); `lib/explore.ts` logs a feature's
  first use and `lib/badge-facts.ts` reads league weeks, referrals and team size from the `badge_facts()` RPC. `lib/limit-board.ts` +
  `lib/limit-board-sync.ts` post your fastest burns and hit counts to `limit_records` for the Leagues dialog's ⏱️ Limit records boards
  (`components/LimitBoardPanel.tsx`, `/api/league?board=`).
- `lib/commit-pile.ts` + `app/api/pile` + `components/PileBadge.tsx`: the header's "+N/-N" uncommitted counter and the card it
  starts to commit that pile one Review card at a time; its page's Commit buttons are `weft://commit` links
  (`electron/page-links.cjs`) that `lib/pile-commit.ts` runs with no turn (commit by path, push, move to Done).
  The Review column's "Review all" button starts the same card through the shared `lib/pile-review.ts`
  helper.
- `lib/sprint-plan.ts` + `app/api/sprint` + `components/BacklogBadge.tsx`: the "☰ N" Backlog counter beside it and the card it starts,
  a read-only planner that sizes each Backlog card, flags duplicates and finished ones, and groups the rest into sprints of cards
  touching different files (no worktrees, so overlap is the constraint); starts a sprint's cards only on your OK.
- `lib/sprints.ts` + `lib/sprint-store.ts` + `app/api/sprints` + `lib/use-sprints.ts` + `components/BacklogActions.tsx` + `components/SprintsMenu.tsx`: saved sprints, the Backlog header's flag (Save as sprint) and
  Archive all (asks first), and the list under the "Backlog" title (Restore, rename, delete), in `~/.weft/sprints.json`; ⌘B in New thread adds to the Backlog (`isBacklogKey` in `components/submit-keys.ts`).
  Every column header's chevron folds it to a strip (`components/FoldedColumn.tsx`, drawn by `components/BoardColumns.tsx`), remembered in the `weft-folded-columns` cookie (`foldedColumns` in `lib/board-prefs.ts`).
  The fullest columns widen to two columns of cards while the board has room (`wideColumns` in `lib/board-overflow.ts`, the board measured by `lib/use-element-size.ts`, the grid in `components/BoardColumn.tsx`).
- `lib/card-pictures.ts`: a card's thumbnail (latest thread image, or a pane capture after each turn from `lib/show.ts`) and its Haiku emoji tile; `lib/retitle.ts` renames a card with a placeholder title ("Image attachment") after its turn (`titleBy` marks a name Weft or you chose) and gives an untagged card 1 to 3 tags in the same Haiku call (`tagsBy`); `components/CardView.tsx` draws the card.
- `lib/tags.ts` + `lib/tag-store.ts` + `app/api/tags` + `lib/rail-view.ts` + `components/LibraryRail.tsx` (`SideRail`) + `components/TagsDrawer.tsx` +
  `components/TagsDialog.tsx` + `components/CardMarks.tsx` + `components/StarButton.tsx`: ★ star (never auto-archived; the rail's ★ filters
  the board) and tags (GitHub label rules, catalog in `~/.weft/tags.json`, the 🏷 drawer, pills on the card's stage line); they replaced the
  library (docs/architecture/tags.md).
- `lib/project-open.ts` (the project-open hook `touchProject` fires for a folder new to the list) + `lib/project-seed.ts` + `lib/project-seed-find.ts` +
  `lib/project-seed-run.ts` + `app/api/projects/seed`: a new project's starter Backlog, up to 6 parked cards once per project (`~/.weft/project-seeds.json`),
  Re-seed Backlog (`components/ReseedButton.tsx` in `components/ProjectMenu.tsx`), and the copilot's `SEED_SOURCE` chips (docs/architecture/project-seed.md).
- `lib/repos.ts` + `lib/clone-progress.ts` + `app/api/repos/clone` + `lib/use-clone-progress.ts` + `components/CloneProgress.tsx`: cloning a GitHub
  repo from the repo picker (`components/RepoChoiceRow.tsx`) or the project menu (`components/ProjectCloneForm.tsx`) runs `gh repo clone … -- --progress`,
  turns git's redrawn progress lines into one weighted percent per repo in memory, and the row or form polls `GET /api/repos/clone?fullName=` every 400 ms for a bar.
- `lib/github-issues.ts` + `app/api/github/issues`: a project's open GitHub issues become cards through the `gh` CLI, labels as tags,
  one direction; opt-in folders in settings `issueFolders`, polled from `prewarm()` every 5 min (docs/architecture/github-issues.md).
  `lib/issue-landing.ts` + `lib/issue-run.ts` + `components/IssueWorkflowPicker.tsx` + `lib/agent-thread.ts` + `lib/agent-brief-page.ts` + `app/api/agents/design`:
  the project's workflow — where its issue cards land (Backlog, Needs you, or Run), the skill that checks a card first and the agent that works it;
  "Design the agent" starts a new thread that asks the questions and writes that agent's soul, opening on the brief page. `lib/github-status.ts` + `app/api/github` + `lib/github-view.ts` + `lib/use-github.ts` + `components/GithubDrawer.tsx`: the rail's GitHub drawer
  (the `gh` sign-in, each project's repo and its issue sync switch). `lib/github-hooks.ts` + `app/api/github/hooks` +
  `lib/github-relay.ts` + `app/api/github/webhook`: instant sync, a repo webhook relayed by the deployed Weft on Vercel (→ `github_events` on Supabase → Realtime).
- `lib/email-forward.ts` + `app/api/email/webhook` + `scripts/resend-domain.mjs`: mail to weft.zip, received by Resend (the domain's MX) and
  forwarded by the deployed Weft to one inbox (Svix-signed `email.received` → read back → send on; docs/architecture/email-forwarding.md).
- `lib/account.ts` + `app/api/account` + `lib/auth/*` + `lib/use-account.ts`: the optional Weft account
  (Supabase Auth, PKCE; the redirect target is `weft://account-callback` in the packaged app and the loopback
  HTTP origin in `next dev`, handled by `electron/account-link.cjs` and `app/api/auth/weft-callback/route.ts`;
  sign-in / sign-out pages share `lib/account-page.ts`). `lib/auth/` is a thin wrapper around the same
  `lib/account.ts` whose public API mirrors `@aimhuge/auth`; `app/login/page.tsx` is the new weft.zip sign-in
  surface (GitHub only). `lib/use-account.ts` is a board-side re-export of `useAuth` with the
  `{ state, busy, error, waiting, signIn, sendLink, signOut }` shape the top bar expects. Session in
  `~/.weft/account.json` (Keychain-sealed by `electron/account-store.cjs`), drawn by
  `components/AccountButton.tsx` (top bar; its avatar menu `components/AccountMenu.tsx` opens on your team, plan and an
  Upgrade to Pro button, `components/AccountPlan.tsx` + `lib/use-billing-status.ts`, then board sync's status line with Resync now
  and Sync / Don't sync for the board's project, `components/AccountSync.tsx` + `lib/sync-menu.ts`, which also colour the avatar's
  dot while an upload runs or after one failed) and `components/AccountSettings.tsx`; schema in
  `supabase/migrations/`, MCP server in `.mcp.json`.
- `lib/teams.ts` + `lib/team-actions.ts` + `lib/web-session.ts` + `lib/web-auth.ts` + `proxy.ts` + `app/auth/*` + `app/team` +
  `app/[orgSlug]/*` + `app/invite/[token]` + `components/team/*`: Weft teams on weft.zip (workspaces, roles, email invites; every
  account gets one through `supabase/migrations/20261013155754_teams.sql`), on the visitor's own cookie session. Uses `@aimhuge/teams`
  (`vendor/*.tgz`) for its helpers only; workspace slugs skip `lib/reserved-slugs.ts` (the package's words plus every `app/` root folder, kept in step with `private.org_slug_for` by its test): its `requireOrg` and actions pass a client into `"use cache"`, which Next 16 refuses, so the
  gate is Weft's own. Never pass the gate's `service` client to a client component (docs/architecture/teams.md, teams-vault.md).
  Project access: `lib/team-project-access.ts` (who sees each linked project, `org_project_members`) + `components/team/ProjectAccess.tsx`
  (the **Access** checklist on a project row, for owners and admins).
  The same routes run on a local server with `WEFT_WEB=1`: `proxy.ts` refreshes the cookie session on
  `isWebEnabled()` (not the deployed-only check), and the OAuth round trip is pinned to one canonical
  origin (`http://127.0.0.1:1024`, `webLocalOrigin()` in `lib/web-auth.ts`) — `webCanonicalRedirect()`
  moves a visitor on the other loopback name across before the round trip starts, because the PKCE
  verifier cookie is host-only, and `webCallbackOrigin()` pins the `redirect_to` and the final
  redirect to that origin, which Supabase's allow-list must list. The host is read from the request's
  `Host` header (`webRequestOrigin()`), not from `request.url`: `next dev` normalizes the URL to
  `localhost`, and reading it there sends the canonical move in a circle.
- `lib/profile-card.ts` + `lib/profile-card-sync.ts` + `lib/signed-in-client.ts` + `lib/public-profile.ts` + `components/profile/*` + `supabase/migrations/20261018135430_profile_cards.sql`: the public Wefter Profile at `weft.zip/@username` (`app/u/[username]`):
  the signed-in Mac posts the Loom's You and Badges tabs as one snapshot (`profileCard()`, every 10 min on the league timer and on opening the dialog, never projects or folders) into `profile_cards` through
  `profile_card_submit`; `loadPublicProfile` re-validates it with `parseProfileCard`, adds league rank and public mini apps, and the page is server components with plain SVG charts and no JS (docs/architecture/profiles.md).
- `electron/vault*.cjs` + `electron/dotenv.cjs` + `electron/device-key.cjs` + `components/VaultDrawer.tsx`: the 🔐 secrets vault
  (docs/architecture/secrets.md); decryption only in main, IPC to the board window only, `lib/vault-view.ts` + `lib/use-vault.ts` on the board side.
  A thread that needs a key it doesn't have puts the name in as a blank right away with `mcp__secrets__add_blank` (with a hint for where
  to get the value) — blanks sort first, the rail's badge counts them, every blank row has a visible **Fill in** button, and the user
  fills them in when they're ready. `mcp__secrets__ask_add` is the urgent path: an input for the key in the thread itself (`components/SecretAskInput.tsx`);
  on a name that already has a value it says so and changes nothing. `mcp__secrets__set_value` stores a value the thread made or got
  (adds, fills a blank, or with `replace: true` overwrites), Touch ID each time (`electron/vault-routes.cjs`).
  `electron/vault-ipc.cjs` is the board window's IPC, `electron/vault-unlock.cjs` the Touch ID unlock timer.
  `electron/vault-access.cjs` is the one place that decides whether a card may use a vault and how it was allowed
  (the audit log's `via` word): the fill, a command run with secrets, and a grant all ask it.
  `electron/card-token.cjs` + `lib/card-token.ts` are the card's identity: the server signs the card id with
  HMAC-SHA256 over `route\ncard` and main verifies it in constant time, so a request that names a card it can't
  prove acts for nobody (docs/architecture/secrets.md#which-card-a-vault-request-is-for).
- `electron/account-client.cjs` + `electron/vault-sync*.cjs` + `electron/vault-shared-meta.cjs` + `electron/vault-store-shared.cjs`:
  the shared 🔐 vault (docs/architecture/teams-vault.md). `electron/account-client.cjs` is main talking to Supabase **as the
  signed-in user** — the sealed session in `~/.weft/account.sealed`, the *published* key (never the service role), and a 401 that
  refreshes and retries once. `electron/vault-sync.cjs` is the engine: `pull` reads the diff since the last `row_version`, `push`
  writes a `vault_events` row and a `vault_secrets` row in one transaction with the optimistic-concurrency check, `subscribe` follows
  the Realtime feed, `drain` empties the offline queue. The server holds ciphertext only — the vault key never leaves the Mac, and a
  value never reaches a thread. `electron/vault-shared-meta.cjs` reads the `<hash>.shared.json` next to the local file (the `shared`
  block the drawer shows), `electron/vault-store-shared.cjs` is the shadow path, and `electron/vault-sync-files.cjs` owns the shadow and
  queue files on disk.
- `electron/device-fingerprint.cjs` + `electron/device-key.cjs` + `electron/preload.cjs`: device registration and the TOFU fingerprint
  (docs/architecture/teams-vault.md#device-registration). Each Mac has a keypair whose private half safeStorage keeps in the Keychain;
  `registerDevice` upserts the public key, the fingerprint and the device's name. The fingerprint is the first 16 bytes of the
  public key's SHA-256, as 32 hex characters in 8 groups of 4 — the same string both sides compare out of band, so a server that
  slipped in its own key shows two different ones and the grant stops before any key is produced. The preload's
  `weft.vault.devices` namespace gives the board the public keys and fingerprints, never a private key.
- `electron/vault-grant.cjs` + `electron/vault-share.cjs` + `electron/vault-shared-api.cjs` + `electron/vault-local.cjs`:
  granting a device and sharing a vault for the first time (docs/architecture/teams-vault.md#granting-a-teammates-devices).
  The granter's main is the only place the vault key and the new device's public key meet: the key is sealed with
  `crypto_box_seal` and the server stores the sealed box. Sharing a local vault keeps its key as **version 1**, imports the existing
  ciphertexts, and writes `shared.json` so the local file becomes a shadow.
- `app/[orgSlug]/team/devices/` + `app/api/team/devices/` + `lib/team-devices-view.ts`: the workspace's **Devices** tab
  (docs/architecture/teams-vault.md#granting-a-teammates-devices). The list crosses users, so it is read with the service client on the
  server; the grant, the accept and the delete are gated by the workspace's role. The accept route takes the device id and reads the
  public key from the `devices` table, never from the request body — a caller can never name a key for the granter to seal to.
- `components/VaultShared.tsx` + `lib/vault-view.ts` + `lib/use-vault.ts`: the drawer's **shared** badge and **Share this vault**
  (docs/architecture/teams-vault.md#what-the--drawer-shows). The badge carries the workspace's name and the key version; the Share offer
  appears on a local vault when the user is in a workspace, and is hidden when they are the only member.
- `components/VaultEventsList.tsx` + `lib/vault-events.ts` + `electron/vault-events.cjs` + `electron/vault-events-ipc.cjs`: the
  event log tab beside the secrets (docs/architecture/teams-vault.md#what-the--drawer-shows). The last hundred rows of who did what,
  newest first, filtered to your own actions or to every member's, with a live feed. The query names its columns one by one and
  leaves out the writer's metadata, so no value can reach the tab.
- `electron/vault-conflict.cjs` + `lib/use-vault-conflicts.ts` + `components/SecretRow.tsx`: a write that lost against a teammate's
  (docs/architecture/teams-vault.md#push-on-change). The store answers `{ conflicts, queued }` with the server's row instead of throwing;
  `electron/vault-conflict.cjs` projects it into `{ name, environment, actor, rowVersion, blank }` (the actor from the newest `vault_events`
  row, never a value), and the drawer's row shows a transient banner — "Sam changed API_KEY in development — keep your edit?" — with
  **Keep your edit** (the same value again, against the row's current version) and **Keep theirs** (the server's row, already in the shadow:
  no write at all). A conflict on a blank silently keeps the new value.
- `electron/vault-recovery.cjs` + `electron/vault-recovery-words.cjs` + `app/[orgSlug]/team/vaults/[vaultId]/recovery/` +
  `app/api/team/vaults/[vaultId]/recovery/route.ts` + `lib/vault-recovery-view.ts`: a shared vault's recovery key
  (docs/architecture/teams-vault.md#recovery-key). 24 words from the 2048-word English list
  (`electron/recovery-wordlist.json`, no checksum) that open the vault when every machine is gone. The words are made in
  **Electron main** — the vault key only exists there, so the page asks the desktop for them behind Touch ID and the server
  never sees them. The passphrase is applied to the seed *before* the keypair (`scrypt(passphrase, vault_id)`), so the words
  carry the passphrase-derived seed. The rows (the `devices` row with `fingerprint = 'recovery'`, the grant, the event row)
  go through the `private.share_vault_recovery` RPC in one transaction — RLS can't write a row nobody owns. The words are
  never persisted: not a file, not the server, not the event log, not a thread; "Copy words" puts them on the clipboard for
  60 s. A re-show is a fresh keypair and revokes the old row, so the old words stop working.
- `electron/vault-rotate.cjs` + `lib/team-vault-rotate.ts` + `app/api/team/vaults/[vaultId]/rotate/route.ts` +
  `components/team/Roster.tsx` + `lib/use-team.ts`: a shared vault's rotate on removal
  (docs/architecture/teams-vault.md#removal-and-rotation). Removing a teammate can tick **Rotate shared vaults**: the
  vault's key version is bumped, a new key is made in **Electron main** and sealed to the machines that stay (and the
  recovery key), every value is re-encrypted under it, and the removed machine is revoked with no grant for the new
  version. The old wrapped keys stay in `vault_grants` for one cycle, so an offline teammate can still read what was
  encrypted before. The crypto is in main (`electron/vault-rotate.cjs` → a plan of sealed boxes, ciphertext and *names*),
  the bookkeeping on weft.zip (`lib/team-vault-rotate.ts`'s `applyRotate`, which writes with the service client because
  RLS only lets a device write its own grant) — the key itself never leaves the Mac. The team page names the values to
  change at their providers, never a value; the rotate lands in `vault_events` as `vault.rotated`.
- `electron/keychain-audit.cjs` + `lib/keychain-audit-sync.ts` + `components/KeychainAccess.tsx`: the Keychain audit log
  (docs/architecture/secrets.md#audit-log). Every `safeStorage` open or seal (`keychainFor(what)`) and every vault value use is a line,
  kept in the `keychain_events` table, not on the Mac: `~/.weft/vault/audit.jsonl` is only the outbox (numbered, deleted once uploaded,
  every 5 s while signed in). Settings → Security → Keychain access reads it back with whose it was (`lib/keychain-audit-record.ts`,
  `app/api/account/keychain-events`, `lib/keychain-audit-view.ts`, `lib/keychain-audit-types.ts` for the shapes, `lib/use-keychain-access.ts`).
- `electron/vault-grants.cjs`: thread grants (docs/architecture/secrets.md#thread-grants). One Touch ID lets a card fill, run and
  start its dev server with one vault's secrets for an hour; from the card menu or `mcp__secrets__request_access`.
  A grant that covers typing a value into a page carries the site, and covers that page only — the Touch ID prompt names
  it — so a card can't use an hour's grant on a page it controls; a grant with no site covers only the commands and
  dev servers.
- `lib/project-intake.ts` + `lib/intake-scan.ts` + `lib/provider-hints.ts` + `app/api/projects/intake` + `electron/vault-intake.cjs`: the project
  intake. Opening a project on the board (`lib/use-board-view.ts`) moves its untracked `.env*` files' new values into 🔐 with no click (never a
  tracked file's, never over a vault value) and turns the keys its code reads, its `.env.example` names and its webhook routes into 🔐 and 🪝
  blanks with provider links. It runs in the background, once per folder until HEAD or an `.env` changes, and `~/.weft/intake.json` remembers
  what it offered (docs/architecture/secrets.md#project-intake). `components/IntakeDialog.tsx` + `lib/intake-open.ts` + `lib/intake-run.ts`: the
  screen that lists what it took in, with Later and ▶ Get it running (a card that installs, asks for the blank keys and starts the dev server, one Touch ID at most).
- `lib/webhooks.ts` + `lib/webhook-tools.ts` + `app/api/webhooks` + `lib/use-webhooks.ts` + `lib/webhooks-view.ts` + `components/WebhooksDrawer.tsx`: the 🪝
  webhooks drawer under 🔐 (each project's webhook routes in `~/.weft/webhooks.json`, blanks counted until registered; `mcp__webhooks__*`).
  `lib/webhook-relay.ts` + `app/api/hooks/[id]/[[...rest]]` + `lib/webhook-forward.ts`: its public relay URL on the deployed Weft (→ `webhook_deliveries` on
  Supabase → Realtime → the local target; the relay only accepts a delivery carrying the provider's signature, checked by
  `lib/webhook-signatures.ts` against the secret sealed into the row by `lib/relay-secret.ts` + `electron/relay-secret.cjs`;
  docs/architecture/webhooks.md).
- `electron/vercel*.cjs` (`vercel-env.cjs`: 🔐 vault → Vercel env push, and the vault ⇄ Vercel drift from `vercel-env-cache.cjs` with `lib/vercel-drift*.ts`, `lib/use-vercel-drift.ts` and `components/VercelDriftActions.tsx`; Touch ID per push, also `mcp__secrets__push_to_vercel`; and `pull()`: plain Vercel vars the vault lacks → vault, by hand or live: `lib/vercel-hooks.ts` + `app/api/vercel/hooks` make the team webhook and listen, `lib/vercel-relay.ts` + `app/api/vercel/webhook` relay it on the deployed Weft → `vercel_events` on Supabase → Realtime) + `lib/vercel-view.ts` + `lib/use-vercel.ts` + `lib/use-linked-status.ts` (the three drawers' cached status hook) + `components/Vercel*.tsx`: the ▲ Vercel drawer (token sealed
  in the Keychain, link or create a project as `.vercel/project.json`, latest deploy; docs/architecture/vercel.md).
- `electron/supabase.cjs` + `lib/supabase-view.ts` + `lib/use-supabase.ts` + `components/Supabase*.tsx`: the Supabase drawer (its bolt
  on the rail; token sealed in the Keychain, link a project as `supabase/.temp/project-ref`, state, unapplied migrations matched by version then name;
  `lib/supabase-migrate.ts` is the prompt of **Migrate**, the card that applies them on your OK; docs/architecture/supabase.md).
- `electron/cloudflare*.cjs` + `lib/cloudflare-view.ts` + `lib/use-cloudflare.ts` + `components/Cloudflare*.tsx`: the Cloudflare drawer (its orange
  cloud on the rail; a pasted setup token becomes Weft's own narrow token, sealed in the Keychain, then the setup token is deleted; link a Worker or Pages project in `~/.weft/cloudflare-links.json`, best fit from the
  folder's wrangler config; docs/architecture/cloudflare.md).
- `electron/blastcp*.cjs` + `lib/blastcp-view.ts` + `lib/use-blastcp.ts` + `components/BlastcpDrawer.tsx`: the BlastCP drawer (its rocket logo on the rail, `components/BlastcpLogo.tsx`) (OAuth + PKCE
  sign-in sealed in the Keychain, reads through BlastCP's MCP tools, folder → property links in `~/.weft/blastcp-links.json`; docs/architecture/blastcp.md).
- `electron/slack*.cjs` + `lib/slack*.ts` + `app/api/slack/*` + `lib/use-slack.ts` + `components/SlackDrawer.tsx`: the Slack drawer (its four-colour mark on the rail,
  `components/SlackLogo.tsx`; the setup form is `components/SlackConnect.tsx`, the connected view `components/SlackSettings.tsx`): bot and app tokens sealed in the Keychain, Socket Mode in main for `/weft` and @mentions, the server posts commits and pushes
  (each repo's reflog), Vercel deploys and card status (a thread per card, with a preview and its weft.zip link); each kind can have a channel of its own (`components/SlackRoutes.tsx`), and growth — a new user, a new team, a payment — is read from production Supabase (`lib/growth-read.ts`, `public.growth_events`) and posted to the growth channel, with a watermark in `~/.weft/slack.json` so nothing is posted twice, and a daily summary through `POST /api/slack/growth-summary`; `pnpm slack:manifest` configures the app, whose install uses PKCE (`lib/slack-pkce.ts`, so only the Client ID is needed) (docs/architecture/slack.md).
  `lib/blastcp-auto.ts` + `app/api/blastcp` + `electron/blastcp.cjs` `connectWeft`: connecting with your Weft account, the account's access token swapped for a BlastCP sign-in (RFC 8693, `exchangeWeft` in `electron/blastcp-oauth.cjs`) on Weft sign-in, every 12 h (`CHECK_MS`) and from the drawer's Connect with Weft; the route answers only the outcome, and signing out writes `~/.weft/blastcp-auto.json` `{off:true}` so the timer doesn't reconnect. The same beat sends `lib/blastcp-plan.ts` `syncBlastcpPlan` (POST blastcp.com/api/weft/plan with the Weft token), and `app/api/account/billing`'s `notePlan` sends it when the plan changes, so BlastCP applies the tier the plan includes.
- The board's native right-click menus (lib/card-menu.ts) are built and popped in `electron/main-menu-popup.cjs`:
  one IPC handler, a fresh `Menu` from the items the board sends, the click → resolve wiring behind a `setTimeout`
  (because click fires before the callback on macOS but not on every platform). `Menu` and `BrowserWindow` are
  injected so the test can pass mocks without a real Electron.
- A project's right-click menu (on its chip in `components/ProjectChips.tsx` and its row in `components/ProjectMenu.tsx`) is
  the same native popup: the items in `lib/project-menu.ts`, run by `components/project-menu-handler.ts` (a plain
  function the board makes each render, through the board's own `openNew`, `chooseProject`, drawers, `archiveCards`
  and `stopNow`). Reveal in Finder and Open in Editor/Terminal are `electron/open-in.cjs` (`shell:reveal`,
  `shell:openIn`: the first installed app of a fixed list, `open -a`). Pin and Hide are `pinned`/`hidden` on the
  saved project (`lib/project-list.ts`, `markProject` in `lib/settings.ts`, `PATCH /api/projects`); `chipProjects`
  in `lib/project-bar.ts` puts pinned chips first and leaves hidden ones out unless selected, and using a hidden
  project (`touchProject`) brings it back.
- **Sync** in that same project menu (cloud sync to weft.zip, `docs/architecture/cloud-sync.md`):
  **Sync <project>** / **Don't Sync <project>** turns the switch for that folder (`POST /api/cloud-sync { folder, on }`,
  the same call as Settings → Sync and the avatar menu). The item carries the project's own sync state as its
  sublabel (Electron's `sublabel`, `detail` in `lib/card-menu.ts`, drawn by `electron/main-menu-popup.cjs`):
  "Not Synced", "Synced 7m ago", "Syncing…", "Sync Failed", or "Sign in to sync" — `projectSyncLine` in
  `lib/sync-menu.ts`. The board owns the cloud-sync hook (`lib/use-cloud-sync.ts`, `components/Board.tsx`) and the
  menu reads it fresh when it opens (`readSync`, `read()` in the hook), so the line says how it stands now; a failed
  read keeps the last known state and opens the menu anyway. **Sync** is greyed out when there's no account or no
  workspace yet (a project that already syncs can still be turned off).
- `lib/copilot.ts` + `lib/board-tools.ts`: the copilot thread and its `mcp__board__*` tools. `lib/copilot-suggest.ts` + `lib/copilot-context.ts` + `lib/copilot-sources.ts` + `lib/copilot-setup.ts` (what isn't linked yet, for onboarding chips and the copilot's `setup_status`) + `app/api/copilot/suggestions`: the empty chat's chips Haiku writes from the cards and every source Weft can read (pile, scout, blanks, Vercel and Supabase via the control server's `/vercel/status` and `/supabase/status`, `gh`), refreshed in the background after a move; one run labels every chip with its project and `chipsFor` (`lib/copilot-starters.ts`) filters to the board's selected project (docs/architecture/copilot-suggestions.md). `components/CopilotLane.tsx` +
  `lib/copilot-lane.ts` + `lib/use-copilot-thread.ts` + `lib/copilot-float.ts`: it floats in the window's bottom-right
  corner like Intercom's messenger, at `COPILOT_LAYER` (z-[96]) over the board, the card window, every `Modal` layer and
  the welcome, with three states: hidden (the round launcher, `components/CopilotHider.tsx`, the default, with a dot
  for a reply you haven't seen and never a card count, `lib/use-copilot-unread.ts`), peek (a 280px panel above it with the
  copilot's latest reply or idea, and a maximize button) and open (a 400px chat above it); ⌘J cycles them via `LANE_CYCLE` and the two
  `weft-copilot-lane` / `weft-copilot-peek` cookies in `lib/board-prefs.ts`. The launcher and the panel publish their
  boxes, and `components/BrowserPane.tsx` keeps the native view clear of them (`clearOfCopilot`: stops short above the
  launcher, hides under the panel). The board's columns
  keep their 170px floor when hidden and narrow to 120px when peek or open (`columnMinWidth(state)`);
  the peek auto-closes 6s after the mouse leaves. They
  are `@container`s that drop thumbnails and header extras. `lib/copilot-personas.ts` + `components/CopilotPersonaMenu.tsx`: who the copilot is (Wingman, Founder after
  founder-skill, Captain after gstack), picked from its name in the lane header; `card.persona` → `Spec.persona` → its prompt after
  `COPILOT_PROMPT`, and a switch starts a new chat (docs/architecture/copilot-personas.md). `lib/copilot-initiative.ts` +
  `lib/copilot-initiative-run.ts` + `app/api/copilot/check-ins`: the copilot speaks first, a morning idea and a refactor
  look after work lands, at most 3 a day, a QUIET answer dropped from the thread (docs/architecture/copilot-initiative.md).
  `lib/copilot-sources-product.ts`: the chips' roadmap and last-week's-commits sources.
- `lib/agents.ts` + `lib/agents-built-in.json` + `lib/agent-store.ts` + `app/api/agents/*`: who a card's thread is, its soul and
  the skills it turns off (Builder, Weft's own; Copywriter, Weft's voice; yours). `~/.weft/agents.json` keeps your agents, your
  edits over the built-ins (Reset pulls the JSON from GitHub) and each project's default; `card.agent` → `Spec.agent` →
  `weftSystemPrompt` opens with that soul and `offFor` adds its skills off. `components/SettingsAgentsPage.tsx` +
  `components/AgentEditor.tsx` (Settings → Agents), `lib/use-agents.ts` for the board's pickers: the New thread dialog
  (`AgentSelect`, with Manage agents…), the card menu (`PATCH { agent }` ends the CLI; the next turn resumes under the new
  soul) and the emoji in `CardFooterMeta` (docs/architecture/agents.md).
- `lib/workspace-layout.ts` + `components/CardWorkspace.tsx` + `components/EditorColumn.tsx` + `lib/file-access.ts` + `app/api/cards/[id]/files` + `lib/open-file.ts`: the open card's four columns and the editor column (CodeMirror, TipTap markdown, Changes vs. HEAD); any file path in the thread opens it (docs/architecture/editor.md). The layout is remembered in localStorage, but opening a card reopens the `pane` column: a thread always comes up with the browser pane, never beside an empty slot.
- `lib/browser-tools.ts`: `mcp__browser__*` tools every thread gets; `lib/browser-act-tools.ts` the ones that act on the page
  (snapshot with refs, click, hover, type_text, press_key, select_option, scroll, wait_for, set_viewport, console_logs,
  network_errors; docs/architecture/agent-browser.md); `lib/browser-shell.ts` the control-server call every Weft tool uses.
- `lib/site-notes-*.ts` + `app/api/site-notes` + `app/api/site-notes/cloud` + `components/SiteNotesSwitch.tsx`: site notes. `-url` keys and generalized paths, `-scrub` and `-safety` the safety pipeline, `-format` the note and its untrusted wrapper, `-store` local notes, the public switch and the outbox, `-trail` the per-card trail the pane tools record, `-read` what open_url adds, `-capture` the after-turn pass `lib/show.ts` fires, `-send` the outbox, `-remote` the desktop's client, `-live` the wiring; `-status`, `-cloud` and `-db` are weft.zip's side (docs/architecture/site-notes.md).
- `lib/simulator-tools.ts` + `lib/simulator-devices.ts` + `lib/simulator-ui.ts` + `lib/simulator-exec.ts` + `lib/simulator-watch.ts` + `lib/simulator-status.ts` + `lib/simulator-install.ts` + `lib/simulator-install-steps.ts` + `components/SimulatorConnector.tsx`: `mcp__simulator__*` for threads (list, boot, install, launch, open_url, ui_tree, tap, swipe, type_text, press, screenshot, logs, watch) over simctl / adb / AXe, the live view page in `~/.weft/show/simulator/`, and the setup checks on Settings → Connectors with an Install button per missing piece (docs/architecture/simulators.md).
  `lib/cli-exec.ts` is how every CLI connector runs a tool (find it on PATH, exec it with a timeout, hear what it
  said) — gog (`lib/gog.ts`) and the simulator tools (`lib/simulator-exec.ts`) both go through it. `lib/use-connector-status.ts`
  is how a connector panel on Settings → Connectors loads its status and polls it while the tool is working.
- `lib/mini-apps.ts` + `lib/mini-app-store.ts` + `app/api/apps` + `lib/use-mini-apps.ts` + `components/AppsRail.tsx` + `components/SaveAppButton.tsx`: mini apps, pages
  saved from the browser pane (its toolbar's grid button) as tiles on the left rail below 🖥 Services (rendered inside `components/LibraryRail.tsx`), in `~/.weft/apps.json`; a tile opens its page in the board's pane. No apps, nothing on the rail (docs/architecture/mini-apps.md).
  `components/LoomApps.tsx` lists them as My mini apps on the Loom's You tab. `lib/app-share.ts` + `lib/app-share-types.ts` + `app/api/apps/share` + `components/ShareAppDialog.tsx` (with `components/ShareParts.tsx`, shared with the card's dialog): Share… on an app, a `weft.zip/a/<id>` link (`cloud_app_shares`) to an uploaded copy of a local page (with the files it links to beside it, `lib/page-assets.ts`) or a framed https site; `lib/app-share-access.ts` + `app/a/[id]` + `app/api/a/[id]/{page,unlock}` serve it behind the card link's gate (`gateVerdict`, `lib/share-unlock.ts`, `lib/share-page-serve.ts`). `lib/app-share-frame.ts` (versioned frame URLs) + `lib/app-share-serve.ts` (the page, `page/[sha]`, `f/` and `v/[ver]/` routes: CDN headers for public links, version checks) + `lib/app-page-limit.ts` (per-address and per-share cap) keep views unlimited and cheap; `lib/app-share-quota.ts` + `components/ShareAppQuota.tsx` + `supabase/migrations/20261024124411_app_share_quota.sql` gate a workspace's open links' bytes by plan (`APP_SHARE_BYTES` in `lib/billing/plans.ts`; docs/architecture/mini-app-hosting.md).
  Link previews: `lib/app-preview.ts` (sources and precedence) + `lib/app-preview-capture.ts` (made on the Mac: meta tags, `weft-app.json`, Haiku, a hidden-window capture from `electron/page-snapshot.cjs`) into `cloud_app_shares.preview`; a preview says when it was made, and `isStale` (a changed page, older than `PREVIEW_MAX_AGE_MS` — 6 h, or a failed capture past `PREVIEW_RETRY_MS` — 30 min, marked by `shotFailedAt`) says when it needs making again, so a data app's picture is taken again once its numbers have moved. `lib/app-preview-refresh.ts` is the timer that walks the shared apps and refreshes the stale ones, one at a time, started with cloud sync (`lib/cloud-sync-start.ts`); a refresh of an unchanged page keeps Haiku's sentence and the last capture. `lib/app-share-meta.ts` is the share routes' `generateMetadata` (public links only) and `lib/app-card-image.tsx` the branded card at `/api/a/[id]/og`, shown in the Share dialog by `components/ShareAppPreview.tsx` (drawn once and cached beside the capture). A save that only changes who may open the link no longer re-uploads the page (`pageForWrite`, `lib/app-share-row.ts`). `lib/app-share-slug.ts` gives every link its default address (a taken one tries `-2` … `-9`), and backfills one that has none when Share… opens, so Copy link is always the `/@<user>/apps/<slug>` URL. Share… on an app without a link makes one open to anyone with it, and a folder-app link takes its keys up whenever Share… opens or saves it and they changed (`lib/app-share-keys.ts` → main's `POST /apps/push-secrets`, `electron/app-secrets-push.cjs`, reading the vault of the manifest's `folder`; `electron/app-secrets-pushed.cjs` fingerprints what last went up, so unchanged keys need no Touch ID).
  Data apps: `electron/pane-preload.cjs` gives a `file:` page `window.weft`; `electron/app-data.cjs` (+ `electron/app-data-reads.cjs`) answers only a saved app's page in `~/.weft/apps/<slug>/` with a `weft-app.json`, asks Touch ID for the one vault env it names (grants in `~/.weft/app-grants.json`), and runs its named reads in main (Supabase functions, GA4); `lib/app-cloud.ts` persists every app on prod (`cloud_mini_apps`) and restores it on another Mac. 📈 Growth (`~/.weft/apps/growth/`) reads the `growth_*` functions — the account-level ones (`supabase/migrations/20261018054110_growth_reads.sql`) and the in-app ones (`20261024041130_growth_in_app_reads.sql`: cards pushed per day, in-app engagement per day, and a retention table that counts an account as retained only if it pushed a card, moved one or ran a turn that week, rather than merely signed in). Versions: the signed-in Mac reports its version once a day (`lib/app-version-sync.ts` → `app_versions`, `20261029075755_app_versions.sql`) and `growth_versions` counts accounts per version.
- Browser pane: `components/BrowserPane.tsx` draws the toolbar and the placeholder the native view (`electron/browser-pane.cjs`)
  lies over; the page is a native view above the board's DOM, so a menu can't be painted over it: a full-window overlay hides the page
  (`lib/overlay.ts`'s `useOverlay`), while a local menu (the zoom menu, a card's mode picker) publishes the rectangle it covers and the page
  steps around it (`lib/overlay.ts`'s `useLocalMenu` / `useMenuCoverPublisher`, `lib/pane-clear.ts`'s `clearOfMenu`);
  `components/ShowRail.tsx` + `lib/show-rail.ts` + `lib/show-events.ts` + `lib/pane-page.ts` (stamps each sent message with the pane's page) are the 72 px show rail right of the page,
  one mini per turn and per page the pane showed (the thread's `open_url` calls plus pages opened by hand, in memory), synced with the chat by two window events (`show:scroll-to`, `show:pulse`) on rows tagged `data-turn`;
  pages are small WebP pictures (`lib/page-shots.ts` + `app/api/cards/[id]/shots` + `lib/use-page-shots.ts`) and the pane follows the chat's scroll (`lib/use-pane-follow.ts`) (docs/architecture/show-rail.md).
- `lib/board-view-tools.ts` + `electron/board-view.cjs` + `electron/control-server.cjs`: `mcp__board_view__*`, a thread's eyes and hands
  on the board window itself (screenshot, click, hover, type, read; fixed scripts, no arbitrary JS; `data-secret` reads as ‹secret›,
  `data-secret-action` can't be clicked) through the pane's token-guarded control server (docs/architecture/board-view.md).
- `lib/import.ts`, `lib/search.ts`: pick up `~/.claude/projects` sessions as cards; search index.
- `lib/hotkeys.ts` + `lib/shortcut-catalog.ts`: the keyboard shortcut registry and what the `?` sheet lists; tooltips, key badges,
  right-click menus and `ModifierHint` read their keys from it (docs/architecture/keyboard-shortcuts.md).
- `lib/shortcuts.ts` + `lib/use-dictation.ts` + `lib/use-composer-keys.ts`: the one rebindable binding (dictation, `⌥'` by
  default) and the mic it starts. The binding is a set of modifiers, so `⌥'` also fires on `⌘⌥'`; the hook reads a ref, so a
  second press while the microphone is opening cancels the recording instead of opening a second one
  (docs/architecture/keyboard-shortcuts.md#the-rebindable-dictation-binding).
- `lib/shortcut-sheet.ts` + `lib/print-sheet.ts` + `electron/print.cjs` + `components/PrintShortcutSheet.tsx`: the printable
  one-page shortcut sheet, the `?` dialog's Print button and the welcome's pitch for it, shown only when macOS has a printer
  (docs/architecture/keyboard-shortcuts.md#the-printed-sheet).
- `lib/new-thread.ts` + `components/submit-keys.ts` + `lib/use-mod-held.ts`: what the New thread dialog offers and remembers (CLIs, models,
  effort, drafts), and its start keys: ⌘↵ starts and closes, ⌃↵ starts and stays open, and holding either relabels Start.
  It also holds **the one list of CLIs**: `BACKENDS` (the picker's four), `BACKEND_IDS` (their ids) and `ALL_MODEL_IDS` (every model id any
  CLI serves), all derived from the same source. Every route that validates a backend — `lib/new-card.ts`, the two `switch-backend`
  routes, `app/api/settings`, `lib/plan-limits.ts` — checks against these, so a CLI added to the picker works everywhere at once.
  Before this, each route kept its own hardcoded list and one of them still lacked Goose: picking Goose in the New thread dialog created
  a **Claude Code** card with no error (docs/architecture/goose.md#the-one-list-of-clis).
- `lib/theme.ts` + `app/api/scenes` + `components/AppearancePicker.tsx` + `electron/theme-source.cjs`: System, Light, Dark or a scene
  (one of Weft's pictures behind the board with its own palette, in `app/globals.css`; docs/architecture/themes.md).
- `lib/custom-theme.ts` + `lib/custom-themes.ts` + `app/api/themes` + `lib/use-custom-themes.ts` + `components/ThemeDescriber.tsx`:
  themes you prompted up (or built around a picture you uploaded), painted by a card into `~/.weft/themes/<id>/` and applied from a second cookie (docs/architecture/themes.md#prompted-themes).
- `lib/store.ts`: storage in `~/.weft` (board.json, threads/, attachments/); board.json is written atomically by `lib/atomic-write.ts` (temp file, fsync, rename). `lib/attachments.ts` saves every PNG, JPEG and GIF as WebP (uploads, tool screenshots, pane thumbnails; transcript reads add one beside the original); `scripts/webp-backfill.mjs` converts the old ones (docs/architecture/threads-and-sessions.md).
- `lib/cloud-sync.ts` + `lib/cloud-outbox.ts` + `lib/cloud-sync-start.ts` + `lib/cloud-sync-cards.ts` + `lib/cloud-sync-upload.ts` + `lib/blob-store.ts` + `lib/blob-paths.ts` + `lib/device-id.ts` + `lib/cloud-sync-types.ts`:
  server-side cards, opt-in per folder (settings `syncFolders`): an outbox in `~/.weft/sync-outbox.jsonl` uploads cards, thread items
  and long tool outputs to Supabase (`supabase/migrations/20261015155756_card_sync.sql`), images and pages by content hash.
  `lib/cloud-sync-repos.ts` keeps the switch per GitHub repo too (`cloud_sync_repos`), so your other Macs turn sync on for their own clone.
  `lib/sync-prompt.ts` + `lib/use-sync-prompt.ts` + `components/SyncPromptDialog.tsx` (mounted in `components/HeaderBadges.tsx`): once the welcome is
  answered and a thread in the project you're working on has reached Review, "Turn on Project Sync for <project>?" asks once a launch (signed out, "Sign in to Weft?", Weft's one sign-in ask), with a
  "Don't show me again" box (localStorage, cleared by Reset tips); `lib/scratch.ts` is the scratch-folder list it shares with `lib/welcome.ts`.
  `lib/thread-page.ts` + `app/api/cards/[id]/thread/**` + `lib/use-tool-result.ts`: threads page from the newest item back and fetch
  a tool output over 2 KB when its row opens (docs/architecture/cloud-sync.md).
  `app/[orgSlug]/board` + `components/web-board/*` + `lib/web-board.ts`: the weft.zip board is the desktop's own board, not a lookalike —
  its cards are `CardView` (`readOnly`), its columns are `BoardColumn`/`ColumnHeader`/`BoardColumns`, its chrome is the desktop's `BoardHeader`,
  `BoardProjectBar`/`ProjectBar`/`ProjectMenu` and the shared rail buttons in `components/RailBoardButtons.tsx`, and an open card is the desktop's own
  `ThreadPanel` → `ThreadView` → `ReplyBox` over a different transport (`lib/thread-transport.ts`: `localTransport` for the desktop,
  `components/web-board/useCloudTransport.ts` + `lib/cloud-thread-page.ts` for Supabase rows, Realtime and commands); change the desktop board and the
  web follows. The seam is a `variant?: "desktop" | "web"` prop that hides only what the Mac owns (the browser and terminal panes, the local
  Settings, the Mac's filesystem); new thread-view code reads the transport, never `fetch`/`api` directly.
  `lib/cloud-commands.ts` + `lib/cloud-inbox.ts` + `lib/new-card.ts` + `lib/web-commands.ts` + `components/web-board/WebNewCardDialog.tsx` + `components/web-board/WebReplyStatus.tsx`: **New thread**, the open card's reply box, its answers and Stop on the web board
  insert a `cloud_commands` row (`supabase/migrations/20261016065614_card_commands.sql`; a `BEFORE INSERT` trigger
  in `20261018130000_cloud_commands_device_ownership.sql` requires the row's `device_id` to be a device row
  of the same `account_id`); the Mac it names hears it over Realtime, checks it (its device, its account, a
  synced folder, its workspace), makes the card through the same `createCardFromBody` as `POST /api/cards`, starts it and reports back; the card syncs up like any other. `card_id` is set only by the receiver after `createCardFromBody` accepts the request. A `reply` goes to the card through `sendUserMessage`, as if typed on the Mac; an `answer` through `answerPermission` (by `pendingId`), a `stop` through `stop()`.
  `lib/share-types.ts` + `lib/card-share.ts` + `components/ShareCardDialog.tsx` + `components/ShareBoardDialog.tsx` + `components/web-board/WebShareBoard.tsx` over one `components/BoardSharePanel.tsx` (the board's link, `weft.zip/<slug>/board`, and invites: `lib/use-team.ts` on the desktop, `boardShareTeam` in `lib/team-actions.ts` on the web) + `app/s/[id]` + `app/api/s/[id]/*` + `lib/share-*.ts` + `components/share-view/*`: **Share…** on a card gives `weft.zip/s/<id>`,
  its thread and its pane side by side, live (polled), private / public / email / password from `@aimhuge/share`; reads the synced rows (docs/architecture/sharing.md). Its address under the sharer, `weft.zip/@<user>/threads/<slug>`, is `lib/card-share-slug.ts` + `app/u/[username]/threads/[slug]` + `components/share-view/SharedCardPage.tsx` (the body both routes render); the public link preview is `lib/share-meta.ts` + `app/api/s/[id]/og`; the dialog's address field and Show the chat switch are `components/ShareCardOptions.tsx`.
- `app/api/*` + `lib/guard.ts`: localhost-only Host check; once the desktop app has written a launch token every route needs it, reads included (the board's own `1` passes for a read and a non-elevated write, `elevated()` refuses it), so a process that only reaches the port can neither read the board nor write to it.
  Every board-side fetch goes through `lib/api-client.ts` (`apiFetch`, `API_HEADERS`) so it carries `x-weft-token`: a fetch without it 403s, and the call site's `.catch()` turns that into an empty default — a whole UI feature gone with no error shown (the pile counter, the quality, streak and league chips, an open thread that renders empty). Electron main's own reads (dock badge and tray, Keep Working, the updater's running count, a `weft://new` link's folder) skip the window's token swap, so they send `READ_HEADERS` from `electron/server-read.cjs`. `lib/api-token-guard.test.ts` walks the "use client" files under `components/`, `lib/` and `app/` and fails on an `/api` fetch without the token.
- `lib/restart-guard.ts`: turns away Bash that would kill or restart Weft itself (its server pid, port, `next dev`, the app)
  while other cards' turns run, since a restart cuts them all off; in every thread via `guardedCli()`.
- `lib/r2.ts` + `lib/blob-urls.ts` + `lib/blob-read.ts` + `lib/r2-mirror.ts` + `lib/r2-queue.ts` + `app/api/web-board/[orgId]/blob-urls` + `app/api/cron/r2-mirror` + `scripts/r2-backfill.ts`: blob reads from Cloudflare R2 (zero egress). A SigV4 signer over `node:crypto` (no SDK), one ref→URL resolver for the web board, its server render and share pages (R2 for shas in `blob_mirror`, whose member policy is the access check, else a Supabase signed URL plus a queued copy), and one R2-first byte read for the page routes. `supabase/migrations/20261029105650_blob_mirror.sql` (docs/architecture/r2.md).
- `lib/infra-live.ts` + `app/api/infra/live/route.ts` + `electron/live-data.cjs` + `electron/server-info.cjs` + `electron/mini-apps-setup.cjs`: the live infrastructure read behind the repo-analysis report. The route reads the project's real numbers — `public.infra_live()` over PostgREST for the database and storage, `public.blob_mirror_stats()` for what's in R2, the Analytics log stream for the **egress** (the only record of it: the response's `content_length`, split by cache status and summed by Supabase over the logs endpoint, which answers at most 1,000 rows) — and answers one snapshot; a missing credential leaves that half null and a note saying why, never an error. `electron/live-data.cjs` lets a `file:` page ask for a path on Weft's own server and holds the launch token in main, so the page never has it. `pnpm infra:probe` prints the snapshot (docs/architecture/infra-live.md).
- `lib/restart-when-idle.ts` + `app/api/restart` + `lib/restart-tool.ts` + `electron/restart-when-idle.cjs` + `components/RestartChip.tsx` + `components/RestartMark.tsx`: restart when idle
  (Weft menu, palette, updater, `mcp__board__restart_weft_when_idle`): `sendMessage` holds new turns as "after restart" scheduled
  messages, and once no turn runs or is queued the server calls the control server's `POST /app/restart` (relaunch or install the update).
  A card that asked for the restart is recorded in the drain (`RestartStatus.requestedBy`) and marked on the board: a red edge and a ⟳ chip, so the thread waiting on a restart is spotted in any column.
- `lib/ts-paths.ts`: where `@/` and other tsconfig `paths` aliases point (`aliasBases`), so both import guards resolve `@/x` as `src/x` in DeckCP and `x` in Weft.
- `lib/import-check.ts` + `lib/dropped-imports.ts`: after each Edit/Write, tells the thread which imports it broke (a build error no boundary catches) or dropped while still in use (an "X is not defined" on draw);
  in every thread via `lib/env.ts` `guardedCli()`, and in other Claude Code sessions via `.claude/settings.json`.
- Components: `Board.tsx`, `ThreadView.tsx`, `ThreadItems.tsx`, `Markdown.tsx`, `ReviewPanel.tsx`
  (the tour: `ReviewPanelTour.tsx`, its header `ReviewPanelHeader.tsx`, its button row `ReviewPanelTourNav.tsx`, and the card without a tour `ReviewPanelNoTour.tsx`);
  every dialog sits in `Modal.tsx` (backdrop, header, close, Escape via `lib/use-escape.ts`; it draws in a portal, into a `div[data-weft-modal]` it makes on the body, so a dialog opened from the header (the leagues) escapes the header's `-webkit-app-region: drag` stacking context and no z-index can trap it there; the host is made in a lazy initializer, which StrictMode runs twice, so the second call claims the first call's host and the mount effect puts it back if the double-mount's cleanup took it away — a portal into a detached node draws nothing, which is why Settings stayed shut; its `layer` prop sets the stack: `normal` z-50, `top` z-90 for Settings and the welcome, `palette` z-92 for ⌘K, which also opens over Settings, `front` z-94 for the achievement popup, which can arrive at any moment; confetti z-95 and tooltips z-100 sit above all; `QuickOpen` ⌘P is a `Modal` too);
  each card, panel, dialog body, drawer, header badge and thread message sits in `CrashGuard.tsx` (an error boundary;
  `inline` draws a one-line chip for small spots), with `app/error.tsx` behind the whole board (on weft.zip it draws the web error page, and `app/not-found.tsx` the 404: `components/web-states/`, which also holds the public pages' loading skeletons). Board's panels, dialogs,
  cards and badges, the reply box and the review panel load through `guarded()` (`components/guarded.tsx`, an `import()`
  inside a CrashGuard), so even a module that throws as it loads (JSX in a constant before its import) breaks only its spot.
  A build error (a file that doesn't parse) fails the route before React runs, so no boundary sees it: `components/BuildErrorBar.tsx`
  (`lib/build-error.ts`) hides Next's overlay and leaves the last version that built running.
  When a thread breaks Weft (stops its server, leaves a file that doesn't build), `lib/crash-blame.ts`
  marks its card `broke` (a red ring and a 💥 Broke Weft chip in `components/CardMarks.tsx`, a note with its next message):
  Electron notes an exit it didn't ask for (`electron/server-exit.cjs`), the board reports build errors and reloads (`lib/use-break-report.ts`
  → `app/api/broke`), and the card whose recent tool call explains it is blamed (docs/architecture/error-boundaries.md).
  A runtime dev-server death (the supervisor's 4-in-2-min crash budget trips while the board is up) gets
  the same treatment: `components/ServerErrorBar.tsx` (`lib/server-status.ts`) offers Restart / Open logs /
  Fix with a thread without tearing down the React tree (`electron/server.cjs` `onNotify` → `electron/server-ipc.cjs`).

## Hotspots

components/Board.tsx (~480 lines), electron/main.cjs (~450; its control routes are `electron/pane-routes.cjs`, its splash IPC `electron/startup-ipc.cjs`), electron/vault.cjs (~390), electron/browser-pane.cjs (~345), lib/cloud-sync.ts (~365).
Everything else is under 300 (2026-10-16): big files became re-exporting fronts (`lib/types.ts` → `lib/types-*.ts`,
`lib/import.ts` → `lib/import-*.ts`, `lib/secret-guard.ts` → `lib/secret-guard-*.ts`, `lib/client.ts` → `lib/client-*.ts`).
Pure logic already moved out: `lib/board-view.ts` (columns and their order: Backlog by drag, Review by last update, the rest by the sort menu; project chips, chime/unseen rules, Review's Errors/Restart filter chips drawn by `components/ReviewFilterChips.tsx`) and
`lib/turn.ts` (how a turn's result reads, where its card goes, cost, limits); Board's hooks into `lib/use-*.ts` (`use-now`,
`use-toast`, `use-desktop-bridge`, `use-copilot-card`, `use-board-actions`, `use-board-toggles`, `use-board-view`, `use-board-archive`,
`use-board-card-actions`, plus `lib/board-focus.ts`, `lib/board-helpers.ts`), its live events into `lib/board-live.ts` (Delete, Stop, prompt answers (Allow, Deny, Wait, This first) and card fields (star, tags, archive, rename, mode, resume, rerun, model switch) drawn at once by `lib/optimistic-cards.ts`, the copilot's card included; a sent reply drawn in the thread at once by `lib/use-pending-sends.ts`; a failed card list is tried again on `LIST_RETRY_MS` until it lands, so the columns never sit on placeholders), the menu/dock/tray
actions into `lib/board-menu-bridge.ts`, its derived values into `lib/board-derive.ts`, and its JSX into `BoardHeader`, `BoardProjectBar`,
`BoardColumns` (each column's extras by id), `BoardBrowserPane`, `OpenCard` (the framed window and the open card's four columns),
`NewThreadWindow` (the New thread form and desktop browser pane), `BoardBottom`
(footer and terminal drawer), `BoardToast` and
`components/BoardDialogs.tsx` (the nine dialogs, sheets and overlays the board stacks over its columns, each still loaded through
`guarded()`; `components/BoardDialogs.test.tsx` says which prop opens which panel and that each close handler fires through).
The delete-card confirmation is Weft's own modal, `components/DeleteCardDialog.tsx` (a native confirm can't show a checkbox), with a
"Don't ask again" tick that is the flag in `lib/delete-confirm.ts`; both delete paths use it, the trash button in an open card's
header (`components/CardActions.tsx`) and the right-click menu's Delete (`components/use-board-menus.ts`). The dialog's state and the
board's delete live in `lib/use-delete-dialog.ts`, and Settings → Security's **Ask before deleting a card** row
(`components/DeleteConfirmSwitch.tsx`) is the way back from the tick.
Shortcuts, the command palette and the menu bridge share one input in `components/use-board-commands.ts`. The rail's drawers share one
`RailContext` (`components/rail-context.ts`); `BoardHeader` and `BoardColumns` take grouped props (counts, panes, slots; drag, review, archive).
The dialog flags (New thread, Settings, Share board, Help, palette, sign-in, project menu) and what they cover live in `lib/use-board-dialogs.ts`.
The open card's state (selection, thread, streaming text, Rename…, unseen moves) is `lib/use-open-card.ts`, and the New thread
dialog's splash page in the pane `lib/use-new-thread-pane.ts`. Next: the board's data (cards, home, roots, projects, folder
resolution) into a hook; Board is at complexity 26.

## Tests

My Vitest suite (`pnpm test`, over 12,000 tests across ~1,100 test files) covers every line of `lib/` and `app/api/` (98.6% of branches,
`pnpm coverage`): a test file beside each module, routes with their libs mocked, the runner's SDK loop
against a fake `query()` (`lib/runner.harness.ts`, shared by `lib/runner*.test.ts`), and browser code and React hooks under happy-dom +
@testing-library/react (`// @vitest-environment happy-dom`). `lib/client-graph.test.ts` walks every "use client" file's imports and fails on a chain into "use cache", cacheLife/cacheTag or "server-only" (2026-10-17's build error). The same analysis runs as an ESLint rule (`eslint-rules/no-client-server-leak.mjs`, `weft/no-client-server-leak`), so `pnpm lint` — and so the pre-commit hook, which lints the staged files — fails a commit that would take the board down before the next restart (2026-10-24's Turbopack panic on `node:fs`). `lib/prerender-check.test.ts` walks app/**/page|layout|route for what only `next build` refuses under cacheComponents (segment config exports, `await params`/`cookies()` before `<Suspense>`; two failed deploys on 2026-10-17), and `lib/route-import-guard.ts` runs the same check on each edit. Component tests have started under jsdom
(`components/*.test.tsx`: CardView, ReplyBox, NewCardDialog, TagsDialog, TagsDrawer, ThreadPanel, ColumnHeader, SettingsDialog, Modal, LibraryRail; Composer stubbed by `components/composer-mock.tsx`);
`electron/main-menu-popup.test.ts` is the first test in `electron/`. The rest of `components/` and `electron/`
are untested and outside the coverage set; add tests with any risky change, and keep new lib code at 100%.

## Known gaps (verified 2026-10-13)

- Coverage counts only `lib/` and `app/api/` (100% lines, 98.6% branches on 2026-10-11). `components/` has
  behavior tests for CardView, ReplyBox, NewCardDialog, TagsDialog, TagsDrawer, ThreadPanel and ColumnHeader only
  (not Board, ThreadView or the real TipTap Composer);
  `electron/` has one (`electron/main-menu-popup.test.ts`). Runner's leftover branches are defensive fallbacks.
  CI (`.github/workflows/ci.yml`) runs lint, typecheck and tests, but the repo has no upstream branch yet, so it hasn't run.
- `lib/account.ts` declares `WEEFT_PROTOCOL` on line 101 and uses it on line 96 (forward reference). `ACCOUNT_CALLBACK_HOST`
  is duplicated in `lib/account.ts:94` and `electron/account-link.cjs:6`; one should import from the other.
- `7b1db11`, `dfdd9c7` and `0e54c6f` don't build on their own (Board.tsx imported files committed later);
  everything from `2766738` on does.
- The overlap warning (`lib/overlap.ts`) counts a card's edits for its whole life, committed or not. The reply box no longer
  shows it (in a busy repo it always did); the card's "+N here" chip and the New thread dialog do, and neither names the
  shared files. Symbol claims warn at the actual clash instead.
- Symbol claims drop on Done, archive, the commit walk-through and, after any Bash call, once `git status` shows the
  file clean. Cards still see each other's half-done edits when they run tests or typecheck; a failed check is only
  told whose they are (`lib/failure-owners.ts`). An Isolated card (docs/architecture/worktrees.md) avoids that; shared cards still don't.
- The copilot learns what finished or needs you only with your next message (`lib/copilot-digest.ts`);
  it never runs a turn on its own.
- A thread that hits a limit waits for the reset (docs/architecture/limits.md), but only on the desktop: the
  weft.zip board can't schedule at all (the cloud command kinds are `new_card`, `reply`, `answer` and `stop`,
  with no `schedule`), and the copilot can't either (`lib/scheduler.ts` refuses it).
- puku-cli sessions aren't imported; a full puku thread hasn't been verified end to end.
