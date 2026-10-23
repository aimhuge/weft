# Changelog

What changed in each Weft release. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and versions follow [Semantic Versioning](https://semver.org/). Add a line under **Unreleased** when a feature
lands; a release moves those lines under its version and tags the commit `vX.Y.Z`.

0.3.0 is the first tagged release. 0.1.0 and 0.2.0 were never tagged: their sections below group the history by day.

## [Unreleased]

### Fixed

- **New thread's Start now stays inside the form, and the pane no longer slides shut after you close it.** The footer wraps beside the browser pane (`components/NewCardDialogFooter.tsx`), and the board's pane holds its prior visibility while the splash restore lands (`lib/use-new-thread-pane.ts`).
- **Subagents on Opus 4.8 work on puku-cli.** It refuses any subagent model outside `puku-ai-2.7`, `puku-ai-2.8` and `opus`, so Weft now sends `opus` for Opus 4.8; `/weft:done`'s Agent-tool fallback names a model each CLI accepts and treats an all-error Puku batch as a failure (`lib/subagents.ts`, `plugin/skills/done/SKILL.md`).

### Added

- **Plans on the home page, and a Team tier.** weft.zip now prices itself between the pillars and the FAQ: Free, Pro and Team read straight from the billing catalog, so a price change moves the page (`components/home/Plans.tsx`). **Team** is $9 per seat a month with Pro's allowance, and teams are now a paid capability — a Free workspace is a team of one and can't invite members (`lib/billing/plan-gate.ts`, `lib/team-ops.ts` `runInvite`). The gate fails closed: an unreadable or unpaid subscription reads as Free.
- **The welcome's Get ready screen plays how Weft works.** It opens on a "Welcome to Weft" title naming the agents it runs on (Claude Code, Codex, Puku AI; `public/welcome/intro.html`) and ends on "Now let's get started", after which the next steps say "Allow Weft to see your projects" and "Now start a new thread". A 30-second loop with your own project names on the cards: a prompt starts a card, it asks you a question in Needs you, gets a key from the 🔐 vault after Touch ID without ever seeing it, shows its work in the browser pane, and lands in Done, which commits, refactors and deploys. It's a HyperFrames composition that plays live in the welcome and renders to an MP4 for weft.zip (`public/welcome/loop.html`, `components/WelcomeLoop.tsx`, `pnpm welcome:render`). Reduced motion keeps the still screenshot. After it the welcome plays a second composition, connect your tools, the Wefter Profile and code quality with the refactor scout (`public/welcome/beats.html`, handed off by `public/welcome/live.js`), with a beat on the pane: a thread's page as a live dashboard on vault keys and your data, shared as a weft.zip link; during the profile beat a real **Sign in with GitHub** button sits over it, and once you are signed in the beat shows your name and avatar. It plays over Weft's own scene pictures with a soft backing pad under the voice, and it is narrated, on by default with a mute button: `pnpm welcome:narrate` voices each caption with Kokoro, a local text-to-speech model, into one track per page (`scripts/narrate-welcome.mjs`), and `pnpm welcome:render` bakes the voice into a 78-second `public/brand/weft-tour.mp4` for weft.zip.
- **Settings has a Security page.** The default permission mode (from Threads), trusted folders (from General) and sign-in expiry (from Accounts) now sit together (`components/SettingsSecurityPage.tsx`).
- **The project bar's More menu has a filter.** It has focus when the menu opens, matches the folder name and its `~` path, and Enter picks the top match. It's the same field and rule as the 🔐 and skills filters, now shared (`components/SearchField.tsx`, `lib/text-filter.ts`).
- **Replay the welcome from your avatar's menu.** It moved out of Settings → General (which keeps Test it and Reset tips) into the avatar menu and the command palette (`components/AccountButton.tsx`).
- **The 🔐 drawer shows each vault's Vercel project.** A vault whose folder is linked in ▲ gets a line under its name: the project, how many values are still to push, and **Push to Vercel** (one Touch ID) (`components/VaultVercel.tsx`).
- **The ▲ Vercel drawer's 🔐 list has a filter.** Past five variables, a name search and a menu (To push, On Vercel, Vercel only, No value, with counts) narrow the list (`components/VercelEnvRows.tsx`, `lib/vercel-env-filter.ts`).
- **weft.zip measures the whole site and the download.** GA4 now covers every weft.zip page (the FAQ, profiles, share links and the web board, not just the home), and PostHog runs alongside it. The download button sends `download_clicked` with its version to both, and New thread, replies, new projects and invites send their events through one `track()` (`lib/analytics.ts`, docs/architecture/analytics.md).

### Fixed
- **A local Weft never calls home.** PostHog's browser SDK, its server-side AI events (Haiku and scout prompts and replies) and its log exporter all started wherever the PostHog keys were set, the desktop board included, and printed a "variable required by PostHog is missing" error on every Haiku call when they weren't. They now run only on weft.zip, gated on the page's host in the browser and on `isDeployed()` on the server (`lib/analytics-gate.ts`, `lib/analytics-server.ts`).
- **You can see and undo which folders threads trust.** Settings → General has a **Trusted folders** row listing the folders outside any project that threads may use without asking, with an **Add folder** button (the same OS folder dialog the project and repo pickers use) and a **Remove** per folder. "Always" on a folder-guard prompt used to be a one-way door: nothing showed the list and nothing took a folder back out, so a folder trusted once stayed trusted. A revoke applies to new work; a thread already running keeps what it was granted until its turn ends (`lib/settings.ts` `unallowFolder`, `DELETE /api/folders`, `components/TrustedFolders.tsx`).
- **Accounts says how long each sign-in lasts.** Settings → Accounts has a **Sign-in expiry** row, so a lapsing sign-in is something you find in Settings rather than when a thread trips over it mid-run. BlastCP's 30-day sign-in is the one that runs out; it speaks up in its last week using the same note as its 🚀 drawer. Vercel, Supabase and Cloudflare tokens don't expire and say so. Only the expiry crosses from Electron main — the tokens themselves stay in the Keychain as before, and there's deliberately no silent auto-refresh (`components/TokenExpiry.tsx`).
- **The edit lock covers Bash too.** A Bash line that writes a file another busy card is editing (`sed -i`, `> file`, `prettier --write`, `cp`, `rm` …) asks first like an edit does; whatever a Bash call wrote becomes the card's claim; claims drop as soon as `git status` shows the file clean (a thread's own `git commit`, not just Done); and a failed typecheck, test or lint run is told which failures sit in files another card is mid-edit on, so it leaves them alone (`lib/bash-claims.ts`, `lib/bash-writes.ts`, `lib/dirty-files.ts`, `lib/failure-owners.ts`).
- **Laptop mode gets its own Settings page, and Always while threads run.** Keep Working moved off General onto Settings → Laptop mode, with a switch (also in the menu bar's Keep Working menu) that turns it on by itself whenever a thread is running and off once they finish, an **Only while online** switch, and a battery floor you pick (5–50%) instead of a fixed 10% (`electron/keep-working.cjs`, `electron/keep-working-prefs.cjs`, `components/LaptopModeCard.tsx`, `components/LaptopModeRules.tsx`).
- **Blanks show their whole name and hint, with links.** A secret's name in the 🔐 drawer wraps instead of being cut off, a blank's hint shows in full, and any https link in it opens that page in the browser pane, where you're signed in; threads are asked to put the direct dashboard link in every `add_blank` hint, now up to 400 characters (`lib/hint-links.ts`, `lib/open-in-pane.ts`).

- **Resizable rail drawers.** Drag the board's edge over an open drawer (🔐, 🪝, ▲ and the rest) to widen or narrow it, 220 to 640px; the width is remembered and a double-click puts it back to 272px (`lib/use-drawer-width.ts`).
- **The board explains itself.** An empty board shows a Start your first thread panel with New thread and the welcome's four starters, and the first card to reach Needs you, Review and Done gets a one-time tip under that column's header (the last one opens your Wefter Profile). Settings → General → Reset tips shows them again (`lib/tips.ts`, `lib/use-onboarding-tips.ts`, `components/OnboardingTips.tsx`, `components/CoachTip.tsx`, `components/EmptyBoardStart.tsx`).
- **A welcome that ends on a running thread.** First launch is now three screens for everyone, history or not: Get ready (a real board screenshot and each agent CLI's login, with Log in), Bring in your projects (with the history switch that used to be its own screen) and Start your first thread (a project, a starter prompt, Start). The three drawn explainer screens are gone (`components/WelcomeDialog.tsx`, `components/WelcomeFirst.tsx`, `lib/onboarding-events.ts`).
- **React mini apps, hosted under their owner.** A folder with `App.tsx` and no `package.json` becomes a static page Weft bundles with its own React and rebuilds on save. Shared, an app lives at `weft.zip/@you/apps/<slug>` or `weft.zip/<team>/apps/<slug>`, every file of its folder served in a sandbox, and the pane shows its name and a Share button instead of a `file://` path. Apps reach other services through `weft.fetch` with `{{secret:NAME}}` placeholders that Weft fills outside the browser, only for the hosts, methods and paths `weft-app.json` allows: the author's key, or each viewer's own, stored encrypted on weft.zip (`supabase/migrations/20261019095618_app_hosting.sql`, `lib/app-bridge.ts`, `electron/app-fetch-policy.cjs`, `lib/app-build.ts`, docs/architecture/mini-app-hosting.md).
- **Mini apps open on the left.** With no card open, a mini app tile opens the browser pane between the rail and the columns, sliding in and out; a second click on the lit tile closes it. The page shows once the pane is fully open, and the pane's resize divider is its right edge (`components/StandaloneBrowserPane.tsx`, `components/AppsRail.tsx`, `components/BrowserPane.tsx`).
- **Skill sets.** Threads get only the skills their project uses. ✦ on the rail is the project's default set (Weft's skills, the project's, yours and your Claude Code plugins, each with a switch), seeded once from the skills its threads ran; ✦N in a card header changes that card's set alone, from its next message. Claude Code and puku threads get it as `skillOverrides` and `enabledPlugins`, Codex and puku as a filtered skill index; hidden skills still run as `/name` (`lib/skill-sets.ts`, `lib/skill-usage.ts`, `lib/skill-library.ts`, `lib/skill-set-actions.ts`, `app/api/skills/set`, `components/SkillsDrawer.tsx`, `components/SkillsChip.tsx`).
- **Backup model + delete/rerun on a failed first message.** A card whose very first turn came back with an error (a rate limit, mostly) now shows a banner with **Rerun on <backup model>** and **Delete**. The backup model is a new Settings → Models row (`components/BackupModelPicker.tsx`, `backupModel`); any model any installed CLI serves, plus an "Off — no backup" leading option. With no backup set, the Rerun button reads "Pick a backup model" and opens Settings → Models. The handler is `lib/backend-switch.ts` `rerunOnModel` (clears the session, sets the model, replays the last user message); the route is `POST /api/cards/:id/rerun-model`; the predicate that picks when the banner shows is `lib/first-message-failed.ts` (`components/FirstMessageErrorBanner.tsx`, `lib/settings.ts`, `app/api/settings/route.ts`).
- **Fresh start after a model or CLI switch.** When a card's session was reset (the model or CLI was just switched, or the card was never started), the reply box now defaults to **Send fresh** — a new session in the same card, started from a brief of the thread and its diff — instead of plain Send. The chip says "Fresh start · was on another model", the Continue button and ⌘⇧↵ are hidden (nothing to continue), and Codex falls back to plain Send with the same chip (`lib/reply-mode.ts`, `components/ReplyBox.tsx`, `components/ThreadFooter.tsx`, `lib/use-reply-continue.ts`).
- `scripts/release-channels.mjs` generates a Homebrew cask and a signed apt repo from a release's dmg and deb. Not wired into the release workflow yet.
- Limits chart: a 15-minute background poll (`lib/limit-poll.ts`) keeps the chart filling in between thread turns, reusing a warm spare or opening a one-off session, and the 5-hour lane now shows 15-minute bars (4 per hour) instead of hourly.
- **Auto-resume parked cards when the limit resets.** The same 15-minute poll now watches the 5-hour and 7-day windows for the drop from 100% to <100%; when it sees a reset, every `needs_you` card with `rateLimitHit` on that backend replays its last user message (the same path `switchBackend` takes on a manual "Run on …"). The card's `lastLine` reads "Auto-resumed after 5-hour reset" (or `weekly`) and the chip on the card shows "Auto-resumed · 4:12am" with a tip. Busy cards are skipped; the next cycle picks them up (`lib/limit-history.ts` `setOnLimitReset`, `lib/limit-resume.ts`, `lib/limit-poll.ts`, `components/CardMarks.tsx`, `lib/types-card-detail.ts`).
- **Cockpit scene.** A slate-grey space theme: the windshield of a spaceship over a starfield with a sliver of dashboard, the splash screen's steel weave emblem lit on the console and cyan screens as the accent. Picture rendered with BlastCP; Settings → Appearance or ⌘K "Theme: Cockpit". A scene can now set `--scene-pos` to move the picture's crop (`lib/theme.ts`, `app/globals.css`, `electron/assets/backdrop-cockpit.jpg`).
- `pnpm dist:linux` packages Weft as an AppImage and deb (run it on a Linux machine; the toolchain wrappers and `node-pty` build are per-OS). Only packaging so far: the vault unlock, Keep Working and process cleanup are still Mac-only.

- **Many teams, and projects in a team.** Settings → **Teams** (it was "Team") opens on **Your teams**, every team you're in with your role, the one you're viewing lit; click another to manage it below (hovering a row preloads it, and the list stays up while it loads), and **New team** at the foot makes one you own. A team you own has a pencil beside its name that renames it in place (`rename` op, owners only; the slug stays, so links and synced boards keep working), and while you're in another team too, a trash that deletes it once you type its name (`delete` op, `lib/team-delete.ts`: refused while a paid plan still bills; everything under the team cascades, and this Mac looks its sync team up again). The pick is remembered. The invite form's role descriptions are Weft's own now, not BlastCP's ("posts", "channels") from `@aimhuge/teams` (`lib/team-types.ts` `ROLE_DESCRIPTIONS`, `components/team/TeamList.tsx`, `components/team/TeamPanel.tsx`). A team has many projects (GitHub repos): owners and admins **Add project** (from the board's repos or `owner/name`) and **Remove** them. **People on your projects** lists the repos' GitHub collaborators with an Invite button. Its table is the `org_projects` migration (`supabase/migrations/20261019100423_org_projects.sql`, applied). Cards still sync to your first owned team; per-project routing is next (`components/TeamSettings.tsx`, `components/team/Projects.tsx`, `lib/team-projects.ts`, `lib/team-create.ts`, `lib/github-collaborators.ts`).
- **Icon-only header buttons.** Copilot, Browser and New thread in the top bar are icons now (names and shortcuts stay in the tooltip), saving width on a 13" screen (`components/BoardHeader.tsx`, `components/CopilotButton.tsx`).
- **Three intro screens in the welcome.** Before the Wefter Profile and the projects, the first-launch welcome shows an open card with the browser pane explaining threads and the copilot, an empty board with each swimlane explained (Review as a walkthrough, Done as commit, refactor and docs), and the left bar. Drawn as mockups with the app's colors; **Next** / **Back**, five dots (`components/WelcomeIntro.tsx`).
- **ServerErrorBar when the dev server's restart budget trips at runtime.** When the supervisor's 4-in-2-min crash budget trips while the board is up (no longer only at startup), a small bar slides in at the bottom-left with **Restart server**, **Open logs**, and **Fix with a thread** — the third queues a `weft://new?…` link pre-filled with the fatal and the last 4 KB of `server.log` so the New thread dialog opens ready to start once the server is back. The board stays on the last data the server returned instead of being replaced by the splash; startup fatals (server never came up) still splash-fail as before. The supervisor's `onNotify` carries the event to `appView.webContents` (`electron/server.cjs`, `electron/server-ipc.cjs`, `electron/main.cjs`, `electron/preload.cjs`, `lib/server-status.ts`, `components/ServerErrorBar.tsx`).

- Settings → General → The welcome → **Test it**: runs the real first-launch welcome again, even on a board that was adopted with cards, and saves your answers.
- Continue is back in the reply box beside Done, whenever the thread is idle, and ⌘⇧↵ sends it (it was ⌘. before).
- Renamed the last "threadboard" names to Weft: the write header is `x-weft-token` (the launch token is accepted in its place), the env vars are `WEFT_*`, and the desktop bridge is `window.weft`. Old `~/.threadboard` data is still moved to `~/.weft`.

- `pnpm dist:remote` (`scripts/package-remote.sh`): builds the standalone app on m1mini or m2mini over the LAN, then packs and signs here with the Flexbike Developer ID (`--check` tests the builder and identity first).

### Fixed

- **A whole-suite `pnpm test` no longer takes Weft down with it.** The memory cap added in `f9140cf` did nothing: Vitest's `vmMemoryLimit` is a no-op on `pool: "forks"` (its `getMemoryLimit()` returns null for any pool but `vmForks`/`vmThreads`), reads a bare number as bytes rather than MB, and only measures V8's `heapUsed` after each test file finishes — so it could not see, let alone stop, the off-heap growth that crashed us. An RSS watchdog now polls the vitest process tree every 2s and ends a run whose real resident memory crosses 3072 MB (`WEFT_TEST_MAX_RSS_MB`, `--no-watchdog` to bypass), wired through `runHolding`'s new `watchdog` option. A run of named files is never gated or watched (bug-fixes/027).

- **A shared mini app's link no longer says "Not found" for a folder share.** The Mac can share an app as a whole folder, and the deployed page route only knew single-page rows; it now serves the folder's entry file through the same gate and sandbox (bug-fixes/024).

### Security

- **A local process can no longer read the board.** Once the desktop app writes a launch token, every API route needs it — reads included, not just writes. Before, a read passed on the localhost Host check alone, so any process that reached the port (a browser extension, a malicious `postinstall`, another local app) could read `/api/webhooks` (project paths and the *names* of the vault's secrets), `/api/projects`, `/api/game`, `/api/github` and 15 more. Only Weft's own window is given the token (`electron/api-token.cjs`). The per-route `sensitive` flag is gone: it existed to mark the six routes that leaked and no longer changes any verdict (`lib/guard.ts`; pentest 2026-10-23, P-1).
- **A thread can no longer approve itself through the board view.** `mcp__board_view__click` and `type_text` refuse anything inside `data-human-only`: the permission panel (Allow, folder This card / Always), the reply box while a question waits, the mode picker and Settings. Screenshots and reads still work (`electron/board-view.cjs`; pentest 2026-10-20, P-1).
- **Synced threads are redacted before they leave the Mac.** Cards, thread items and long tool outputs go through the share redactor (`findSecret` + the entropy pass) before the upsert, so a key that reached a thread never lands in rows every workspace member can read; the raw text stays local (`lib/cloud-sync-redact.ts`; P-2).
- **"Always allow" on a vault command lasts only until the code changes.** A `secret_run` rule now also pins a fingerprint of the folder's tree (HEAD, the diff against it, untracked files' bytes), so a thread editing a file the approved script runs makes Weft ask again; outside a git repo it always asks. Dev-server grants are unchanged (`electron/run-rules.cjs`; P-3).
- **Power writes need the launch token.** Answering a permission, changing settings, allowing a folder, running `!` shell, loosening a card's mode or granting it a read scope now refuse the bare `x-weft-token: 1` a thread's `curl` can send; ordinary card moves and creates still take it (`lib/guard.ts` `elevated`; P-4).
- A webhook relay delivery can no longer climb out of its target's path (`..`, `%2e%2e`) to another local route, and the relay drops `x-threadboard` from a stranger's request. Account, settings and services reads need a per-launch token the board window adds itself (`electron/api-token.cjs`). `weft://` links only act from a page under `~/.weft`, not any `file:` page.
- The email forwarder scrubs CR/LF/NUL from the parsed From display name, the subject, the alias and the round-tripped `X-Forwarded-*` headers (and every entry in the reply-to list), so an attacker mailing to `@weft.zip` with a crafted `From:` can't smuggle extra headers into the forwarded mail. Five new tests in `lib/email-forward.test.ts` cover the cases (pentest 2026-10-20, F-7; `lib/email-forward.ts`).
- **A hosted mini app's manifest can no longer point its Supabase read at a host of its choosing.** A named Supabase read sends the app author's real `SUPABASE_SECRET_KEY` as a bearer token to the URL `weft-app.json` declares, and that URL was copied into the share row with only a `typeof` check — so a manifest naming an attacker's host had weft.zip hand the key over on the first read. `supabaseUrl` must now be an `https` Supabase project URL (`.supabase.co` / `.supabase.in`, no credentials, no port), checked both when the manifest is reduced and again at read time so rows written earlier can't leak either (`lib/app-folder.ts` `safeSupabaseUrl`, `app/api/a/[id]/read/route.ts`; pentest 2026-10-20, F-11).
- **…and neither can a saved local one.** That fix reached only the hosted route; the local read path is a second implementation of the same read, and it had no such check — a data app saved from a folder could name any host and collect the project's `SUPABASE_SECRET_KEY` as `apikey` + `Bearer` on the first read. `supabaseUrl` is now judged by the same rule in both places, at manifest load and again before the secret is read, and the request is built on the validated origin rather than the raw string (`electron/app-data-reads.cjs` `safeSupabaseUrl`, `electron/app-data-frame.cjs`). A parity test asserts the CJS copy and the `.ts` original agree on every case, so the next fix can't land on half the code again (`electron/app-data-reads.test.ts`).

### Changed
- **The code quality badge opens a dialog.** Its suggestions (fix the checklist, the scout's findings, Re-scout) moved from a 320px dropdown to the shared `Modal`, with each finding's fix shown in full (`components/ScoutDialog.tsx`).
- **A scoped coverage run no longer wipes the repo's coverage report.** Vitest empties its reports folder before writing, so `pnpm test lib/x.test.ts --coverage` replaced `coverage/coverage-summary.json` with one file's numbers (or nothing, if cut off) and the header's Tests score fell to 0%. A run of named files now writes its report to a temp folder (`scripts/run-tests.mjs` `scopedCoverageArgs`); only `pnpm coverage` writes `coverage/`. `--no-memory-gate` and `--no-watchdog` are no longer passed on to Vitest, which refused them as unknown options (so the gate's own "run anyway" hint never worked), and the watchdog test fills its buffers so macOS counts them as resident. The open thread's handlers moved out of `components/Board.tsx` into `lib/thread-handlers.ts` (`useThreadHandlers`), tested beside it, and `lib/codex-runner.ts` went from 6% to 100% of lines covered.
- **The docs name only files that exist.** Twelve migration paths in SOUL.md and ten architecture docs still carried the versions they were written with, not the ones Supabase stamped on apply, and SOUL.md named a `components/DevServersDrawer.tsx` that became `components/ServicesDrawer.tsx`; all now point at the real files. The rail's filter chip moved out of `components/Board.tsx` into `components/RailFilterChip.tsx` with its own tests, and `lib/codex-input.ts`, `lib/server-status.ts`, `lib/onboarding-events.ts` and `lib/client-files.ts` got test files of their own.
- **One Keychain-token implementation for the four provider integrations.** Vercel, Supabase and Cloudflare each had a byte-identical `token()` reader and a persist step, and BlastCP had the reader plus an `expiresAt` beside it — four copies of the code that guards a secret file's mode. All four now read and write through `electron/provider-token.cjs` (`readToken`, `readTokenRecord`, `requireKeychain`, `writeToken`); each keeps its own error wording and its `create*`/`register*`/`setup*` shape (`electron/provider-token.test.ts`).
- **A token file's mode is now re-asserted on every write.** `fs.writeFileSync`'s `mode` only applies when it *creates* a file, so a record that was ever loosened — a stray `chmod`, a restore from a backup, a copy in from another machine — kept its loose mode through every later rewrite. `writeToken` chmods after writing, so a token file is `0600` whatever happened to it before (found while extracting the shared module).
- **One read implementation for local and hosted mini apps.** A data app's Supabase and GA4 reads ran in two copies, one in Electron main and one in the weft.zip route, and a security fix landed on only one of them (dde1126, closed in 25c1c99). Both now run `electron/app-read-core.cjs`; `electron/app-data-reads.cjs` is main's re-export and `lib/app-read.ts` maps its refusal kinds to the route's statuses. `lib/app-read-token.ts` is gone (`electron/app-read-core.test.ts`, `lib/app-read.test.ts`).
- **The reply box's queue is its own hook.** Replies queued behind a running turn (the batch sent once as the turn ends, a failed send back on hold, a row's Send now) moved out of `components/ReplyBox.tsx` (404 → 357 lines) into `lib/use-reply-queue.ts`, with its own tests at 100% and new ReplyBox tests for the queue's edges (`components/ReplyBox-queue.test.tsx`); no behaviour change.
- **A hosted mini app's read and fetch run one pipeline.** `weft.read` and `weft.fetch` on weft.zip (`app/api/a/[id]/read`, `app/api/a/[id]/fetch`) had each written their own body cap, gate, rate limiter, vault lookup and error mapper; both now run `lib/app-route-pipeline.ts` (`parseBoundedBody` → `gateShare` → `requireService` → `rateLimitGuard` → `resolveValues` → `runLogged`) and supply only their parser and upstream runner. Limits, statuses, bodies and `no-store` headers are unchanged.
- **One `clip`, one `folderName`, one settings shape.** Three small duplications found by the refactor scout: `clip` had four copies, two of which returned `max + 1` characters while promising `max` (`lib/show.ts` now imports the shared one; `lib/search.ts` and `electron/menus.cjs` keep theirs deliberately — an indexed prompt must not grow a trailing "…", and main can't import a `.ts` module — and say so in a comment); `folderName` had two implementations that answered identically on every input, so the project bar re-exports the one the provider views already use; and `lib/settings.ts` had 33 hand-written getter/setter pairs, now built on `readSetting`/`writeSetting`, which is where the "absent means the default, and `""` is the read-time fallback" rule lives in one place instead of six. No behaviour change.

### Added

- The ▲ Vercel drawer's 🔐 list has a filter once it runs past five variables: a name search and a menu for To push, On Vercel, Vercel only and No value.
- Threads ask the CLI for a 1-hour prompt cache (CLAUDE_CODE_PROMPT_CACHE_TTL), so a short break no longer re-sends the whole thread.
- **Send fresh** replaces "Continue in new card": a cold thread over 30k tokens sends your message to a new session in the same card, started from a brief (a Haiku summary written ahead of time, what's still open, and the diff of this thread's own edits) instead of re-sending the history; "Send with full history" is in the ▾ menu, and a divider in the thread shows the brief.
- An idle reply box has a **Done** button that sends /weft:done (fresh when the cache is cold).

- Stop is faster: it SIGTERMs the commands a thread is running at once, and ends the CLI after 1.5s (was 5s) if the interrupt is ignored.
- **Errors and Restart errors filters on the Review column.** Two chips in its header, each on its own: Errors keeps cards whose last line is a thread or build error, Restart errors keeps cards that hit the 5-hour session limit. An active chip shows its count; both off after a reload (`components/ReviewFilterChips.tsx`, `lib/board-view.ts`).
- **The reply box's button says what Enter does.** One mode at a time, named on a chip in the box and on the primary: Send, Queue (while a turn runs), Answer, Run (a `!` command, in green with the folder), Replace (after ↑, in amber with the file edits that stay) or Send copy. Send now, Send later and Continue here moved into a ▾ beside it; ■ Stop keeps its own slot. The default follows the thread: **New card** when the prompt cache is cold (the stale-cache row above the box is gone; **Send here** is in the ▾), **Send at <reset>** when the 5-hour window is used up, and **Continue** only after a turn that stopped short (`lib/reply-mode.ts`, `components/ReplyButtons.tsx`, `components/ReplyModeChip.tsx`).

- **🏆 Leagues in the header.** A chip beside the streak shows your league and rank ("🏆 Linen #1") and opens every league: click any tier, Cotton to Gold Thread, to see its leagues this week and who's in them (`components/LeaguesDialog.tsx`, the `league_browse` RPC). The profile's League tab keeps just your own league.

- **Continue in new card.** A thread whose prompt cache has gone cold shows a "stale cache" tag above its reply box with a **Continue in new card** button: Haiku summarizes the thread and a new card starts in the same folder and CLI with the summary, the files it touched and the message typed in the box (`lib/handoff.ts`). The button is a solid accent button, and the panel switches to the new card as soon as it exists (`lib/open-card.ts`).

- The project bar's More menu has **Clone from GitHub…**: type `owner/name` or a github.com URL and it clones into `~/dev` and selects the project.
- **Confetti for achievements.** A new badge or level opens a popup with a burst of confetti instead of a toast: one badge gets the stage, several share a list, and **See your profile** opens the Badges tab (`components/AchievementPopup.tsx`, `components/Confetti.tsx`, `lib/confetti.ts`).

- **League emails.** A welcome on the day you join a league, a Thursday and a Sunday nudge when a move is in play, and Monday's results, from a daily Vercel cron at 13:00 UTC; at most one a day, each sent once (`league_emails`), with one-click unsubscribe (`profiles.league_emails`) (`lib/league-mail*.ts`, `app/api/league/{emails,open,unsubscribe}`, `supabase/migrations/20261017171804_league_emails.sql`).

- **Tokens and plan-limit hits on your Wefter Profile.** The You tab charts your tokens for the last 30 days, from every Claude Code and puku-cli transcript, with a dot over each day you hit your 5-hour or weekly limit; two new badges, ⏳ Hit the ceiling and 🗓️ Ran the week dry, unlock on your first hit of each (`lib/usage.ts`, `lib/usage-scan.ts`, `components/LoomUsage.tsx`).

- **"Restart requested", in red.** While a restart waits for the running threads, the title bar's chip reads "⟳ Restart requested · N" (or "Update requested") in red, and the New thread dialog's header shows a red **Restart requested** pill, since a thread started then begins only after the restart (`components/RestartChip.tsx`).
- **Your weft.zip profile shows your whole Wefter Profile.** `weft.zip/@username` now has your picture in a ring that fills toward the next level, your class and level title, your GitHub bio, location, company, site, followers and repos, this week's league and rank, big numbers (XP, cards shipped, streak, badges), the builder card's radar, attributes and skills, the activity cloth, a wall of the badges you've earned, tokens for the last 30 days with plan-limit hits, your records, and your public mini apps beside your public threads. While you're signed in, your Mac posts the card every 10 minutes on the league sync's timer (never prompts, code, project names or folders), and the page parses it again before drawing it (`lib/profile-card.ts`, `lib/profile-card-sync.ts`, `components/profile/*`, `supabase/migrations/20261018135430_profile_cards.sql`).
- **A welcome on first launch.** Before any Claude Code session becomes a card, a two-screen overlay shows the Wefter Profile your sessions make (class, level, sessions, shipped, best streak, top attributes) and where each part came from, with **Opt out** / **OK**, then your projects to bring in, worktree, scratch and temp folders unticked and folded, with **Start fresh** / **OK**. OK is the default on ↵. A board that already has cards keeps working as before. Settings → General gets **Count my Claude Code history**, **Bring them in** for sessions left out, and **Replay** for the welcome (`lib/welcome.ts`, `lib/welcome-preview.ts`, `app/api/welcome`, `components/WelcomeDialog.tsx`).
- **"Your loom" is now your Wefter Profile.** The 🔥 chip's dialog has the new name; Loom stays a level title.
- **Generate a random value in the 🔐 drawer.** A 🎲 beside the value field, next to the eye, fills in a random 40-character string of letters and digits (about 238 bits, no quoting needed in a .env or shell) for the `CRON_SECRET`s and signing secrets you make up yourself (`lib/random-secret.ts`, `components/SecretValueField.tsx`).
- **Filter secrets in the 🔐 drawer.** A search box under the project filter narrows the shown vaults to the secrets whose name or blank hint holds every word typed (`stripe hook` finds `STRIPE_WEBHOOK_SECRET`); projects with no match drop out, and Escape clears it (`lib/vault-search.ts`, `components/VaultSearch.tsx`).
- **Data mini apps, and 📈 Growth.** A mini app can hold a folder (`~/.weft/apps/<slug>/`: `index.html` and a `weft-app.json` naming the project folder it reads, the vault env it asks for, and its reads by name). The page asks for that env with `window.weft.requestAccess()` (a Touch ID naming the app, project, env and keys); Electron main then runs its named reads with the env's vault values, so no value, SQL or URL comes from or goes to the page: a Postgres function through Supabase's API as a read-only GET, or a GA4 report signed with a service-account key. A changed manifest asks again. Every mini app is also stored on prod (`cloud_mini_apps`, owner only, pages by content hash) and restored on a Mac that lacks it. 📈 Growth reads Weft's own accounts, signups, active accounts, weekly retention, activation and GA4 traffic (`electron/app-data.cjs`, `electron/app-data-reads.cjs`, `electron/pane-preload.cjs`, `lib/app-cloud.ts`, `supabase/migrations/20261018054110_growth_reads.sql`, `supabase/migrations/20261018061014_cloud_mini_apps.sql`).
- **Dependabot.** `.github/dependabot.yml` checks npm (pnpm) packages and GitHub Actions weekly, with minor and patch updates grouped into one PR per ecosystem.
- **Mini apps on your profile, and Share… for them.** The 🔥 chip's You tab lists **My mini apps** under your wefter card: click one to open it in the pane, or its share button for a link. **Share…** (also on the tile's right-click menu) gives an app a `weft.zip/a/<id>` link behind the same modes as a card's: your workspace, anyone, anyone who gives an email, or a password. A local page goes up as a sandboxed copy with key-shaped text masked, refreshed each time you open Share…; a public https site is framed as is; a localhost app says it can't be reached from the link. Removing the app takes its link down (`lib/app-share.ts`, `components/ShareAppDialog.tsx`, `components/LoomApps.tsx`, `app/a/[id]`, `supabase/migrations/20261018150000_app_shares.sql`).
- **The show rail shows pictures, and the pane follows the chat.** Each page in the rail beside the browser pane is now a small picture of what the pane showed (captured when the page or the thread settles, shrunk to a 144×180 WebP of a few KB, `~/.weft/shots/`), with a short name under it; turns are lighter text rows between them. Scroll the chat and, once it settles, the pane shows the page that was on screen for the turn at its top; scroll back to the end and it returns to the newest page (`lib/page-shots.ts`, `app/api/cards/[id]/shots`, `lib/use-page-shots.ts`, `lib/use-pane-follow.ts`, `components/ShowRailItems.tsx`).
- **Done without a review tour.** A Review card whose thread wrote no tour has a **Done** button beside **Build review tour** in its review bar; it runs `/weft:done`, as a tour’s last step does (`components/ReviewPanelNoTour.tsx`).
- **Question cards: hold, retry, and a way out.** A send, number key or click in the first 0.8 s after a question appears is held (with a note saying so), so Enter on a message you were finishing no longer answers the question with it and hides the card. An answer that doesn't reach the agent brings the card back with your text and the error, instead of leaving it greyed out. **Chat about this** and **Skip** are back on the card's hint row. Notes and previews now reach the agent from the desktop board and the copilot too; both had been dropping them (`components/QuestionForm.tsx`).

- **Continue in the reply box (⌘. on the desktop, button on weft.zip).** A ▶ Continue button next to Send sends the word `continue` through the same `onSend` path a typed message uses — the same call the card-level ▶ makes (`lib/resume-actions.ts`). On the desktop, the button is hidden while a turn runs, a question waits, the box is a `!` shell command, or you're editing the last message; ⌘. does the same from the keyboard and the shortcut greys out under the same conditions; both show in the `?` sheet. The weft.zip web board's reply box gets the same ▶ button (no ⌘. — the web has no global keymap); it's hidden on a card a teammate's Mac runs (`components/ReplyBox.tsx`, `components/ReplyBoxActions.tsx`, `components/ReplyButtons.tsx`, `components/web-board/WebReplyBox.tsx`, `lib/hotkeys.ts`; new tests in `components/ReplyBox-continue.test.tsx` and `components/web-board/WebReplyBox.test.tsx`).
- **Reorder cards in the Backlog.** Drag a Backlog card onto a sibling to put it before or after — a 1px accent line on the top or bottom edge of the target shows where it'll land (top half = before, bottom = after). The order is saved as a half-step number on each card and wins over the column's chosen sort; ties fall back to it. Old cards backfill from `createdAt` on first load; other columns ignore `order` and keep their sort. If the half-step gap ever closes the column renumbers to evenly spaced values (`lib/store.ts`, `lib/board-view.ts`, `lib/use-board-card-actions.ts`, `components/BoardColumn.tsx`, `app/api/cards/[id]/route.ts`).
- **Backlog: archive, sprints and ⌘B.** Backlog cards get the archive button on hover (Done's had stopped showing on the board; it's back too). The Backlog header gains Save as sprint (the flag) and Archive all (the box), which asks first and can save the lane as a sprint before archiving it. Click **Backlog** for the list of sprints, each with what became of its cards and **Restore N** for its archived ones; rename or delete them there. In the New thread dialog, ⌘B adds the thread to the Backlog instead of bolding (`lib/sprints.ts`, `lib/sprint-store.ts`, `app/api/sprints`, `components/BacklogActions.tsx`, `components/SprintsMenu.tsx`).
- **FAQ, in the repo and on weft.zip.** `docs/FAQ.md` answers the questions people ask about Weft in plain words, from installing and the columns to CLIs, guardrails, the vault, connectors, the copilot, weft.zip, pricing, privacy and troubleshooting, with a visual tour of the real app. The home page now ends with six of them as open/close rows, each linking to its full answer on `weft.zip/faq`, which renders the same file with the home page's nav and footer (`app/faq/page.tsx`, `components/home/FaqDoc.tsx`, `lib/faq.ts`); the nav and footer link it too.
- **Dev servers in Services.** The 🖥 Services drawer has a Dev servers section: each open card's folder with the command that starts its dev server (found in `package.json` scripts, a Procfile, Rails, Django, deno, a Makefile or wrangler), a Start button, Stop and Restart once it runs, and whether it started or restarted, when, by which card (click its name to open that card), and if it answers yet. It sits first in the drawer, above the CPU and memory; Weft's own folder is listed last as the board itself, with no Start or Stop and a link to its address (`:1024 ↗`) that opens in your browser. Thread names in the services list open their card too (`lib/dev-commands.ts`, `lib/dev-launchers.ts`, `components/DevLaunchers.tsx`).
- **Mini apps.** Any page in the browser pane becomes an app: the grid button in the pane's toolbar saves it (named after its title) to the left rail, one tile per app below 🖥 Services; click a tile to open it in the pane, right-click to rename, move, copy its address or remove it. With no apps the rail shows nothing new. Kept in `~/.weft/apps.json` (`lib/mini-apps.ts`, `lib/mini-app-store.ts`, `app/api/apps`, `components/AppsRail.tsx`, `components/SaveAppButton.tsx`).
- **Limits chart on hover.** Hover over `5hr` / `7d` in the status strip for the week from one weekly reset to the next: the 5-hour limit left as 168 green hour bars (left axis), the weekly limit left as 7 see-through red day bars in front whose tops burn down hour by hour (right axis), red lines where a limit was hit, and green lines at each 5-hour reset, stronger at the next one and strongest at the weekly reset. Threads ask the CLI for their limits after each turn (at most every 5 minutes) and log each change to `~/.weft/limits.jsonl`, resets rounded to the minute (`lib/limit-history.ts`, `lib/limit-chart.ts`, `components/LimitBurndown.tsx`).
- **Services summary that says something.** The 🖥 drawer's "276% CPU · 7.9 GB" now reads "2.8 of 10 cores · 7.9 GB of 16 GB", with CPU and memory bars split by kind (threads, dev servers, Weft, terminals), and the busiest service and the biggest by memory named.
- **Editor column.** An open card is four columns: thread, editor, pane and glance, each closable (a thin strip reopens it, the ✏︎ in the thread's header for the editor, ⌥⌘1–4) and resizable by dragging the line between any two, remembered. Click a file path in the thread to open it: CodeMirror for code, TipTap for markdown (saves keep untouched lines byte for byte), a Changes view against git HEAD with per-chunk revert, ⌘S, ⌘P, live reload while the thread edits, and a conflict banner instead of a silent overwrite. Edit and Write rows in the thread show their diff (docs/architecture/editor.md).
- **Leagues.** The Loom's League tab is live: weekly leagues of up to 30 by XP, top 7 up and bottom 5 down, each builder's week (XP, shipped, streak, level, badges earned that week) and a link to their `weft.zip/@username`; a signed-in Mac posts its week every 10 minutes (`lib/league.ts`, `lib/league-sync.ts`, `app/api/league`, `components/LeagueTab.tsx`, `supabase/migrations/20261017162000_leagues.sql`).
- **Public profiles.** Every account has a page at `weft.zip/@username` (your GitHub login, lowercased): picture, name, a GitHub link, when you joined and the threads you've shared publicly; never your email or workspace (`app/u/[username]`, `lib/public-profile.ts`, docs/architecture/profiles.md).
- **Share the board.** **Share the board** (the share icon beside your avatar, its menu, ⌘K, or **Share** in the weft.zip board's header) gives your workspace's web board link, `weft.zip/<workspace>/board`, with Copy and Open, who can open it, and an email box: someone with a Weft account joins the workspace at once, someone without one gets an invite email to sign up and join (`components/ShareBoardDialog.tsx` and `components/web-board/WebShareBoard.tsx` over one `components/BoardSharePanel.tsx`, through weft.zip's team invite).
- **Workspace invites look like Weft.** The invite email now has an HTML version in the Salt Flats scene: the hovering car on top, then "Join <workspace> on Weft", who invited you and an **Accept invite** button in the scene palette; the plain text still goes with it (`lib/invite-email.ts`, images in `public/brand/email/`).
- **Reply to a thread from weft.zip, and see it answer within a second.** The open card on the web board has a reply box: what you send becomes a `reply` command for the Mac that runs the card, which sends it into the thread as if you'd typed it there (or after the running turn, shown under the box as "After this turn"). Each reply shows under the box until it lands ("Waiting for your Mac", "Sending on your Mac…", or why it couldn't, with Dismiss). A teammate's card stays read-only. The other way, a turn's items now go up within a second instead of every 10 s, and a message you send goes at once (`lib/cloud-inbox.ts`, `supabase/migrations/20261017140000_reply_commands.sql`).
- **An open card on weft.zip is the desktop's own thread panel.** Same header, the same thread view with "Working…", paging as you scroll up and the pending request, and the same reply box (Markdown composer, a message held while the turn runs, **Send now**, ■ Stop). Answer a thread's permission request or question from the web: it becomes an `answer` command the Mac runs on that exact request, and Stop a `stop`. Underneath, the panel, thread view and reply box read a transport (`lib/thread-transport.ts`), the desktop's local server by default and Supabase rows, Realtime and commands on the web (`components/web-board/useCloudTransport.ts`), instead of a second, web-only copy of each (`supabase/migrations/20261017150000_answer_stop_commands.sql`).
- **The weft.zip board looks like the desktop window.** On `/<workspace>/board` the workspace sidebar steps aside for the desktop's own chrome: its header (the Weft logo, "N running · M need you", the workspace, Live, **New thread** with N, and your avatar, whose menu switches workspaces and holds Team, Billing and Sign out), the 38px rail (★ starred filter, then Board, Team and Billing) and the desktop's `BoardColumn` (with **Add a thread** in Backlog). A card opens framed over the board like on the Mac, the thread on the left with the desktop's header (session, live, stage, what's left; no more Mac id hash) and its browser pane on the right: a synced `~/.weft/show` page runs sandboxed through a member-only route (`app/api/web-board/[orgId]/page/[sha]`), a site is framed with Open ↗, and a localhost page shows its last capture (`components/web-board/WebBoardHeader.tsx`, `WebRail.tsx`, `WebAccountMenu.tsx`, `WebPane.tsx`).
- **Services: everything Weft started, with CPU and memory.** The rail's 🖥 drawer lists every process Weft spawned, one row per thread CLI (named by its card), dev server, terminal shell or other command, each with its CPU and memory and a total at the top; expand a row for its processes and end the whole service or one process (Weft itself is listed but can't be ended there). Pick how often it refreshes (every 1 to 30s, or paused); the icon counts what's running. Dev servers keep their url, Restart and Start: threads start them through Weft with `mcp__devservers__start` (and `/weft:preview` does) instead of Bash in the background, so a server outlives its thread's CLI and no longer keeps it open; one a thread still starts the old way shows there too and leaves the thread's task strip (`lib/services.ts`, `lib/services-snapshot.ts`, `lib/services-kill.ts`, `app/api/services`, `components/ServicesDrawer.tsx`, `lib/devserver.ts`, `lib/devserver-tools.ts`).

### Fixed

- The "+N/-N" counter's **Review N cards** button can be clicked: its bubble stays open while the mouse crosses into it (`Tip`'s new `interactive` mode) instead of closing the moment you leave the counter.
- A multi-select question's `[ ]` no longer wraps into "[" over "]", and the board footer's limits line no longer peeks out under an open card.

- **"Review all" and "Resume N" stay once the board loads.** Backlog's column appears after the cards load and narrows every column below 230px, where the header hid all its actions. Narrow columns now keep them as icons (✓, ▶ N) and hide the row only under 150px, beside the open copilot lane (`components/ColumnHeader.tsx`).
- **"Show N more" no longer jumps while the board loads.** Until a card's component loaded, the column drew nothing, so "Show 5 more" floated to the top and then dropped below the cards. Each card now draws a card-sized blank first (`CardSkeleton` in `components/BoardColumn.tsx`).
- **`file.ts:42` in a thread jumps to line 42.** The editor column opened the file at the top: the request's line never reached `CodeEditor`'s `line` prop. The tab now carries it (`setLine` in `lib/editor-tabs.ts`).
- **Resting the mouse on the copilot pill peeks.** The hidden lane's pill took an `onPeek` it never called; hovering it for 350ms now opens the peek digest, a pass over it doesn't (`components/CopilotHider.tsx`).
- **No more `Date.now()` prerender errors on weft.zip's cold starts.** /login, /team, /[orgSlug]/team, /[orgSlug]/billing and /[orgSlug]/board logged "encountered the unstable value `Date.now()` while prerendering" whenever a fresh lambda built its first Supabase client: `cookies()` alone doesn't move a render past that stage, only `connection()` does. `webClient()` in `lib/web-session.ts` now awaits `connection()` first, which covers every gate (`requireTeam`, `currentWorkspaceSlug`, `readSessionIdentity`); /s, /a and /u, which reach the service client without the gate, call it themselves. `lib/prerender-check.ts` now flags a page or layout that calls `serviceClient()` before `connection()`, `webClient()` or `webUser()`.
- **The weft.zip invite page works when you're signed in.** On a cold start, building the Supabase client read `Date.now()` before anything request-bound, which cacheComponents refuses, so the page sat dimmed on "Checking your invite…"; `app/invite/[token]/page.tsx` now calls `connection()` first. The **Join** button also sits inside the invite card instead of bare on the dark page.
- **A Done card's Archive button is back.** `CardView` drew it only when given `onArchive`, which the board never passed; the card's handlers now come from `lib/card-handlers.ts`, archive included. The Done header's Archive all icon is `text-muted` so it no longer vanishes over a scene.
- **Second pentest pass (2026-10-18), six findings.** F-1: `electron/pane-routes.cjs`, which `electron/main.cjs` requires, was lost to a stash and the shell couldn't start; restored with its test. F-2: the share unlock rate limit (`lib/share-unlock-rate.ts`) is one atomic Postgres call, `share_unlock_bump` (`supabase/migrations/20261018045842_share_unlock_bump.sql`), so racing attempts can't pass the 10-per-10-minutes cap. F-3: the terminal's IPC answers the board window only, and each shell only its opener (`electron/terminal.cjs`, the M-3 fix that never landed). F-4: Keep Working's IPC answers the board window only (`electron/keep-working-ipc.cjs`). F-5: `weft://new?folder=` documented in `electron/new-thread-link.cjs` (the Start click is the gate). F-6: `POST /api/s/[id]/unlock` answers 503 off Vercel, where `x-real-ip` is caller-controlled.
- **`pnpm audit` cleanups, four of six advisories fixed.** Bumped `vitest` and `@vitest/coverage-v8` to 4.1.11 (clears `tinypool`, `vitest`, and `@vitest/mocker` advisories); added `pnpm.overrides` for `tinypool`, `braces` and `sprintf-js` to pin patched transitive versions. The two remaining (`braces`, `sprintf-js`) have no upstream patch beyond the override. Also wired the web board's reply box (a `WebReplyBox` that had been written but never rendered), fixed route test pollution in `cloud-sync-routes`/`vercel-routes` (`lib/folders.ts` `resolveFolder` now throws on empty input instead of silently using `os.homedir()`), and ran the suite on `pool: forks` to dodge vitest 4's threads-pool worker-spawn timeouts (`vitest.config.ts`).

- **Task notifications stay in the chat.** When a background command or subagent ends, the CLI tells the agent with a `<task-notification>` message that can start a turn of its own; the SDK streams only a `task_notification` event, which the runner ignored, so that turn’s reply seemed to answer nothing. The thread now shows a `<task-notification>` row with the task’s summary (red if it failed); foreground tasks, whose tool call already reports them, stay out (`lib/runner-tasks.ts`).
- **A wrap-up that can't finish stays in Review.** When `/weft:done` ends with `column=review` (it couldn't commit, the push was rejected, tests failed), the card stays on the board in Review with what's left, instead of being filed into Done and archived as if it had shipped (`lib/runner-turn.ts`). And a thread now reports `column=done` on its own only when none of its file changes are left uncommitted; with changes it reports Review, so your move to Done commits and pushes them (`lib/settings.ts`).
- **Done commits and deploys every time.** `/weft:done` commits files other cards also edited whole instead of stopping to ask or building its own git index, always pushes, and then checks the push deploys: `plugin/skills/done/deploy.mjs` confirms the linked Vercel project builds from origin's repo (by id), then waits for HEAD's build to finish behind any deploys already running. A failed build comes back with the tail of its log: the wrap-up fixes and pushes again (twice at most) when the cause is its own, else starts a card to fix the build and stays in Review. Weft's own Vercel project had stayed linked to the renamed `aimhuge/weft-history` since 2026-10-16, so 55 pushes never deployed; it's relinked to `aimhuge/weft`.
- **Orphaned background tasks read as cut off.** A resumed CLI reports the tasks a previous process exit left behind as "stopped … Orphaned by a previous Claude Code process exit"; the task strip now shows them as cut off, with a hint to send a message, and the thread is told about them on its next message (once).
- **Orphaned vitest workers.** A test run killed mid-way (a thread's Bash command stopped or timed out, a card stopped) left its `node (vitest N)` workers running under PID 1. Twelve of them hung the Mac on 2026-10-17. Workers now end themselves when their run dies (`lib/orphan-guard.ts` as a vitest setup file), stopping a card ends the process groups its Bash commands run in (`lib/process-tree.ts`), whole-suite `pnpm test` runs take turns and pass a stop on to vitest (`scripts/run-tests.mjs`), and the server reaps any orphaned worker in a project folder every 5 minutes (`lib/worker-reaper.ts`; docs/architecture/threads-and-sessions.md).
- **Security audit findings, fixed.** The first pass of `weft.zip`'s security audit found 3 medium and 5 low issues; all 8 are now resolved: the share-gate unlock rate limit moved to a Supabase `share_unlock_attempts` table keyed on a peppered SHA-256 of the client IP, with the route taking the real remote address over an `X-Forwarded-For` check (`lib/share-unlock-rate.ts`, `app/api/s/[id]/unlock/route.ts`, `supabase/migrations/20261018120000_share_unlock_attempts.sql`); the share-thread redactor now scrubs high-entropy strings (40+ char runs above 4.7 bits/char) so API tokens in code aren't surfaced to a viewer (`lib/share-redact-entropy.ts`, `lib/share-redact.ts`); the terminal drawer scopes every spawned shell to a single session id (`lib/terminal` routes); `cloud_commands` rows on Supabase are now claimed by the device that should run them, with a `BEFORE INSERT` trigger that requires the row's `device_id` to be the same account's signed-in device, and `card_id` is set only by the receiver after it creates the card (`supabase/migrations/20261018130000_cloud_commands_device_ownership.sql`, `lib/cloud-inbox.ts`); `weft://new?prompt=…` now opens the New Thread dialog pre-filled instead of starting the card itself, so a clickjacked link can't fire a thread (`electron/new-thread-link.cjs`); the dev-server launcher parses the command into argv and runs `spawn` with `shell: false`, refusing any command with shell metacharacters (`lib/devserver.ts`); and the browser pane's `open` IPC handler now only answers the board window's sender, so a compromised renderer can't navigate the pane to an arbitrary URL (`electron/main.cjs`, `electron/browser-pane.cjs`, `electron/pane-origins.cjs`).

### Changed

- **One "Link <folder> to…" picker for every provider drawer.** ▲ Vercel, Supabase, Cloudflare and 🚀 BlastCP used to ship four near-identical searchable-list pickers; they now share `components/DbSelect.tsx` for the UI (search, loading/empty notes, row list, Cancel, "best fit" badge, optional "+ New project" slot) and `lib/db-picker.ts` `rankItems` for the shared filter-then-sort loop. Each picker keeps its own score (`matchScore` in its `*-view.ts`), so the row tiers don't change. Adding a fifth provider is one file that calls `DbSelect`, not another list UI to write.
- **Delete only before the first full turn.** A thread's header shows the trash button only until the card finishes its first turn: deleting a wrong start stops its CLI and saves the tokens. After that the header offers only Archive (`hasFinishedTurn` in `components/CardActions.tsx`).
- **No delete before the first turn.** The thread header's trash button stays hidden until the card has finished a full turn (or holds an idle saved session, like an imported one), so a stray click can't delete a thread that's still starting (`hasFinishedTurn` in `components/CardActions.tsx`).
- **Rail drawers slide out from under the board.** Clicking 🏷, 🔐, 🪝, ▲, Supabase, Cloudflare, BlastCP, GitHub or 🖥 Services now pulls its drawer out from beneath the board, which moves over and lies on it as a sheet with a rounded, shadowed left edge; closing slides the drawer back under. Pin now means Esc leaves it out (`lib/use-slide-out.ts`, `.board-sheet` in `app/globals.css`).

- **Card titles aren't cut at four words.** Haiku names a card in 3 to 6 words, and a title over six words that you didn't type (a thread's `create_card` title, an old one clipped with "…") is rewritten by Haiku after the card's next turn instead of being clipped (`lib/retitle.ts`, `lib/format.ts`).
- **Threads apply their own migrations, and ask with buttons.** A thread that writes a migration for a linked Supabase project applies it in the same turn, renames the file to the version Supabase stamped and checks the advisors, instead of asking whether to; it asks first only when the migration drops or rewrites data. Any choice a thread still needs from you comes as AskUserQuestion buttons, not a question at the end of its reply, and the Supabase drawer's **Migrate** card asks for its OK the same way (`lib/decisions-prompt.ts`, `lib/supabase-migrate.ts`).

## [0.4.0] - 2026-10-17

### Added

- **Software Update window.** Weft → Check for Updates… opens a window instead of a message box: this Mac's version, the newest, when it last checked, the release notes, and one button for the next step (Check Now, Download…, Restart to Update). A missing feed reads as "No Weft release is published on GitHub yet" (`electron/update-window.cjs`, `electron/update-view.cjs`).
- **Context and limits stay in view in Review and New thread.** A Review card's status strip (ctx, cache, tokens, 5hr/7d) now shows under the review panel instead of vanishing with the reply box, and the New thread dialog shows the folder and the picked CLI's 5hr/7d limits, which the board's footer under it used to hide (`components/ThreadView.tsx`, `components/NewCardDialog.tsx`, `planLimitsFor` in `lib/board-view.ts`).
- **A scene on first launch.** With no Appearance chosen yet, the board opens on a scene instead of plain System: Twin Suns when the Mac is in dark mode, Salt Flats in light mode, and keeps it until you pick another (`FIRST_SCENES` in `lib/theme.ts`).
- **Prerender check.** What only `next build` refuses under cacheComponents now fails `pnpm test` and is caught at edit time: a route segment config export (`dynamic`, `revalidate`, `fetchCache`, `dynamicParams`) is refused, and `await params`/`searchParams`/`cookies()`/`headers()` in a page's default export or generateMetadata outside `<Suspense>` gets a warning (`lib/prerender-check.ts`, docs/architecture/thread-guards.md).
- **Copilot personas.** The copilot's name in its lane header picks who it is: Wingman (runs the board, as before), Founder (tests the business first: competitors, buyers, pricing, unit economics; after founder-skill) or Captain (runs a think → plan → build → review → test → ship sprint; after gstack). Each has its own picture; switching starts a new chat (`lib/copilot-personas.ts`).
- **Share a card.** **Share…** on a card makes a `weft.zip/s/<id>` link that shows its thread and its browser pane side by side, live: private to the workspace, public, behind an email or a password (`@aimhuge/share`). Shown pages run sandboxed, a localhost page shows as its latest capture, key-shaped text is masked and long tool outputs aren't shared (docs/architecture/sharing.md).

- **Threads keep track of their subagents.** Weft now reads the task events the CLI sends for every subagent and background command (started, progress, finished, the live set) and keeps them on the card: the thread panel shows a line above the reply box ("3 subagents running · 2 done") that opens to each one's elapsed time, tool count and latest line, and the card's footer counts the running ones (⑂3). An idle CLI with a background task running is no longer closed, which used to kill the task with it. When a CLI does end (a Weft restart), its running tasks are marked cut off and the thread is told on your next message, so it stops waiting for reports that will never come (`lib/tasks.ts`, `lib/task-ledger.ts`, `components/TaskStrip.tsx`).
- **Stop a thread's subagent or background command.** Each running row in the thread's task strip has a ■ Stop, which asks the CLI to end just that task (the SDK's `stopTask`); a task whose CLI is already gone is marked stopped (`lib/task-stop.ts`, `app/api/cards/[id]/tasks/[taskId]/stop`).
- **Dev servers have their own list.** The rail's 🖥 drawer lists every dev server for the board, with how long it has run, its url (opens in the pane), Restart and Stop; the icon counts the running ones. Threads start servers through Weft with `mcp__devservers__start` (and `/weft:preview` does) instead of Bash in the background, so a server outlives its thread's CLI and no longer keeps it open. Servers a thread still starts the old way show in the drawer too, and leave the thread's task strip (`lib/devserver.ts`, `lib/devserver-tools.ts`, `components/DevServersDrawer.tsx`).
- **Drag files from Finder anywhere in Weft.** Drop on a card to open it with the files in its reply box, on an open thread (or the copilot) to attach them there, or on empty board to start a new thread with them; a pill says where they'll go. A file let go outside a composer no longer navigates the board away (`lib/file-drop.ts`, `lib/use-file-drop.ts`, `components/FileDrop.tsx`).
- **Weft asks before a thread leaves its project.** A file tool or Bash command that reaches a folder outside the card's project (say `~/Downloads`) now stops at a permission prompt with an **Outside project** chip, whether or not macOS would have refused it: **Allow once**, **This card** (its read scope) or **Always** (every card, `settings.allowedFolders`). Granted folders skip the CLI's own working-directory prompt for reads (`lib/folder-guard.ts`).
- **Threads can ask macOS for Downloads, Documents or Desktop.** A thread got "Operation not permitted" reading `~/Downloads` (say a new audio file to transcribe) because macOS blocks the folder until Weft is allowed. Now it calls `mcp__board__request_folder_access` (after such a refusal, or when you say to use files there; never on launch): macOS shows its own allow prompt the first time, and if the answer was already No a dialog explains it and **Open Settings** goes to Privacy & Security → Files and Folders (`electron/folder-access.cjs`, `lib/folder-access-tool.ts`). The packaged app carries `NSDownloadsFolderUsageDescription`.
- **A fresh coat of paint for the weft.zip dashboard.** The workspace pages (Team, Billing, the web board) get a sidebar with the workspace switcher, the current page lit, and your account at the foot (a top bar on a phone); raised surfaces, stat tiles and avatars on Team, a plan card, usage glow and price tiles on Billing; the Weft mark and a spinner on the /team, /app and invite cards; a lighter admin bar. Weft's own photography runs through it: the speeder crossing the dunes at the sidebar's foot, a road under each page's title (Coast Road on Team, Canyon on Billing) and the twin-suns scene behind the sign-in-style cards (`public/brand/scenes`, copies of the board's theme pictures). Team's banner is a generated render of a crew of mechanics in a garage with the speeder (`public/brand/scenes/garage.jpg`), and Billing's invoices are tickets with a stub, a status glow and a scan stripe, and each opens its own full invoice page (`/<workspace>/billing/invoices/<number>`: the speeder at sunset, a status stamp, line items with proration and credits, a gradient total, links to the Stripe PDF and hosted page; Print makes a PDF too). One self-contained stylesheet (`components/team/team.css`, root `.wz-app`), so a direct hit on /team or an invite link no longer depends on the home page's CSS having loaded.
- A new copilot chat suggests what to ask from everything Weft knows about your work (open cards in full, the uncommitted pile, quality and scout, streak, blanks, Vercel, Supabase, GitHub), most urgent first, above seven new starters ("Help me get started with Weft", …); the chips refresh in the background and wrap to fit the lane. Each chip is labeled with its project, so the chat shows only the selected project's chips (plus account-wide ones), and switching projects filters at once without a new run.
- The copilot onboards you: it knows what isn't linked yet (Weft account, GitHub CLI, Vercel, Supabase, Cloudflare, analytics), offers the one link that helps, and points you at the right drawer.
- **License: FSL-1.1-ALv2.** Weft moves from Apache-2.0 to the Functional Source License: fork, change, self-host and use it at work, but don't ship it as a competing product or service. Each release becomes Apache-2.0 two years after it ships; v0.3.0 and earlier stay Apache-2.0. New `TRADEMARKS.md`: forks you share need their own name and icon.
- **Terms of Service at weft.zip/terms.** What the online services cover (accounts, workspaces, sync, the relay, plans), fair use (no scraping, no unofficial clients or forks calling Weft's servers, no cheating for streaks or stretching free limits), and that your content stays yours. Linked from the home page footer.

- **Readable edit prompts.** A held Edit or Write (the symbol-claim "Wait, or go ahead?" or any other permission prompt) shows who asks, the file, the function it changes, +added −removed and a short diff with real line breaks, instead of escaped JSON, and says why it asked as a category (Same code, Overlapping code, Whole file, or Permission mode) with the card holding the code. When another card holds the code, **Wait** comes first: the edit stays held until that card finishes or commits, then the thread re-reads the file and redoes the edit on top. **Raw** still shows the JSON (`lib/edit-preview.ts`, `components/PermissionInput.tsx`).

- **Import guards read the project's tsconfig paths.** The route-import guard and the after-edit import check used to treat `@/x` as the project root's `x`, so in DeckCP (`@/*` → `./src/*`) a valid `src/app/**/page.tsx` import was refused. Aliases now come from the edited file's project `tsconfig.json` (`compilerOptions.paths` against `baseUrl`, a relative `extends` followed), and `@/` with no mapping tries the root, then `src/` (`lib/ts-paths.ts`).
- **Dropped-import guard.** An edit that removes an import the file still uses (the board's "columnMinWidth is not defined") is reported to the thread right away (`lib/dropped-imports.ts`). The `.claude/settings.json` guards now also run for a `puku-cli -p` or `claude -p` a thread starts, which used to skip them (`lib/weft-thread.ts`).

- **New thread on the weft.zip board.** Pick one of your synced folders, write a prompt and your Mac makes the card and runs it, then the board opens it. The request is a `cloud_commands` row the Mac claims over Realtime (and a 30 s check); it only obeys your own account's requests for a folder switched on in Settings → Sync, and uses its own permission setting. `POST /api/cards` and the inbox now share `lib/new-card.ts`.
- Settings → Models → **Review all** picks the Claude model the Review column's "Review all" card runs on (default: the CLI's own).
- Pasted and dropped PNG, JPEG and GIF chat attachments are converted to WebP on upload to reduce disk and prompt image size. Tool screenshots and the pane thumbnail after each turn are saved as WebP too, and images Weft picks up from a session it reads (pasted into Claude Code, or shown with `![...](path)`) get a WebP beside them that later reads use.
- Codex and Puku threads match Claude Code outside Weft's own folder. Codex gets Weft's browser, board, secrets, webhook and board-view tools (a per-turn token and `/api/mcp/[server]`, shown in the thread as `mcp__server__tool`), the project's `CLAUDE.md` (Codex loads `AGENTS.md` only, and DeckCP keeps its instructions in `CLAUDE.md`), and both Codex and Puku get the folder's and your `.claude/skills` as an index plus `/name` expanded to the skill. Puku's project instructions also stop cutting at 60,000 characters (now 100,000), so DeckCP's 66 KB `CLAUDE.md` arrives whole.
- Super-admin pages on the left rail: a 🛡 **Admin** icon (visible only to addresses on `SUPER_ADMIN_EMAILS`) opens `/admin/users`, a paginated, searchable list of every weft.zip account, with a companion `/admin/settings` page that shows the local install's data dir, version, uptime, card and thread counts, activity log size and keep-alive setting. Built on `@aimhuge/admin`'s `AdminTablePage`, gated by `@aimhuge/teams`'s `isSuperAdmin` via `lib/admin.ts`; the check is server-side and the routes 404 for non-admins.
- Server-side cards, off by default: Settings → Sync turns on a project, and its cards and threads upload to your workspace on
  Supabase (pictures and pages once each by content); the page shows the last sync, items uploaded, how many wait and the last
  error, with Sync now (docs/architecture/cloud-sync.md).
- The web board: `weft.zip/<workspace>/board` shows the synced cards in their columns, live, and opens a card's thread (read-only). It draws the desktop's own `CardView` (read-only), column headers, project chips, filter box, sort and archived toggle, and a card's thread through `ThreadEntries` and `Markdown` (oldest first, tool runs folded to "Ran 3 commands", tables and code blocks, pictures through signed links, a trimmed tool output loading from `cloud_tool_outputs` when its row opens), so the two boards stay in step.
- Threads load their newest 50 items first and older ones as you scroll up; a tool's output over 2 KB loads when you open its row.
- Settings → Models has a Copilot row: pick which Claude model the copilot thread runs on. The copilot is locked to Claude Code, so only Claude models appear; the default follows the model you last picked for new threads. The pick is read once when the copilot card is first made, so it takes effect on the next "New chat" in the copilot lane.
- A new tagline, "Engineering the future, one thread at a time": on weft.zip's hero (under an "Agentic engineering, on your Mac" eyebrow), its title and social card, the start screen, About and the README. Under the screenshot, five pillars: code review, the copilot, social, connectors and the vault.

### Fixed

- **A checkout in Desktop, Documents or Downloads says why it won't open.** macOS guards those folders per app, so Weft started by macOS (a `weft://` sign-in link through the Weft Dev wrapper, a restart) couldn't read its own `package.json` and showed Electron's bare "Error launching app … EPERM". `pnpm desktop` now warns about such a checkout, and the wrapper checks it can read the folder first and, when it can't, shows a dialog saying to move it (e.g. to `~/dev/weft`) or allow it in Privacy & Security → Files and Folders (`scripts/dev-protocol.cjs`).
- **Threads sync again.** One thread item holding a NUL character (a terminal's output, say) made Postgres refuse the whole batch ("unsupported Unicode escape sequence"), and since the flush sent every waiting item in one request and kept them all on error, nothing had uploaded since sync was turned on (39,000 entries waiting). Rows are now scrubbed of NULs and lone surrogates, items go up 100 to a request and leave the outbox as each chunk lands, and a row the server still refuses for good is skipped and named on the Sync page instead of blocking the rest (`lib/cloud-sync-upload.ts`).
- **A dropped connection reads as a message, not a crash.** Flipping a Settings → Sync switch while the server restarted threw an unhandled "Failed to fetch" overlay. The fetch client now says "Couldn't reach Weft's server" and survives an HTML error page; the Sync page shows a failed switch or Sync now under its card; the magic-link form and ten API routes (stop, release, delete card, tool result, attachments, copilot, skills, MCP) catch and answer with JSON (`lib/client-api.ts`, `components/SyncSettings.tsx`).
- The after-edit import check no longer calls `import { toAxes } from "../axes.js"` missing when the file is `axes.ts`. TypeScript ESM (NodeNext, `verbatimModuleSyntax`) writes imports this way. A `.js`, `.jsx`, `.mjs` or `.cjs` specifier with no file behind it now also tries `.ts`/`.tsx`, `.tsx`, `.mts` or `.cts` (`lib/import-check.ts`).
- The copilot's **New chat** clears the conversation every time. The thread view kept its own copy of the old messages and only redrew after a remount, so the old chat often stayed up and the next reply landed on top of it. Clearing a thread now tells every open view (`thread_cleared`), and the button reads "Starting…" while the old CLI winds down, so a slow reset no longer invites five more clicks.
- The board no longer gets stuck on its gray placeholder cards right after launch. Some launches sent Next's dev server into a loop where each request for the board applied a server update that counted as a change, so the board refetched and remounted a couple of times a second until Weft restarted. Turbopack's server Fast Refresh is off now (`next.config.ts`); a server file edit still reaches the board on its next request.
- A Review card no longer opens the browser pane on a dead port like `127.0.0.1:4567`. When a tour left out its `url`, Weft guessed the app from every local address in the thread, tool output included, so a grep over Weft's own tests (which use a fake `127.0.0.1:4567`) won. Now the guess counts only the thread's replies and the pages it opened, and it doesn't run when every step already names its own page (`lib/review-tour.ts`).
- The board, home page and social preview use locally hosted fonts, so production builds no longer wait on Google Fonts requests;
  the home page's GitHub release-feed lookup now times out after three seconds.
- A review step that points at a local page with an anchor or query (`tour.html#built`) now opens that section;
  the `#` used to be encoded into the filename and the pane showed nothing.
- The Supabase drawer counted a migration applied through the MCP (which stamps its own version) as not applied; it
  now matches by name too and says how many sit under another version.
- The Puku trial proxy on the deployed Weft used to forward both `x-api-key` and `Authorization: Bearer` upstream;
  `api-cli.puku.sh` answers `multiple_credentials` when it gets both, so the proxy now forwards only `x-api-key`
  (`lib/puku-proxy.ts`). Inbound still accepts either header from puku-cli.

### Changed

- The Share dialog opens at once with the card's link (remembered on the card) instead of "Loading…" while Supabase answers.
- **Smaller files.** 21 of the 26 files over 300 lines were split into focused modules, behavior unchanged (`Board.tsx` 1,078 → 849, `Composer.tsx` 614 → 281, `lib/import.ts`, `lib/types.ts`, `lib/secret-guard.ts`, `lib/client.ts` now re-export from `lib/import-*`, `lib/types-*`, `lib/secret-guard-*`, `lib/client-*`); Settings pages are one file each (`components/Settings*Page.tsx`). The quality checker no longer counts paths in a `Status: design` doc as stale.

- The copilot is a lane on the right of the board instead of a card: minimized it's a column with what finished, what needs you, its latest reply and an ask box; open (⌘J or the ✨ button) it's the chat over a cockpit picture, the copilot in a flight helmet in the seat beside you, while the five columns narrow to stay in view.
- The copilot's lane has three states now (Intercom-style hider): the default is a 36px pill pinned to the right edge (avatar, needs-you dot, news count, vertical "Copilot" label) so it doesn't eat board width; ⌘J cycles it to a 236px peek (the digest column) and then to the 520px chat. The peek auto-closes 6s after the mouse leaves; the columns keep their 170px floor when hidden, 120px when peek or open.

- Settings → Team looks like the rest of Settings (one card per section, a role pill and member count, email, role and Send invite on one line) and opens already loaded: the team is fetched as soon as you sign in. Invites default to Member instead of Owner, and the roster says "Owner", not "owner".

- A thread's questions are asked the Claude Code way: numbered options with ↑/↓, number keys and Enter, checkboxes for multi-select, a tab per question plus a Submit tab (text typed there goes with the answers as a note on all of them; no separate Chat about this). The reply box is the only input (your own answer, or a note on your pick, sent to the CLI as annotations), text already in it carries over, and option previews show in the browser pane.

- Cards take turns at `pnpm typecheck` and `pnpm lint` (and the pre-commit hook's tsc) instead of all checking the whole repo at once, and a new Bash guard sends a direct `npx tsc` or `eslint` through them; tsc and ESLint also skip leftover installs like `node_modules.npm-old`, cutting tsc's file count by 79%.

- New thread: while Weft makes the thread, Start reads "Starting…" with a spinner (Add to backlog reads "Adding…"), and both buttons dim clearly, instead of just going quietly unclickable.
- Weft now builds with pnpm (hoisted node_modules); run `pnpm install` instead of `npm install`.

### Added

- **Migrate** in the Supabase drawer: starts a card that reviews the pending migrations, applies them on your OK and
  renames local files to the versions Supabase recorded.

- A glance rail beside the browser pane's page: one small card per turn of the open thread (a status dot, its first words, how long ago) and per page the pane showed, newest at the bottom like the chat. Each message you send remembers the page on screen then. Click one to scroll the chat to that turn and put the pane back on the page it showed then; scroll the chat and the turn at its top lights up. It hides in windows narrower than 980 px.
- **Codex CLI backend**: choose Codex for a new thread, resume its saved session between turns, set its sandbox mode and reasoning effort, switch cards between Claude Code, puku-cli and Codex, and check its login status. Codex uses its own CLI tools; Weft's browser, board, secrets and webhook MCP tools and per-tool guards aren't available in Codex threads.
- **Shortcuts discoverability**: Settings → Shortcuts now lists every shortcut in the app, grouped by
  what they do, in addition to the rebindable dictation row; users landing here for help see the full
  set without having to learn the `?` key first.
- Weft teams on weft.zip: every account gets a workspace; owners and admins invite people by email, change roles and remove
  members at `/<workspace>/team`, and **Your team** in the account menu opens it in the pane (docs/architecture/teams.md).
- Weft Pro: workspace billing on weft.zip (Stripe Checkout and portal), with a monthly Puku allowance in place of the daily
  trial cap; Settings → Accounts shows your plan and usage.
- weft.zip sign-in has its own cookie session (`/auth/sign-in`, `/auth/callback`, `/auth/sign-out`), so each visitor is their own account.
- ▲ Vercel drawer: **Push all** sends every 🔐 vault value to the linked project, in every environment, behind one Touch ID.
- `mcp__secrets__set_value`: a thread stores a secret it generated (a signing secret) into one of its 🔐 blanks after Touch ID,
  blanks only, value never echoed (`electron/vault-routes.cjs`, `POST /secrets/set`; docs/architecture/secrets.md).
- Vercel drawer: pull plain env variables the 🔐 vault has no value for (never replacing one), and **Live pull from Vercel**,
  a team webhook relayed by the deployed Weft and Supabase that pulls them as they're added (`lib/vercel-hooks.ts`,
  `lib/vercel-relay.ts`; docs/architecture/vercel.md).
- **Cloudflare setup token**: the Cloudflare drawer asks for a setup token ("Create additional tokens" template); Weft
  makes its own narrower token with it (account settings, Workers, Pages), keeps that in the Keychain and deletes the
  setup token. The token form is bigger, with numbered steps. A token you made yourself still works as before.
- **Settings, reorganized**: Settings fills the window over one of Weft's scenes (yours, if you picked one), with six pages
  down the left (General, Models, Threads, Automations, Shortcuts, Accounts) as frosted cards and no tabs. Models holds
  every model pick: new threads' CLI, model and effort, subagents, and the Done wrap-up. A dot marks a page with edits waiting for Save.
- **Last opened card**: the card you opened last keeps a neutral ink outline after you close it, so you can find your
  place; unseen cards keep the accent border, tint and dot.
- **Model on the card**: a card's footer names the model its thread runs on ("Opus 5.5") beside the CLI dot, in the
  CLI's colour; hover it for the full id and effort.
- **Login page redesign**: `/login` on weft.zip is two panels: Weft's twin-suns speeder with "Pick up the thread."
  over the sky on the left, and on the right the cockpit picture (the copilot's pilot) with the sign-in as a glass
  card over the dash and a cream **Continue with GitHub** button. It stacks on a phone. Replaces the slide-editor
  framing (crop handles, coordinates).
- **Sign in on weft.zip**: the deployed site has a real `/login` page (`app/login/page.tsx`) with
  **Continue with GitHub** (no Google, no magic link on the new page). The board's top-bar sign-in,
  Settings → Weft account, and the Puku-trial upgrade prompt keep the same flow. A new
  `app/api/auth/callback` GET route (and `/api/auth/weft-callback` POST) replace the old
  `app/api/account/*` JSON surface; the in-app hook is `useAuth` from a thin `lib/auth/` wrapper
  whose public API mirrors `@aimhuge/auth`, so swapping to the package upstream is one line.
  `safeNextPath` rejects open-redirect tricks on `?next=`. Home page has a **Sign in** link in the nav
  when signed out, hidden when signed in. The deployed post-sign-in landing is a small "you're in"
  card at `/app` (`app/app/page.tsx`) with the desktop download CTA.
- **Restart when idle**: Weft → Restart When Idle, the command palette or a thread's `mcp__board__restart_weft_when_idle`
  stops new turns from starting and restarts Weft once the running ones end. Messages sent meanwhile wait on their card
  and go out after the restart; the header's **⟳ Restart after N** names what it waits on and cancels on click. The
  updater's "threads are still running" question offers it too, as **Restart When Idle**.
- **Failed loads say why**: when a page in the browser pane fails to load (a dev server that isn't running, a bad
  address, no network), the pane shows Weft's own error page (`electron/pane-error.html`) in place of Chromium's
  blank white one. It names the URL and the reason, offers **Try again** and **Back to the last page**, and for a
  local dev server reloads by itself once the server answers. The toolbar keeps the failed URL, and the error page is
  never saved as the card's page.

### Changed

- The Running and Needs you columns show **Switch all** only once a thread hit its plan limit (`hitPlanLimit` in `lib/board-view.ts`).

### Fixed

- **Editing one of Weft's prompts reaches idle threads**: the build fingerprint hashed the runner's source but not the text of the prompts it appends, so after an edit to `BROWSER_PROMPT`, `SECRETS_PROMPT` and the like an idle session kept the old prompt until it ended. Every pinned prompt now lives in one list (`WEFT_PINNED_PROMPTS`, `weftSystemPrompt()` in `lib/weft-prompts.ts`) whose content is part of `currentBuild()`, and a new first line names SOUL.md and AGENTS.md as the source of truth for Weft's identity and conventions.

- **A message after an early Stop continues the conversation**: a card only learned its session id from the CLI's init, which puku can take 15s or more to send, so a thread stopped before then lost it and "continue" started a new conversation ("I don't have prior context"). Weft now picks a new conversation's id itself (`--session-id`) and keeps it on the card from the first message (`lib/runner-session.ts` open, `lib/runner.ts`); Claude Code cards had the same gap.

- **Puku threads know where they are in any project**: Puku's gateway drops the system prompt a client sends, and puku-cli reads only PUKU.md, so a puku card outside Weft's folder started without its working directory, the project's CLAUDE.md/AGENTS.md, or Weft's thread prompt (no BOARD STATUS, pane or vault). Each puku CLI's first message now carries all three in a `<system-reminder>` (`lib/puku-context.ts`, docs/bug-fixes/015).
- **`/weft:done` no longer leaves scratch files in the project**: each wrap-up's prompts, `tasks.json` and batch
  output go to its own `~/.weft/done/run-XXXXXX/` (`plugin/skills/done/scratch.sh`), removed at the end and pruned
  after a day, so they stay out of the commit pile and wrap-ups running at once can't overwrite each other's notes.
  The old in-repo paths (`.done-batch/`, `.scratch/`, `plugin/skills/done/{out,scratch}/`…) are gitignored.
- **Puku login dialog no longer pops again after a successful browser sign-in**: a recent puku-cli update made
  the credential visible to `auth status` only after the `auth login` child had already closed, so Weft's single
  immediate re-check ran too early. `lib/login.ts` `onExit` now polls `auth status` every 3 s for up to 10 s
  before declaring the login failed, so the dialog closes the moment the CLI sees the new credential and the
  waiting card retries.
- **No more "This thread is already running"**: a message that reaches a busy thread from its page (Tell me what
  to change, a failed commit's note) waits on the card as "after this turn" in the reply queue and goes as the turn
  ends. "Commit and run /done" on a busy card runs /done once its turn is over instead of failing.

- A card switched to puku-cli no longer keeps its Claude model ("Fable 5.1" on puku, which the gateway quietly ran as
  puku-ai-2.8): it moves to puku's default, and the thread header's model chip now lists each CLI's models to pick from.
- "Review all" on the Review column opens the walk-through card it starts, instead of leaving it to land unseen
  among the other Review cards.
- Idle puku threads no longer burn CPU. puku-cli ran a forced, full Node garbage collection every second (a
  `setInterval(gc, 1000)` it took from Claude Code, where it's Bun's cheap hint), so each idle puku CLI used 8-15%
  and ten pegged the Mac. Weft now starts puku-cli with `PUKU_CLI_DISABLE_HEAP_RELAUNCH=1`, which leaves `gc`
  unexposed (idle: 0.1%) and runs puku as one process instead of a wrapper plus `Puku`. Puku is also held tighter:
  2 idle puku CLIs at most, closed after 10 idle minutes, and one puku spare that isn't refilled after a card
  takes it (`lib/puku-idle.ts`).
- Ending a puku thread ends its `Puku` process too. puku-cli's `node` wrapper left its `Puku` child running under
  PID 1 at 10-30% CPU after every idle close, stop or server restart. Each thread CLI now starts in a process group
  of its own that ends as a whole (`lib/cli-process.ts`); the server takes every CLI with it when it exits, and on
  start it ends the orphaned ones an earlier server left in Weft's project folders (`lib/cli-reaper.ts`). A puku you
  run in a terminal is never touched.
- The board stays on one port again: it now prefers 127.0.0.1:1024. The old 1000 is a privileged port macOS won't
  let Weft bind, so every launch fell back to a random port and cards' panes, dev OAuth redirects and saved pages
  pointed at a dead one.
- The email forwarder drops mail to `dmarc@`, `postmaster@` and `abuse@` (and their sub-addresses) instead of
  forwarding them: a 200 with the reason in Vercel logs, so Resend doesn't retry and your inbox stays clean
  (`shouldDrop` in `lib/email-forward.ts`).
- The "Run a command with secrets?" approval names the card asking and shows the thread's reason, so you know
  which thread wants a secret and why before you allow it.
- At most 8 idle card CLIs stay open; past that the least recently used close and resume on your next message, so
  a long day no longer leaves dozens of CLIs (and their MCP servers) slowing the Mac and the board.
- A pasted file whose bytes are sent shows "Saving…", and fails after a minute without a reply instead of
  spinning at "Uploading 100%" forever.

### Added
- **Blanks are the default for missing secrets.** A thread that needs a key it doesn't have puts the name in
  the vault as a blank right away with `mcp__secrets__add_blank` (with a hint for where to get the value),
  keeps going, and the user fills the blanks in from 🔐 on the rail when they're ready. The rail's badge
  counts them, blanks sort first within each environment, every blank row has a visible **Fill in** button
  and the hint under the name, the right-click menu's **Set Value…** becomes **Fill In Value…**, and the
  plain Add form's button reads **Add blank / Add N blanks** until a value is typed. `mcp__secrets__ask_add`
  stays as the urgent path (an input for the key in the thread). `lib/secret-ask.ts` `ASK_PROMPT` is the
  new default, `electron/vault.cjs` `addBlanks` stores the hint and source, `lib/vault-view.ts` `saveLabel` /
  `blankTitle` / blank-first sort name the UI, `components/SecretRow.tsx` and `components/VaultParts.tsx`
  draw it. Older shells without `addBlank` keep the "type a value" form.
- **Review all** at the top of the Review column starts the same commit walk-through card as the header's "+N/-N" counter (`lib/pile-review.ts`).
- Supabase drawer: each unapplied migration's name opens the card that wrote it (`migrationOwner` in `lib/supabase-view.ts`).
- Email at weft.zip: Resend receives every mail to the domain and the deployed Weft forwards it to one inbox (`app/api/email/webhook`,
  `lib/email-forward.ts`; `npm run resend` sets up the Resend side through the vault; docs/architecture/email-forwarding.md).
- Home page for weft.zip: the deployed Weft (Vercel) renders a landing page at `/` instead of the board (`components/home/`,
  `lib/home.ts`; `/home` on a local Weft). One screen: the steel weave emblem, the headline and one sentence over the twin suns
  scene, a download button that reads the latest release feed (`lib/home-release.ts`) and a real screenshot of the board
  (`public/brand/board.png`).
  `app/opengraph-image.tsx` draws the shared-link picture on the twin suns scene.
- The thread header's CLI chip names the model and effort the thread runs on ("Opus 5.5 · xhigh"), from its CLI's
  init, with your Claude Code `effortLevel` when the card picked none; hover it for the full id.
- Puku trial: puku threads work with no Puku account. Signed in to your Weft account, a puku-cli with no login of
  its own runs on Weft's Puku key through the deployed Weft (`/api/puku/v1`, a streaming pass-through that checks a
  signed day-long token, meters each account per day and answers 429 over 300 requests or 2M tokens); the key never
  ships in the app. Signed out, Puku's login pop-up offers **Sign in to Weft**, and signing in runs the waiting
  threads again (docs/architecture/puku-trial.md).
- Weft.app ships its own toolchain, so a fresh Mac with no Node can build Next.js + Supabase projects: `node`, `npm`,
  `npx`, `pnpm`, `pnpx`, `puku-cli` and `claude` in `Resources/toolchain/bin`, all on Weft's own Electron as Node and
  appended to the end of PATH, so a Mac's own tools still win. puku-cli ships without its OpenTelemetry and Sentry
  telemetry (426 → 196 MB) (`scripts/bundle-toolchain.mjs`).
- Subagents: every thread's prompt says when to hand work to a subagent (broad searches, independent pieces in
  parallel, test and lint runs, second-opinion reviews), and Settings → Use for subagents picks their model: let
  the model choose (the default, with a short Haiku / Sonnet / Opus guide), the thread's own, or any Claude or Puku
  model; a model from the other CLI runs that CLI headless (`puku-cli -p` / `claude -p`) as the subagent. Changing it, or the thread prompt, now replaces idle CLIs so their next message uses it.
- Symbol claims: a card claims the top-level function, component, class or type its thread edits (found with the
  TypeScript parser; inside one over 150 lines, the statement holding the edit, like `Board/useEffect#3`), and when another busy card in the same folder goes to edit it, the thread asks: "Card ‘Fix
  login’ is editing LoginForm in Login.tsx. Wait, or go ahead?" Claims drop at Done, on archive and on commit.
- Vault → Vercel env push: the ▲ drawer lines each linked project's 🔐 secrets up with its Vercel variables per
  environment and pushes one with **Push** (sensitive, Touch ID per push); threads can do it with
  `mcp__secrets__push_to_vercel`.
- A thread blocked on a key the 🔐 vault doesn't hold (`mcp__secrets__ask_add`) shows an input for it right in the
  thread, name filled in: paste the value, **Add to vault**, and the thread is told it's in. The value never reaches it.
- GitHub on the left rail: its mark opens a drawer with the `gh` CLI's sign-in (or how to sign in) and, per project, its
  repo, an **Issues → Backlog cards** switch, the last sync and **Sync now**.
- Instant GitHub issue sync: **Instant, by webhook** in the GitHub drawer adds a repo webhook relayed by the deployed
  Weft on Vercel (it checks GitHub's signature) and Weft's Supabase (Realtime), so cards follow issues within seconds.
- Cloudflare on the left rail: its cloud under Supabase's bolt opens a drawer that links a project to a Worker or Pages
  project (token kept in the Keychain, best fit from the folder's wrangler config), with its address, latest deploy and
  dashboard links.
- The Supabase drawer makes projects: **+ New project** in Link… names it after the repo, asks the org (with more than one)
  and region (where most of your projects are), creates it through the Management API and links the folder. Weft makes
  the database password and keeps it in the folder's 🔐 vault as `SUPABASE_DB_PASSWORD`, never shown.
- BlastCP's property picker can make a new property: **+ New property** names it after your search or the project, asks
  which workspace when you have more than one, creates it on BlastCP (with its starter voice and playbooks) and links the project.
- Your loom: the builder card is now your wefter card, "Wefter: name · class", with your GitHub profile (picture, @login,
  bio, location, company, site, followers, repos) from `gh api user`; the streak reads "Wefting streak, N days straight".
- `!` in a reply box runs a shell command in the card's folder (`lib/shell.ts`), like Claude Code's bash mode: the box
  turns amber, the thread shows the command and its output, and the output goes to Claude with your next message.
  Two-minute limit, keys in the output masked, and commands the secret guard refuses (`cat .env`) don't run.
- Push on Done: `/weft:done` pushes the branch after a clean commit (`plugin/skills/done/push.sh`), so moving a card to Done
  ships it. On by default; turn it off in Settings. A plain `git push`, never forced: a rejected push leaves the card in Review.
- Board view: threads can screenshot, click, hover, type into and read Weft's own board window (`mcp__board_view__*`), so a
  change to a drawer, dialog or card gets checked in the real app; a fixed set of operations, no arbitrary JS, and revealed
  secret values read as ‹secret› and are blanked in screenshots.
- Secrets: the Composer flags a key you type, dictate or drop in, not just one you paste (Remove it / Keep it);
  threads no longer get secret-named or key-shaped variables from your shell's env; the pre-commit hook scans
  for keys even without gitleaks; and the control server's token moved from the server's env to a 0600 file.
- ↑ in an empty reply box edits your last message (after any queued one). Enter stops a running turn, rewinds the
  conversation to before that message, folds the old message and its reply into an "Edited" line you can open, and
  sends the new text; Esc cancels. Files the replaced turn changed stay as they are. Claude board threads only:
  picked-up sessions and puku-cli send the edit as a new message.
- A Backlog counter (☰ 7) beside the uncommitted counter. Click it to start a card that reads every Backlog card
  against the code and plans them into sprints of cards that can run side by side, on a page with Start this sprint,
  Move, Merge, Split and Archive buttons; it starts nothing until you say so.
- ★ star and tags replace the library. ☆ on a card or thread header (or K in its menu) stars it, a starred card is
  never auto-archived, and the rail's ★ shows only starred cards. Tags follow GitHub's label rules and show as up to
  two pills on a card's stage line; click one to filter the board. Library cards became starred cards tagged
  `recipe`, `to-do` or `note`.
- The 🏷 tags drawer (⌘L), like GitHub's labels page: new tag with a colour, rename, recolour, delete, click to
  filter, drop a card to tag it. **Tags…** in the card menu (G), or a click on the thread header's tags, edits a
  card's tags with autocomplete.
- Auto tags: the Haiku call that names a card after its turn also gives an untagged card 1 to 3 tags, reusing the
  board's own; tags you set are never changed. The copilot can set tags too.
- GitHub issues become Backlog cards: ⌘K → "Import GitHub issues into <project>" reads its open issues through `gh`,
  labels as tags and "#N" on the card, and checks again every 5 minutes. A closed issue archives its card if it
  never started.
- A build error mid-edit (a stray `}` in Board.tsx) no longer covers the board with Next's Build Error overlay: the board
  keeps running the last version that built, and a small bar names the broken file until it is fixed.
- The `?` keyboard shortcuts sheet is bigger and easier to read: up to 1100px wide, larger text and key caps, accent
  section headings, and each shortcut's fine print (in brackets or after a colon) on a dim second line.
- Shift+`S` adds a secret: it opens the 🔐 drawer on its Add form, and "Add a secret" in the ⌘K palette and the `?` sheet does the same.
- Threads can run a command with 🔐 vault secrets they never see: `mcp__secrets__run` asks you (the exact command, its
  `package.json` script, the names; Allow once or Always allow, then Touch ID), runs it from Electron main with the
  values in its env only, and returns the exit code and output with each value as `‹NAME›`. A card's dev server gets
  the vault's development values the same way, and a secrets-using card's stored tool results are redacted.
- ▲ on the left rail links a project to Vercel: paste a token once (kept in the Keychain), pick one of your Vercel
  projects or make a new one with its GitHub repo connected, and see its production URL and latest deploy. The link is
  `.vercel/project.json`, so the Vercel CLI in threads works on the right project.
- Supabase's bolt on the left rail links a project to Supabase: paste an access token once (kept in the Keychain),
  pick one of your projects, and see its state, region, API URL and which local migrations it hasn't applied, with
  Restore for a paused project and links to its auth users, logs, keys, usage and dashboard. The link is
  `supabase/.temp/project-ref`, so the Supabase CLI in threads works on the right project.
- A linked Vercel project's card links straight to the latest deploy's page, runtime logs, env vars, domains and the
  dashboard; personal projects (no team) now link to their own dashboard too.
- The code quality badge scores Documentation too: a README, an agent guide, architecture docs, a CHANGELOG, source
  files that open with a comment saying what they're for, and no file paths in the docs that no longer exist.
- The copilot shows as a card at the top of its column (✨ whole board), so you can see when it's running or needs you;
  click it to open it in the same window as any card (with its own browser pane and New chat), as does the top bar's ✨ Copilot button; Allow, Deny and Stop work right on the card.
- The New thread page cycles through the speeder and the five backdrop scenes, a new one each time you open it.
- Placeholder cards pulse in every column while the board loads, instead of empty columns and "0" counts.
- ▶ on every idle card with a session sends "continue" into its thread, for a model that gave up too early; a card you
  stopped or whose turn failed also gets **Restart**, which runs your last message again in a fresh CLI.
- **▶ Resume N** at the top of Review carries on every turn there that a restart cut off or that failed. A turn cut off
  again during its carry-on now resumes again too, up to three times in a row (it used to stay stopped after one).
- BlastCP on the left rail, under its rocket logo: connect your BlastCP account in the browser (kept in the Keychain), link each project to
  the property it posts as, and see its next scheduled posts, drafts, posts to approve and failures; click one to
  open it in the browser pane.
- Many more error boundaries: one message, dialog, drawer or header badge that fails to draw shows a "failed to draw ·
  Try again" in its own spot (a small chip for badges and messages), and the reply box, dialog ✕ and the rest stay working.
  The board's panels, dialogs, cards and badges load in their own boundary too, so a file a thread left half-written
  (even one that fails as it loads) no longer blanks the whole board; a broken dialog offers Close, and the board's
  own error page hides the browser pane so it isn't covered.
- An archive button in the Done column header files away every Done card it shows (same as Shift+E), with Undo.
- Threads fill secrets in themselves: `mcp__secrets__list` gives a vault's names and `mcp__secrets__fill_field` types a
  value into a field in the browser pane after your Touch ID (naming the secret, vault and site), masked on screen and
  shown to the thread as `‹NAME›`. The thread never sees the value; https pages only.
- Scene themes: six of Weft's own pictures (Twin Suns, Canyon, Coast Road, Neon City, Snow Pass, Salt Flats) as
  board backgrounds, each with its own palette, from Settings → Appearance or ⌘K.
- Plan first: on a long task, a thread writes its plan to the browser pane in one of its first tool calls and ticks
  the steps off as it builds, so you can watch the plan instead of a blank pane.
- Resume after restart: a card that was running when Weft quit carries its turn on after the restart, instead of
  sitting in Review as "Stopped when the app closed".
- Board skeleton: while the card list loads on launch, each column shows pulsing placeholder cards instead of
  sitting empty with "0" counts.
- Commit walk-through: Commit, Commit and push and Commit and run /done run on their own with no LLM turn
  (`weft://commit`): they commit exactly the change's files, push, move its card to Done and stamp the page;
  only a failure (say, the pre-commit hook refusing) asks the thread for help.
- Weft account: Sign in with GitHub from the top bar (right of Copilot), or with GitHub, Google or an email link in
  Settings → Weft account, against the Weft prod Supabase project. Signed in, the button is your avatar.
- Import guard: after each Edit or Write, a board thread (and its subagents) hears about any import the edit broke,
  so a half-finished change can't leave the board on a build error.
- New thread: ⌃↵ starts the thread and keeps the dialog open for the next one; holding ⌘ or ⌃ relabels the Start button.
- New project… in the New thread folder picker: name a folder, Enter creates it in ~/dev and starts the thread there.
- ⌘K opens on "Recently changed": the cards that moved column in the last day, latest first.
- ⌘K is wider with larger text, and each card row shows its last line of output (or its error) and how long ago it changed.
- Auto-updates: the packaged app checks GitHub Releases, downloads in the background and offers Restart to Update;
  Weft → Check for Updates… checks now. An unsigned build offers the download instead.
- Secrets vault: 🔐 on the left rail keeps each project's secrets encrypted on this Mac, imports `.env` files
  with a preview, nudges when `.env.local` has values to import, and asks for Touch ID to reveal or copy one.
- Vault: after an import Weft can write `.env.local` from the vault (gitignored, mode 0600, `# Managed by Weft`) and keep
  it in step; edit it by hand and the drawer offers to import your change.

- ⇧S (or "Add a secret" in ⌘K) opens the 🔐 drawer with its Add form ready on the top bar's project.
- Vault: add or change a secret by hand in any project, even one with no `.env` file; copy a secret to another
  project from its right-click menu; and a project filter that follows the top bar until you pick another.
- Releases: a `vX.Y.Z` tag builds, signs, notarizes and publishes the dmg and zip, with this changelog as the notes.
- Commits from a board thread are co-authored by "Claude Opus 5.5 on Weft" (whichever model the card runs), and PRs
  say "Generated with Claude Code on Weft".

### Security
- The Weft account's refresh token is sealed in the Keychain by Electron main instead of a plain `~/.weft/account.json`.

### Changed
- Auto is now the fallback permission mode everywhere: cards a thread starts with no parent card, and a new copilot,
  follow Settings → Default mode instead of `default`.
- The ▲ Vercel, Supabase and BlastCP drawers open on their last status (kept in memory and localStorage across
  restarts) instead of "Asking Vercel…", refresh it quietly behind, and ask the service at most every 30s on
  focus. The three hooks share `lib/use-linked-status.ts`.
- The Weft account sign-in's OAuth redirect target is now `weft://account-callback`, so the URL is stable across
  Weft restarts (the dev server picks a fresh port every launch); plain `next dev` still uses the loopback HTTP
  origin. Electron main's `weft://` handler forwards the code to a new `/api/account/weft-callback` route, which
  exchanges it against the PKCE verifier kept in the session file. In `npm run desktop` (dev Electron), a wrapper
  `Weft Dev.app` at `~/Applications/Weft Dev.app` is built by `scripts/dev-protocol.cjs` to declare the scheme in
  its Info.plist (the dev Electron.app can't), registered with LaunchServices, and forwards the link to the running
  dev Electron via a `--weft-link=weft://…` argv (parsed by `electron/argv-link.cjs`).
- Over a scene, columns are clear instead of frosted: the picture shows between the cards, with a faint edge
  keeping each column's shape.
- A card running `/done` or `/weft:done` (typed, or from a move to Done) sits in Done while it runs, still
  spinning, and is archived when it finishes; before, it jumped back to Running until the end.
- Builder card: Craft now counts the habits your shipped cards' transcripts show: wrapping up with `/done`,
  committing, code review, docs and refactor skills, as well as refactor titles.

### Removed
- Builder card: the Thrift attribute (cost per shipped card) is gone; seven attributes remain.
- The reply box's "Also running here: …" line: in a busy repo it always showed. The card's "+N here" chip and
  the New thread dialog's line stay; symbol claims (on the roadmap) will warn at the moment two cards clash.

### Fixed
- An edit that makes a route file (`app/**/page.tsx`, a layout, a `route.ts`, middleware) import a module that isn't
  there yet is now refused before it lands, with the file to write first: one such import took the board and every
  `/api` route down for ~5 minutes (`lib/route-import-guard.ts`, docs/bug-fixes/010).
- A parse error in `components/home/Home.tsx` no longer 500s the board. The home is now loaded through
  `loadHome()` in `lib/home.ts` (a cached dynamic import) from both `app/page.tsx` and `app/home/page.tsx`, so
  `app/page.tsx` no longer static-imports a module it doesn't render in dev; `/home` shows a small fallback when
  the home fails to load (`docs/bug-fixes/011`).
- The packaged app no longer crashes at launch with "Cannot find module 'libsodium-wrappers'": the Electron bundle now
  carries the main process's two packages, `libsodium-wrappers` (the 🔐 vault) and `node-pty` (the terminal drawer).
- Threads, a card's dev server and `!` commands no longer inherit Weft's own `next dev` env (`NODE_ENV=development`,
  `PORT`, `__NEXT_*`, `NEXT_PRIVATE_*`, `NEXT_PUBLIC_*`, `TURBOPACK*`), so `next build` in another project prerenders
  again instead of failing on `/_global-error` (`lib/env.ts`).
- The "Couldn't sign in to Weft" dialog shows plain text (it showed `Couldn&#39;t`) and no longer repeats its title in
  the message (`electron/account-link.cjs`).
- A card waiting on you (a question with Answer, or Allow/Deny) can be dragged to Backlog, Review or Done to park
  it; its question stays open there, and answering runs the turn on. Only running cards and the copilot stay put.
- A thread can't throw away other cards' uncommitted work: a hook (`lib/git-guard.ts`) turns away `git stash` (but
  `list`/`show`), `git reset --hard`, checking out or restoring paths over the worktree, and `git clean -f`, and says how
  to commit by path, read a clean copy with `git show HEAD:path` or commit through a temp index instead. A scratch clone
  in the temp folder is left alone.
- A thread can't restart Weft while other cards' turns run: a hook (`lib/restart-guard.ts`) turns away `kill`, `pkill`,
  `killall` or port-freeing aimed at Weft's own server, app or port, and a second `npm run dev` / `electron .` in
  Weft's folder, saying how many turns it would cut off. Alone on the board it's allowed; your project's dev server always is.
- A card whose CLI goes on working after its turn ended shows Running again, so a restart then finds it cut off instead
  of leaving it in Review with a tool call and no reply.
- Weft opens on the project you had selected last, with its sort order. They were kept per port, so a launch
  that started the server on another port forgot them (`lib/view-prefs.ts`).
- The board no longer fails to build when a card menu loses the library's star menu: ☆ stars or unstars a card in one
  click, and right-click Star/Unstar and Tags… work (a tag editor until the tag pills land).
- A thread's big heredoc no longer stalls the board's server in the secret guard: a 1.2 MB script with a few `{a, b}`
  groups took 300+ s (256 copies of itself, every token path-checked) and now takes ~0.2 s (`lib/secret-guard.ts`).
- The secret guard no longer stops a thread editing code that mentions `.env`: a `sed -e` script or a Python or
  Node edit whose text names `.env.local` runs; code that opens a `.env` file is still turned away (`lib/secret-guard.ts`).
- The usage strip shows reset times to the minute ("reset 11:06pm"), not rounded to the hour.
- A review tour arriving while you type no longer strands your message: it moves into the step's feedback box, focused.
- Threads write their pane pages (plans, commit checklists, how-tos) to `~/.weft/show/`, not `/tmp/weft-show/`, so
  they survive a reboot; macOS had been clearing them after a couple of days (`lib/show-dir.ts`).

## [0.3.0] - 2026-10-11

### Added
- Card library: star a card (☆ on cards and thread headers) to keep it as a recipe (a Claude skill), a to-do or a note;
  filing a card as a to-do takes it off the board.
- Archive with undo, picture cards (the latest thread image or a pane capture) and Haiku emoji tiles.
- Cards with a placeholder title get a Haiku title and emoji after their turn.
- Header code quality badge with a checklist (coverage, file size, lint, types, guardrails) and a refactor scout that
  starts a card per finding.
- Commit pile: the header's "+N/-N" uncommitted counter and a card that commits it one Review card at a time.
- Progress: streaks, XP, badges and a builder card.
- Startup screen shows why the board didn't load (Retry, Logs, Quit) instead of a stuck splash or blank window.
- Filter: the / key is always shown, matching cards drop down, and the search hands off to the command palette.
- Double-click empty board space to open New thread.
- Send later offers the weekly reset; Tab in the reply box takes the suggested next message.
- Composer drafts and tooltips, browser pane zoom, crash guards around every card and panel.
- The steel weave emblem is the app icon.
- `/weft:done` runs with three agents and the refactor scout.
- Component tests for CardView, ReplyBox and NewCardDialog; tests now cover every line of `lib/` and `app/api/`.

### Changed
- Dollar costs are gone from the board.

### Fixed
- Archived cards no longer count as needing you or running.
- Escape closes the open thread even mid-reply, and dialogs close before board panels.
- Only http(s) URLs can count as Weft itself in the browser pane.
- Long question lists scroll inside the thread panel.
- The commit walk-through says commit, push and /done instead of save.

## [0.2.0] - 2026-10-10

### Added
- Board tools (`mcp__board__*`) in every thread, prompt automations, effort levels, themes and chimes.
- Threads always show something in the browser pane; the glance page fills in when a turn showed nothing.
- Busy-folder and overlapping-edit warnings on cards, the reply box and the New thread dialog.
- The copilot hears what finished or needs you since its last message.
- Terminal drawer: a real shell per folder, with splits.
- Searchable shortcuts sheet, key hints and a hold-a-modifier cheat card.
- Command palette shows each result's project and status; searches the current project, Tab for all.
- The browser pane restores each card's last page after a restart.
- Send later: a clock beside Send that holds a reply until a set time.
- Native right-click menus for cards and columns; rename a card from its open thread.
- Default permission mode (Auto) and an effort setting that follows the last card.
- `/weft:setup-done`, a tighter `/weft:done`, and typing /done archives the card when its turn ends.
- Open-source repo files (license, contributing, security, issue and PR templates, CI) and a Vitest suite.

### Changed
- Cards always open full screen; the side-panel mode is gone.
- Review steps are pages, and the review feedback box uses the shared composer.

### Fixed
- Escape in the browser pane closes the board's newest layer; every dialog shares one Modal.
- The dev server evicts stale listeners and clears a stale Turbopack cache.
- Status lines quoted in code fences are skipped.
- A card that adopts a warm spare gets its session id at once.

## [0.1.0] - 2026-10-09

### Added
- Weft: a desktop kanban board where every card is a Claude Code thread, with a browser pane beside the board.
- Prompts with inline screenshots, video, dictation and a repo picker; skill typeahead on `/`.
- Board skills and automations; review tour, per-card browser, dev server start and the preview skill.
- Command palette search over your prompts; keyboard shortcut registry and a `?` sheet.
- Status strip with plan quota, project and branch; choose the Claude model per thread.
- About window with version, server port and PIDs; the start screen.

[Unreleased]: https://github.com/aimhuge/weft/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/aimhuge/weft/releases/tag/v0.4.0
[0.3.0]: https://github.com/aimhuge/weft/releases/tag/v0.3.0
