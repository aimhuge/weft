# Weft™

Engineering the future, one thread at a time. Weft is a Trello-style board where each card is an AI CLI
thread (Claude Code, puku-cli, Codex or Goose), with a browser pane on the side that you and the agents can both
use, and a copilot in its own small window that can see and run the board.

In weaving, the weft is the thread that runs across the loom and binds the separate threads into
cloth.

## Run it

```bash
git clone https://github.com/aimhuge/weft.git && cd weft
pnpm install
pnpm desktop        # Electron app: board + side browser
pnpm dev            # board only, in a normal browser at http://127.0.0.1:1024 (no browser pane)
pnpm dev:web        # the same, plus the weft.zip web routes (/login, /team, /<slug>/board) on :1024
pnpm test           # unit tests (Vitest), about a second; pnpm lint for ESLint
```

The app ships local copies of its fonts, so builds do not need to fetch fonts from Google. The home page's
GitHub release-feed lookup times out after three seconds and falls back to the releases page.

The first `pnpm desktop` downloads the Electron binary. Don't run `dev` and `desktop` at the
same time; Next.js allows one dev server per project folder.

### The web board on localhost

The weft.zip routes — `/login`, `/team`, `/<orgSlug>/board`, the share and profile pages — are
normally deployed-only, so a local server shows "Workspaces live on weft.zip" instead of the real
page. `WEFT_WEB=1` turns just those routes on locally, leaving the desktop board at `/` and the
marketing home page alone (analytics stay off, too). Set it in `.env.local`, or use `pnpm dev:web`,
which sets it for that run:

```bash
WEFT_WEB=1   # in .env.local, or run pnpm dev:web
```

`isWebEnabled()` in `lib/home.ts` is the gate; `isDeployed()` still owns the home page and analytics.

Signing in locally with GitHub works too, with one Supabase setting: the project's Auth URL
configuration needs `http://127.0.0.1:1024/**` in its redirect URLs (Supabase matches the
`redirect_to` against that list exactly, and the whole round trip is pinned to that origin). The
callback then lands on `http://127.0.0.1:1024/auth/callback`, exchanges the code and sets the
session cookie, so `/team` finds your workspace.

The pinning matters because the PKCE verifier cookie is host-only: the host that starts the round
trip has to be the host that finishes it. So if you reached the dev server as `localhost`, the
server moves you to `127.0.0.1` before the round trip starts — one origin, one allow-list entry,
one cookie. `WEFT_WEB_ORIGIN` moves the canonical origin when the dev server runs on another
port.

## The desktop app

- **Closing the window keeps Weft running**, with your threads' CLIs open, so conversations stay
  alive. ⌘Q quits. Opening Weft again just brings the existing window forward.
- **⌃⌥Space** opens the copilot from any app. In the app: ⌘N new thread, ⌘J copilot, ⇧⌘B
  browser pane, ⌘F find cards, ⌘, settings, ⌘1 board, ⌘2 copilot.
- **Shortcuts sheet**: `?` (or the "? Shortcuts" link in the footer) lists every shortcut in the app,
  board, thread, composer, terminal and app menu, and searches them by what they do or by key ("archive",
  "cmd k", "esc"). Hold ⌘ on the board for a moment, or Shift, and a card lists what that modifier does.
  Buttons, the filter box and right-click menus show their keys too. **Print** puts them all on one landscape
  page, and when your Mac has a printer the welcome's last screen offers it too.
- **Full screen threads**: clicking a card opens its thread and its browser together in one large
  overlay over the board; Esc (or clicking outside) closes it, and so does sending `/done`. A card
  running `/done` sits in Done while it works and is archived when it finishes.
- **List view**: the board as a sheet. The toggle in the project bar (or Esc, with nothing open) swaps the columns for a table —
  title, status, stage, tags, folder, age — one line per card, with the header stuck to the top and the
  columns lined up down the sheet, on frosted glass with grid lines and numbered rows. Click a header
  and type: the Title filters cards as you go, any other column narrows its values (↑↓, Enter keeps
  only the match), and Age flips its sort on a click; the sheet remembers it all. Bands fold (the
  Backlog starts folded), and a card folds open to its subagents and the cards it started. Click a
  status to stop, run or continue a card, a folder to move the card, and type a title at the foot of
  the Backlog to file a card (or into Running to start one). Just start typing to search titles; Space then B jumps to the Backlog's add row; Backlog rows drag into order. The status reads *Needs you* for a card
  waiting on you. A narrow
  board drops the roomiest columns instead of squeezing them, so the title is always readable
  (docs/architecture/board.md).
- **Board view for threads**: a thread can screenshot, click, hover, type into and read Weft's own board window
  (`mcp__board_view__*`), so a thread changing a drawer or dialog tests it in the real app instead of asking you to click
  through. Revealed secrets read as ‹secret› and are blanked in its screenshots (docs/architecture/board-view.md).
- **Editor column**: an open card is four columns, thread · editor · pane · show; each closes to a thin strip
  (click it, or ⌥⌘1–4, to reopen; the editor opens from the ✏︎ beside the thread's ✕) and the line between any two
  drags to resize. Click any file path in the thread, or ⌘P, to open the
  file: CodeMirror for code, a what-you-see markdown editor that leaves the lines you didn't touch alone, and a Changes
  view against git HEAD with a revert per chunk. ⌘S saves; a file the thread changed meanwhile asks before it's
  overwritten, and an open file reloads as the thread edits it. Edit and Write rows in the thread show their diff
  (docs/architecture/editor.md).
- **Mini apps**: a page you keep coming back to (a thread's dashboard in `~/.weft/show`, a dev server, any site) is
  one click from the board. The grid button in the browser pane's toolbar saves the page as an app; it joins the
  left rail as a tile below 🖥 Services (its first letter, or the emoji its name starts with). Click a tile
  to open it in the pane; right-click to rename, share, move, copy the address or remove it. Your apps also show as
  **My mini apps** on your wefter profile (the 🔥 chip's You tab), each with a share button. **Share…** gives an app a
  `weft.zip/a/<id>` link with a card's modes (workspace, public, email, password): a local page goes up as a sandboxed
  copy, refreshed each time you open Share…, and a public https site is framed as is; a localhost app says it can't be reached.
  A public link unfurls as the app itself: its own title and description (from `weft-app.json`, the page's meta tags,
  or a sentence Weft writes), and a branded card with a screenshot of the app. The Share dialog shows the card, lets you
  rewrite the description and refresh it. Views are unlimited on every plan: a public link's pages are cached on
  Vercel's CDN at versioned URLs, and bots meet a per-minute cap. Your plan sets the room your open links share
  (Free 25 MB, Pro, Open Source and Education 1 GB, Team 5 GB; private links don't count), and the Share dialog shows
  how much is in use. The button is lit on a page
  that's already an app, and clicking it then takes it out. No apps, nothing on the rail.
  A **data app** holds a folder (`~/.weft/apps/<slug>/`: its page and a `weft-app.json` naming the project folder, the
  vault environment it asks for and its reads by name). The page asks for that env (Touch ID), then Weft runs its reads
  on the Mac with the env's vault values, which never reach the page: Postgres functions through Supabase, and GA4
  reports. 📈 **Growth** is the first one: accounts, signups, active accounts, retention cohorts, activation and page
  views — and what people do *inside* Weft: cards pushed per day, in-app engagement, and a retention table that counts
  an account as kept only if it pushed a card, moved one or ran a turn that week. Every app is also stored on prod
  under your account and comes back on any Mac you sign in on
  (docs/architecture/mini-apps.md).
  A **React app** is a folder with an `App.tsx` and no `package.json`: Weft bundles it with its own React into a
  static page on save, and the pane reloads. Shared, a folder app's link lives under its owner,
  `weft.zip/@you/apps/<slug>` or `weft.zip/<team>/apps/<slug>`, with every file of the folder served in a sandbox. With no card
  open, the pane opens on the left and shows the app's name instead of its `file://` path, with a Share button. An app
  never holds a key: it writes `{{secret:NAME}}` in a `weft.fetch` request and Weft puts the value in outside the
  browser, only for the hosts, methods and paths its `weft-app.json` allows. The value is the author's, or each viewer's
  own (`"from": "viewer"`, asked for in Weft's own form); on weft.zip it's stored encrypted under a server-only key
  (docs/architecture/mini-app-hosting.md).
- **Site notes**: what a card learns driving a dashboard in the pane (Supabase, Vercel, Stripe, GitHub settings…) becomes
  a short note per page: what it's for, the steps to each goal, the labels and selectors that worked, the gotchas. The
  next card that opens that page gets the note with `open_url`, as reference data it may use but never obey. Notes stay on
  your Mac and go to your team; Settings → Security → Site notes shares them with every Weft user, each one shown to you
  before it's sent, and served to others once 3 people's cards have succeeded with it. Ids, emails and keys are scrubbed
  out first, and anything about secrets, other sites or commands is stripped (docs/architecture/site-notes.md).
- **Show rail**: a 72 px column right of the page in the browser pane, one mini per turn of the open thread
  (status dot, its first words, how long ago) and per page the pane showed, newest at the bottom like the chat. Each page
  is a small picture of what the pane showed (a few-KB WebP per page in `~/.weft/shots/`). Every message keeps the page on
  screen as you sent it. Click any mini and the chat scrolls to that turn while the pane goes back to the page it showed
  then; scroll the chat and the turn at its top lights up and the pane follows to its page, back to the newest at the
  end of the chat. Hidden in windows under 980 px (docs/architecture/show-rail.md).
- **Agents drive the pane like a real browser**: a thread takes a `snapshot` of the page (its elements, each with a
  ref), then clicks, hovers, types, presses keys, picks options and scrolls by ref, with real trusted input. A short
  orange ripple shows where each click lands. It can `wait_for` something to appear, check a phone or tablet layout
  with `set_viewport`, and read the page's `console_logs` and `network_errors` when something breaks, all in the pane
  you're watching, where you're logged in (docs/architecture/agent-browser.md).
- **Browser pane zoom**: the % button in the pane's toolbar zooms the page (Chrome's steps, plus
  50–200% presets); ⌘+ / ⌘− / ⌘0 and ⌘+scroll work on the page too, and a trackpad pinch magnifies.
- **Failed loads say why**: a page that won't load in the browser pane (say a card's dev server stopped) shows Weft's
  error page instead of a blank white one: the URL, the reason, **Try again**, **Back to the last page**, and an
  automatic reload when a local dev server comes back (`electron/pane-error.cjs`).
- **Touch ID for new sites**: when a thread asks the pane to open a site you haven't opened in that card's pane, Weft
  asks you with Touch ID ("open www.google.com in a card's browser pane") instead of refusing; a yes lets that card
  use the site from then on (`electron/pane-origins.cjs`).
- **Themes**: Settings → General (or ⌘K "Theme: …") picks System, Light or Dark, or a scene: Twin Suns,
  Canyon, Coast Road, Neon City, Snow Pass, Cockpit, Night Cockpit or Salt Flats puts that picture behind the board with a palette drawn
  from it and clear columns. The first launch opens on Twin Suns, or Salt Flats when the Mac is in light mode
  (`lib/theme.ts`, colors in `app/globals.css`; docs/architecture/themes.md).
  **Your own** describes a theme in words ("a rainy Tokyo alley at night, neon pink"): a card paints the picture and
  draws a palette from it into `~/.weft/themes/<id>/`, and the tile shows up and is picked the moment it lands
  (`lib/custom-themes.ts`, `app/api/themes`). Or bring your own picture (pick it, or drop it on the tile): it stays the
  backdrop and the card writes the palette, base and name around its colours, words optional.
- **Menu bar icon**: shows how many cards need you and lists them; click one to open it.
- **Keep Working** (menu bar icon, and its own **Laptop mode** page in Settings): your Mac stays awake with the lid shut, so threads keep running in a bag.
  Choose **Until threads finish** (sleep comes back once no card has been running for two minutes, 8 hours at most) or 1, 2, 3 or 8 hours,
  or switch on **Always while threads run** to have it turn on by itself whenever a card is running. **Only while online** lets the Mac sleep
  once it's been offline for a minute, and **Sleep at low battery** picks the floor (5–50%, 10% by default); all three are in `~/.weft/keep-working.json`.
  While it's on, the menu bar icon shows ☕︎ and the hours left. The first time, macOS asks for your password once, to allow only
  `pmset -a disablesleep 0|1` (`/etc/sudoers.d/weft-keep-working`). Sleep also comes back at the battery floor, when you quit Weft, and,
  through a watchdog, if Weft crashes (`electron/keep-working.cjs`).
- **Dock**: the Needs you count on the icon, and New Thread and Copilot in its menu.
- **Links**: `weft://new?prompt=…&folder=…&start=1` creates a card (in your most recent project
  if no folder is given), `weft://card/<id>` opens one, `weft://copilot` opens the copilot, and `weft://reply?text=…` on a
  thread's own local page in the browser pane sends that text to the thread as your reply (the buttons on
  a walk-through page). `weft://commit?message=…&path=…&push=1&done=<card id>` from the same kind of page commits
  exactly those paths with no turn (the commit walk-through's Commit buttons). Handy
  from Alfred, Raycast, or Shortcuts. (Registered by the packaged app.)
- The window remembers its size and position, and the app reads your login shell's PATH, so it
  finds `claude` and `puku-cli` even when started from Finder.
- **Puku trial**: a puku thread works with no Puku account. With no agent logged in, the welcome's puku-cli row offers
  **Try free** (sign in with GitHub) before your first prompt, and the first thread runs on the trial. While you're signed in to your Weft account and
  puku-cli has no login of its own, Weft runs it on Weft's own Puku key through a proxy on the deployed Weft, with a
  daily cap per account (150 requests, 1M tokens); Weft's key never ships in the app. Signed out, the login pop-up
  offers **Sign in to Weft** or Puku's own login. See docs/architecture/puku-trial.md.
- **Weft Pro**: every workspace has a plan. **Free** keeps the Puku trial's daily cap. **Pro** ($20/month or
  $200/year) replaces it with a 300M Puku token allowance, refreshed every billing period. **Team** ($9 a seat a month)
  bills the workspace's member count, and adding or removing a person moves the Stripe quantity with it.
  weft.zip's pricing cards link to Checkout: **Get Pro** and **Get Team** sign you in and open the upgrade dialog on
  your workspace's billing page.
  **Open Source** is free for a year for maintainers of an active, OSI-licensed public repo, checked on GitHub when you
  sign in to weft.zip (or with **Check my GitHub now** on the billing page): teams on the free tier's
  Puku cap. **Education** (the GitHub Student Developer Pack) and **Regional pricing** (Pro at $5/month in low-income and
  $10 in lower-middle-income countries) are built in Weft and wait on the pack partnership and the billing package's price variants.
  Settings → Accounts shows your plan, workspace and the meter. **Upgrade** opens Weft's own pricing dialog (Free, Pro and Team,
  monthly or yearly) and goes on to Stripe Checkout; it also opens by itself whenever you hit something a plan unlocks, like
  inviting a teammate on Free, running out of room for shared apps, or the free Puku cap. **Manage billing** opens the
  workspace's billing page on weft.zip (the Stripe-hosted portal to manage). Pro is billed per workspace and Team per seat;
  owner or admin manages. The billing page also gives each workspace a referral code: the team you refer gets 20% off
  three months and you get $20 off your bill. Super-admins run plans from **Admin → Billing** (upgrade, downgrade,
  switch, seats, refunds in full or part, people, discounts, and a reset for sandbox ids on a real workspace, each in the
  Stripe mode the workspace's ids live in) and coupon codes from **Admin → Coupons**. See docs/architecture/billing.md.
  **Admin → Users** shows when each account last really used Weft (token refreshes, not just sign-ins), and a row
  opens its activity: a 12-week calendar, cards per day, streaks. See docs/architecture/admin.md.
- **Updates**: the packaged app checks GitHub Releases at launch and every few hours, downloads a new version in the
  background, and a notification (click it for the Software Update window, or **Restart Now**) and the Weft menu offer
  **Restart to Update**. With threads running it asks: **Restart When Idle** (the default) waits for them to finish,
  **Restart Now** cuts them off. Left alone, Weft restarts into the update by itself once no thread is running and
  nobody has touched the Mac for 10 minutes. Weft → Check for Updates… (or File → Check for Updates…) opens the Software Update window (versions, last check, release notes, the next step). The first time Weft opens on a new version, a short **What's new** splash says what changed in a few lines (sometimes with a video), written by the Copywriter when the release is cut. What changed is in [CHANGELOG.md](CHANGELOG.md); releasing is in docs/architecture/updates.md.
- If the server crashes, it restarts on its own; its output is in `~/Library/Logs/Weft/server.log`
  (Help → Open Logs Folder). If the dev server dies repeatedly (4 times in 2 minutes) while the
  board is up, a small bar at the bottom-left offers **Restart server**, **Open logs**, and
  **Fix with a thread** (opens a New thread dialog with the error and log tail pre-filled).

## Your existing Claude Code threads

On launch and every minute after, Weft picks up your Claude Code sessions (the ones
`claude --resume` and the Claude app list) as cards, read-only from `~/.claude/projects`:

- **First launch gets you to a running thread.** Three screens, for everyone, history or not: **Get ready** plays
  a 30-second loop of a card crossing the board (and getting a key from the 🔐 vault) with your own project names on it (a HyperFrames composition,
  `public/welcome/loop.html`; the same file renders `public/brand/welcome-loop.mp4` with `pnpm welcome:render`, which also joins `public/welcome/beats.html` (connect your tools, the 🔐 vault, panes, code quality, BlastCP, the profile, open source) and `outro.html` (download Weft, in place of the keyboard shortcuts) into a ~102-second `weft-tour.mp4` for weft.zip's homepage; a bar under it names the beat on screen and steps **‹ Back** and **Next ›** one beat at a time) and whether Claude Code, puku-cli and Codex are logged in, with **Log in** right there; signed out, **Sign in to Weft** comes next, and you sign in with GitHub to go on; **Bring in your
  projects** lists the folders with Claude Code sessions (worktree, scratch and temp folders unticked; **Start empty**
  brings in none) with a switch that counts your history on your Wefter Profile; **Start your first thread** picks a
  project and a starter prompt and opens the card as it runs. No cards are added until you answer. A board that already
  had cards is left as it was. Settings → General changes either answer later; Replay the welcome is in the avatar menu and the command palette,
  and it brings back the drawer intros too
  (`lib/welcome.ts`, `components/WelcomeDialog.tsx`). After it, an empty board offers New thread and the same starters
  (`components/EmptyBoardStart.tsx`).

- A title like "GOING DEEPER - Weft desktop app" becomes the card "Weft desktop app" with stage
  "Going deeper". DONE threads go to Done; other status words, and threads active in the last three
  days, go to Review; the rest go to Done. Their folders fill the projects bar.
- Opening a card shows the conversation, read from the session file.
- Replying continues the same session. If the session is open in the Claude app or a terminal,
  or changed outside Weft in the last 10 minutes, Weft continues it as a copy instead, so two
  apps never write to one session. "Click here to continue" in the thread's banner stops that
  outside Claude CLI, so the next reply continues the same session in Weft.
- Deleting a picked-up card hides that session for good. Sessions in temporary folders (tests,
  tool runs) are skipped.

Weft's own threads run with a clean environment (no variables inherited from a Claude session it
was started from) and are marked as SDK sessions, so they don't show up in the Claude app's list.

## Reading a thread

- Messages render as Markdown, with a Copy button on code blocks.
- A run of tool calls folds into one line like "Ran 3 commands, read 2 files +1"; click it to see each call and its output. Failed, denied and waiting calls are counted on the line.
- Images show inline: screenshots tools took, images pasted into Claude Code, and local images an agent shows with `![](path)` (copied into `~/.weft/attachments`). Click one to see it full size.
- Sessions running in another app move to Running (busy) or Needs you (waiting for an answer) on their own, within about 5 seconds, and go back to Review when the turn ends.

## Writing a prompt

The new-thread dialog (⌘N) and every card's reply box use the same editor:

- **Markdown, formatted as you type.** `## ` makes a heading, `- ` a list, ⌘B/⌘I bold and italic;
  the bar has the rest. The Markdown button shows the raw Markdown, which is what the agent gets.
  Pasted Markdown is formatted too.
- **Images and videos go where you paste or drop them**, not in a tray on top. They're saved to
  `~/.weft/attachments` and written into the prompt as `![name](path)`. Uploaded PNG, JPEG and GIF
  images are converted to WebP; images also reach the agent as image blocks at that spot (shrunk if
  over the API's 5 MB limit). Videos and other files go as paths the agent can open.
- **Drag files from Finder anywhere in Weft.** Onto a card: it opens with the files in its reply box.
  Onto an open thread (or the copilot): its reply box. Onto empty board, or the New thread dialog:
  New thread opens with them attached. A pill says where they'll go and the card under the cursor
  lights up; dropped right on a composer, they land where you let go.
- **The mic dictates** on this Mac with whisper.cpp: click it, talk, click again, and the text lands
  at the cursor (Esc throws the recording away). It needs `brew install whisper-cpp ffmpeg` and a
  model; it uses superwhisper's or Homebrew's models, or the one in `WEFT_WHISPER_MODEL`. In a
  normal browser tab without whisper it falls back to the browser's speech recognition.
- **Drafts are kept** per card and for the new-thread dialog until sent, so closing it loses nothing.
- **One button that says what Enter does.** The reply box is in one mode at a time, named on a chip inside it
  and on its button: **Send**; while a Claude Code or puku turn runs, **Send** goes in after the agent's next tool
  call, the way the CLI's own queue does (the ▾ beside it has **Queue · after this turn**, and **Send now**, which
  stops the turn first); **Queue** while a Codex or Goose turn runs, **Answer** while a question waits, **Run** for a `!` command (green, with the folder named),
  **Replace** after ↑ (amber, with how many file edits stay). ■ Stop keeps its own spot while a turn runs. The
  button also picks the cheaper default: **New card** when the prompt cache has gone cold (a summary, the touched
  files and what you typed start a fresh card; **Send here** is in the ▾), **Send at 10:39pm** when the 5-hour
  limit is used up, and **Continue** in an empty box only after a turn stopped short (`lib/reply-mode.ts`).
- **Crons.** ⏰ in a thread's header, or on one of your messages ("Repeat from here"), runs the thread again on a
  schedule: hourly, daily, weekdays, weekly, monthly or any cron, from a day you pick on a mini calendar, until an end
  date if you like. Each run is a new card, forked from that point (its context, folder, model and page) or a fresh
  thread with the prompt only, so the original thread is never touched. Runs wear a violet ticket stub and fold into a
  stack under their thread; ⏰ Crons on the left rail lists every cron with its next run, its last runs and Run now.
  Threads and the copilot can make them too (`create_cron`), and ⏰ in the New thread window puts a new prompt on a
  cron (docs/architecture/crons.md).
- **Send later.** In the send button's ▾ menu (Alt+Enter), it holds a reply until a time you pick. On a Claude
  thread the first choice is a minute after the 5-hour limit resets (the time in the bottom bar), so
  a message written when you hit the limit goes out as the new window opens. When the weekly limit
  is at 90% or more it adds "At the weekly reset", and once the weekly limit is used up that comes
  first instead. There's also "In 1 hour", "Tomorrow morning" and any date and time. Scheduled replies sit above the box (click one to
  edit it) and show as a clock on the card. Weft sends them itself, with the thread closed; one that
  came due while Weft was shut goes when it next starts.
- **A new thread waits for the limit too.** A thread started on a model that has hit its limit used to fail
  on its first turn and die in Needs you. Weft knows before the turn starts: the New thread dialog's Start
  button reads **Start at 2:30am** and says which limit is used up, and the card waits for the window before
  its first message goes out. The same goes for a model's own cap (Opus can run out before the CLI's window
  does) and for the weekly limit (`lib/limit-reset.ts`, `lib/start-gate.ts`).
- **Prompt cache in the status strip.** `cache:52m` counts down how long the thread's prompt cache
  stays warm (an hour after each request on a Claude plan). Replies inside that window reread the
  thread from cache at about a tenth of the price. After it, the chip reads `cache:cold 120k`: your
  next message sends the whole thread again at full price, which uses more of the 5-hour limit. For a
  new topic, a fresh card is cheaper.
- **Limits chart.** Hover over the status strip's `5hr` / `7d` to see the week, from one weekly reset
  to the next: the 5-hour limit left as 168 green hour bars on the left axis, and the weekly limit left as
  7 see-through red day bars in front on the right axis, their tops burning down hour by hour. Red lines
  mark where a limit was hit; green lines mark the 5-hour resets (light), the next one (strong) and the
  weekly reset (strongest). Hours inside a 5-hour window with nothing logged are hatched. Weft asks each
  thread's CLI for its limits after a turn (at most every 5 minutes) and keeps the changes in `~/.weft/limits.jsonl`.
  The plan limits are per CLI — each CLI has its own plan (Claude Code on Anthropic's, puku-cli on
  Puku's) — so the chart draws that CLI's own history.
- **Status strip: the thread and the plan.** An open card's strip names its CLI and model (`[puku · opus-4-8]`,
  the model its session started on), then context, cache and tokens, then that CLI's plan limits. The context
  reads as how much is left and how big the stack is (`ctx:44% 112.0k/200.0k` — the tokens the last request
  carried, out of the model's window). Every card
  on one CLI shows the same limits, the newest any of them read, and a window whose reset has passed reads
  full. With no card open, the footer lists each CLI's plan by name and nothing else.
- **Suggested next message.** After a turn, a Claude thread's reply box shows the CLI's guess at what
  you'll say next as its placeholder (as the Claude CLI does). Tab in the empty box fills it in to edit
  or send; it never sends on its own. It rides the turn's prompt cache, so it costs next to nothing,
  and it doesn't appear after a session's first turn.
- **↑ edits your last message.** In an empty reply box, ↑ brings back a queued message first, then
  the last one you sent. Enter replaces it: a running turn stops, the conversation rewinds to before
  that message, the old message and its reply fold into an "Edited" line you can open, and the new
  text goes out. Files the replaced turn changed stay as they are (the box says how many), and Esc
  leaves everything as it was. Threads that can't rewind (picked-up sessions, puku-cli) send the
  edit as a new message instead, and say so before you press Enter.
- **`!` runs a shell command.** Start a reply with `!` (`!git status`, `!pnpm test -- lib/x`) and the box
  turns amber and Send becomes Run: Enter runs it in the card's folder, right away even mid-turn, and the
  thread shows the command and its output. What it printed goes to Claude with your next message, as in
  Claude Code's bash mode. It's for quick looks: no input, killed after 2 minutes, the last 20,000
  characters kept, keys in the output masked, and commands that would show a secret (`cat .env`, `env`)
  are refused; use the terminal (⌃\`) for those and for anything long-running. Not in the copilot.
- In a reply, Enter sends and Shift+Enter starts a new line (Enter in a list or code block starts a
  new line too). In the new-thread dialog, Enter starts a new line, ⌘↵ starts the thread and closes the
  dialog, and ⌃↵ starts it and keeps the dialog open, emptied, for the next one. Hold ⌘ or ⌃ and the
  Start button says which it will do.

The folder picker lists your recent projects, the git repos in `~/dev` and other usual code folders
(with their branch), and your GitHub repos from `gh`. Picking a GitHub repo that isn't on this Mac
clones it into `~/dev`, with a progress bar that follows git (receiving objects, resolving deltas, checking out). **New project…** names an empty folder in `~/dev` and starts the thread there. You can also paste a path or browse for a folder. A new thread starts on the CLI, model and effort set in Settings → Models (the dialog remembers your last pick the same way). The dialog's one model menu is also its CLI picker, the same menu as Settings → Models: each CLI is a heading with its own default first, picking a model moves the thread to the CLI that serves it, and Goose lists only the models a saved provider key serves. Cards are titled from the
prompt's first line (click the title in the open thread to rename it), and new threads start in the default permission mode from Settings → Security (Auto at first: a classifier
approves safe calls and blocks risky ones, and a blocked call comes to Needs you with the classifier's reason and
**Allow once and retry** / **Keep denied**; an MCP server that asks you to confirm something, like the Supabase MCP before
destructive SQL, comes to Needs you too, with **Accept** / **Decline** and any form it asks for); the mode menu beside the model and effort menus changes that per thread, and says under each mode what it does. The **Agent** menu picks who the thread is: **🛠 Builder**, Weft's own soul that plans, builds, tests and ships, **✍️ Copywriter**, who writes in Weft's voice (pages, feature intros, changelog entries, UI copy), or one of your own. **Settings → Agents** (or **Manage agents…** at the bottom of that menu) is where you make them: an emoji, a name, a line saying what it's for, its soul (the start of every system prompt its threads get) and the skills it turns off. Built-ins can be edited too, and **Reset** pulls a built-in's latest text from Weft's repo on GitHub. Pick a default agent for each project there, and new threads in that project start as it. Right-click a card → **Agent: …** to switch it between turns: its conversation carries on under the new soul, and the agent's emoji in the card's footer says who it is (`lib/agents.ts`, docs/architecture/agents.md). Effort starts at High and
then follows whatever the last new thread used. To change it later, even mid-turn,
use the mode menu in the open thread's header or the card's right-click menu. Sessions picked up from
Claude Code keep the mode they last ran in (say `auto`).

**Every model is on offer, and there is no default model.** Wherever Weft asks for a model — the New
thread dialog, Settings → Models (New threads, Use for subagents, Copilot, Review all, Run /weft:done
on, Backup model), the thread header's chip — the list is every model any CLI serves, grouped under
Claude, Puku, Codex and Goose. Nothing is locked to one CLI: picking a model moves the card to the CLI that
serves it, so the choice is one row, not two. The first entry is **Default model**, which means "let
the CLI decide" — Weft leaves the model off the command line rather than picking one behind your
back. A changed default takes effect at once: the open New thread dialog follows it, and an idle
thread picks it up on its next message.

**A model that hits its limit hands over to the backup.** Plan limits are per model (Opus has its own
weekly cap, Sonnet another), so Weft remembers which model ran out and until when. A model that is
used up is marked in every picker ("— at its limit"), and every thread on it — a new one, a running
one, a subagent, the `/weft:done` wrap-up, the Review all card, the copilot — moves to your backup
model instead of dying in Needs you. The backup may live on another CLI: the card's CLI moves with
it. With no backup set, Weft never guesses a model you didn't pick, and the card waits in Needs you
with its error for you to choose. The card's line says what happened: "Opus 5.5 hit its limit — moved
to Sonnet 5.5". The reset time comes from the limit message itself and is read in the timezone the
message names, on that timezone's own day: a window that resets at 1:00am in Bangkok ends at 1:00am
there, whichever day that is.

Pick **Codex** in the New thread dialog to run the OpenAI Codex CLI. Install `codex` on your PATH and sign in with `codex login` first; Weft can open Codex's device login in Terminal from Settings → Accounts. Codex uses its own tools and saved sessions. Weft's browser, board, secrets and webhook MCP tools reach Codex over HTTP, and a folder's `CLAUDE.md` and `.claude/skills` are passed along (Codex reads neither); and every tool call goes through Weft's guards first, the same ones Claude Code threads run behind ([thread guards](docs/architecture/thread-guards.md)). Codex's sandbox mode and reasoning effort are fixed when a session starts.

Pick **Goose** to run the Goose CLI agent (the Rust one from Block), and bring your own key: Settings → Models → **Bring your own key** takes a provider's API key — OpenRouter, Anthropic, OpenAI, Google, Groq, Mistral, DeepSeek, xAI, Azure, LiteLLM, Perplexity, Cerebras, a local Ollama, or any OpenAI-compatible endpoint — and Weft keeps it in your Keychain. The key never reaches the board and never crosses Weft's control server: the thread's Goose process is started with the key in its env, and that is the only place it exists. The provider you pick is what new Goose threads run on. A card runs the model you gave it (in the New thread dialog or by switching mid-thread); a card left on **Goose default** runs the model you picked for the provider, and with none, Goose chooses. A provider that needs an endpoint beside its key takes one (Anthropic's host, Azure's resource address, LiteLLM's proxy), and a provider whose model ids aren't known ahead of time lets you type the id. **Puku** is one click: the button beside the Provider picker fills in the Anthropic provider, `https://api-cli.puku.sh` and `puku-ai-2.8`, so all that is left is your Puku key. A Goose thread is a plain CLI process, so like a Codex thread it has no per-tool guards and no session to resume — one fresh `goose run` per turn — and it takes no effort setting. It has no Agent tool either, so its subagents are `goose run --text` calls from Bash on the same provider and model, and its commits are signed `Co-Authored-By: Goose (<model>) on Weft`. Install `goose` on your PATH first.

## How cards move

| Column    | How a card gets there |
|-----------|-----------------------|
| Backlog   | You create it with "Add to backlog" |
| Running   | You drag it from Backlog, press "Start now", or reply in its thread |
| Needs you | The agent asks permission for a tool; Allow or Deny on the card |
| Review    | The turn finishes (or fails, or you stop it) |
| Done      | You drag it there, and its Done automations run (by default `/weft:done`) |

If Weft quits while a card is running (or waiting on a permission), it carries the turn on after the restart: the card
goes back to Running and its thread hears that Weft restarted, to check what it already finished and pick up from there.
A carry-on turn that's cut off again carries on again, up to three times in a row; after that, or for a card with no
session yet, it stays in Review as "Stopped when the app closed". **▶ Resume N** at the top of Review carries on all of
those (and turns that failed) at once.

Any card that isn't running and has a session shows a ▶ in its footer: it sends "continue" into the thread, for when
the model gave up too early. A card whose turn you stopped or that failed also shows **Restart**, which runs your last
message again in a fresh CLI.

The Backlog column is hidden by default. Turn it on with Settings → General → Show backlog. It also shows
whenever cards are waiting in it.

Any column folds out of the way: click the chevron in its header and it becomes a thin strip with its name and
count. Click the strip to open it again; you can still drop cards on it. When the board has room, the fullest
columns spread their cards over two columns: the column with the most cards first, then the next, as long as its
cards don't fit its height and another column's width still fits. Narrow the window and they go back to one.

Drag a Backlog card onto another one to set the order: drop on its top half to place the card before it,
or its bottom half to place it after. Weft saves that order and uses it for the Backlog list, whatever
sort is selected for the other columns. Review ignores the sort too: its most recently updated card is always on top.
In the New thread dialog, **⌘B** adds the thread to the Backlog (the same as **Add to backlog**). Each Backlog card has
an archive button on hover. The Backlog header has two more: the flag saves the cards it shows as a **sprint** ("Sprint 3 ·
Oct 18"), and the box archives them all after an "Are you sure?" that can save them as a sprint first. Click the word
**Backlog** for your sprints: what became of each one's cards (archived, started), **Restore N** to bring its archived
cards back, double-click to rename, and delete (the sprint only, never its cards). Kept in `~/.weft/sprints.json`
(`lib/sprints.ts`, `lib/sprint-store.ts`, `app/api/sprints`, `components/BacklogActions.tsx`, `components/SprintsMenu.tsx`).

Replying to a card continues the same CLI session, so the agent keeps its context.

Right-click a card for a native menu where everything is one click: open, rename, start, move to
Review, Done or Backlog, stop, run `/weft:done`, `/weft:commit` or `/weft:preview`, start, restart or
stop its dev server, start a new thread in its folder, reveal the folder in Finder, copy the folder path
or a `claude --resume` command, archive, and delete. Deleting asks first, in Weft's own dialog, with a
"Don't ask again" tick that makes later deletes go straight through. Double-click any empty part of the board to open New thread, or right-click a column's empty space for it;
in Done, also show or hide archived cards and archive all the Done cards on screen. Every item has a key,
shown beside it, that picks it while the menu is open: right-click, then `D` for Done, `1` for `/weft:done`,
`Y` for YOLO. (Desktop app only.)

Right-click a project chip in the project bar, or a project under **More**, for its own menu: start a new
thread in it, reveal it in Finder, open it in your editor or terminal (the first one installed: Cursor,
VS Code, Zed… and Ghostty, iTerm, Warp or Terminal), open it on GitHub, copy its path, open its 🔐
Secrets, Dev Servers or Changelog, **Pin to Bar** (a pinned project always has a chip, ahead of the recent
ones), **Hide from Bar** (its chip goes until you use it again; **More** still lists it), archive its Done
cards and stop its running ones. (Desktop app only.)

Archive from the keyboard: `Shift+A` archives the card you've moved to with `j`/`k`, or else the
open thread, and focus steps to the next card, so `Shift+A` three times clears three cards. `Shift+E`
archives every Done card on screen, and `Shift+Z` (or the toast's Undo) brings back the last archive. `Z` reopens the last card you had open
(the one still outlined on the board). The command palette (`Cmd+K`) has all of them too.

Cards share one working tree by default, so two cards in one folder see each other's edits. When that
would hurt (a big change, or other cards busy in the folder), open the **Shared** menu beside the folder in New
thread (it reads **Isolate?** with an amber dot when Weft suggests it) and pick **Worktree**: the card gets a git
worktree of its own on a `weft/<title>` branch, or on a branch you search for or name new in the same menu, taken in milliseconds from a warm pool under `~/.weft/worktrees`
with `node_modules` already in (an APFS clone), and shows ⑃ on the card. Its CLI, Bash, `!` commands, tests and dev
server (on a port of its own) all run there. On Done it commits what's left, rebases on the project's branch and
fast-forwards it, never touching other cards' uncommitted work; a conflict goes back to the thread to resolve
(docs/architecture/worktrees.md). For shared cards, Weft warns you instead: a busy card shows "+1 here" next to its folder when another card is running
or waiting in the same folder (or one inside it), and the New thread dialog says "Also running here:
<title>" beside Start now when the folder you picked already has a busy card. Each card remembers the files its
thread edited (the last 50, for the card's whole life, since Weft can't cheaply tell what got committed).
It reads all this from the board alone, with no git calls.

When two cards actually clash, Weft asks. Each card claims the top-level symbols its thread edits: the function,
component, class, type or interface around an Edit's `old_string`, found with the TypeScript parser
(`Board.tsx#CommandPalette`). A symbol over 150 lines is split: the claim is the statement inside it that holds
the edit, and so on down (`Board.tsx#Board/moveFocus`, `Board/useEffect#3`, `Board/return/main`), since Board() alone is
85% of its file. Imports are never claimed; a Write, a non-TS/JS file or an edit spanning more than five symbols
claims the whole file. When another busy card in the same tree goes to edit a claimed symbol, its thread
stops on a permission prompt: "Card ‘Fix login’ is editing LoginForm in Login.tsx. Wait, or go ahead?" A card's
claims drop when it reaches Done or is archived, and a file's as soon as `git status` shows it clean (the commit
walk-through, or a thread's own `git commit`). Bash counts too: a line that writes a claimed file (`sed -i`, `> file`,
`prettier --write`) asks the same way, and whatever a Bash call wrote becomes the card's claim. When a typecheck, test
or lint run fails, the thread is told which failures sit in files another card is mid-edit on, so it leaves them alone.
When one card matters more right now, press **Me first** on its prompt: its edit goes ahead with the whole file, and
the card holding the code is told mid-turn to leave that file to it until it commits or finishes (its own edits there
wait). The holder's thread shows **You first** for each card waiting on it, to do the same from that side, and the
prompt shows both cards' faces (thumbnail or emoji), so who is in whose way reads at a glance.

A thread works in its card's project folder. When a file tool or a Bash command reaches anywhere else (say `~/Downloads`), Weft asks first, whether or not macOS would have refused it: **Allow once**, **This card** or **Always**, with an **Outside project** chip saying which folder. **Always** used to be a one-way door — nothing listed those folders and nothing took one back. Settings → General now has a **Trusted folders** row: **Add folder** opens the OS folder dialog, **Remove** takes one back out, and a thread already holding the folder keeps it only until that turn ends (`lib/folder-guard.ts`, `components/TrustedFolders.tsx`).

Every thread runs inside Weft's own server, so restarting Weft cuts off every running turn. A thread
can't do that behind your back: while other cards are running, a `kill`, `pkill`, `killall` or port-freeing
aimed at Weft's server, app or port, or a second `pnpm dev` in Weft's folder, is turned away with how
many turns it would cut off, and the thread asks you instead. Its own project's dev server is fair game.

When Weft does need a restart, **Restart when idle** waits for it: Weft → Restart When Idle, the command palette, or a
thread calling `mcp__board__restart_weft_when_idle` (you approve it). From then on nothing new starts. A message you
send waits on its card, marked "after restart" above the reply box, and goes out once Weft is back. The header shows
**⟳ Restart after N** (hover it for the threads it's waiting on, click it to cancel and send what waited). A card that
asked for the restart is marked on the board too: a red edge and a **⟳ Restart asked** chip, so you can see which
thread is waiting on it. When the
last running turn and any queued follow-up have ended, Weft relaunches, or installs the update if the updater armed it
(`lib/restart-when-idle.ts`, `electron/restart-when-idle.cjs`).

## Subagents

Every thread is told to hand work to subagents: broad searches across many files, independent pieces of a
task (several at once), test and lint runs where only the failures matter, and a second-opinion review. That
keeps their file dumps out of the thread's context. Settings → Models → Use for subagents picks their model:

- **Let the model choose** (the default): the thread picks per subagent, Haiku for searches and lookups,
  Sonnet for most coding, Opus for hard reasoning where a mistake is costly.
- **Same model as the thread**: every subagent runs on the thread's own model.
- **Any model any CLI serves**, grouped under Claude (Fable 5.1, Opus 5.5, Sonnet 5.5, Haiku 5.5), Puku
  (Opus 4.8, Puku AI 2.8, Puku AI 2.7), Codex and Goose. On a thread whose CLI serves it, the model is forced
  through that CLI's env (`CLAUDE_CODE_SUBAGENT_MODEL` or `PUKU_CLI_SUBAGENT_MODEL`). On the other CLI's
  threads, the thread runs that CLI headless as the subagent (`puku-cli -p … --model opus-4.8`, or
  `claude -p`), read-only unless the task needs edits. That needs the other CLI installed and logged in.
  A Goose thread has no Agent tool, so every subagent is a Bash run: `goose run --text …` on the thread's own
  provider and model (or `--model` for a picked Goose model), or the other CLI's headless line.

**Backup model** (`Settings → Models → Backup model`) is the model a card reruns its first message on
when that very first turn came back an error (a rate limit, mostly), and the model every thread moves
to when the model it was on has hit its limit. The open thread shows a banner
with **Rerun on &lt;backup model&gt;** (or **Pick a backup model** when none is set, which jumps to
Settings → Models) and **Delete**. "Off — no backup" hides the Rerun button entirely.

Idle threads pick a change up on their next message.

Weft keeps track of each thread's subagents and background commands from the events the CLI sends. A line
above the reply box says what's running and what finished ("3 subagents running · 2 done") and opens to each
one's elapsed time, tool count and latest line; the card's footer counts the running ones (⑂3). A thread with a
background task running keeps its CLI open past the idle timeout, since closing it would end the task. If the CLI
ends anyway (a Weft restart), the tasks it took down are marked cut off and named to the thread with your next
message, so it checks their output or reruns them instead of waiting.
Each running row has a ■ Stop that ends just that task.

## Services and dev servers

The rail's 🖥 **Services** drawer lists everything Weft spawned: each thread's CLI (named by its card) with whatever
it started, each dev server, each terminal shell and any other command, with its CPU and memory. The top says what
they use out of this Mac ("2.8 of 10 cores · 7.9 GB of 16 GB"), splits it by kind (threads, dev servers, Weft,
terminals) in a CPU bar and a memory bar whose empty part is the headroom left, and names the busiest service and
the one holding the most memory. Expand a row to see its processes; **End** stops a service (a thread's CLI closes the way keep-alive would close
it), and the ✕ beside a process ends just that one. Weft itself is listed so you can see what it costs, but can't
be ended from there. The menu at the top sets how often it refreshes (every 1, 2, 5, 10 or 30 seconds, or paused).

At the top of the drawer, above the CPU and memory, **Dev servers** has one row per folder your open cards work in, with the command that starts its
dev server, found in its files: a `package.json` script (`dev`, `start`, `serve`, `preview` or one that runs `next dev`,
`vite` and the like) with the lockfile's package manager, a Procfile's `web:` line, Rails, Django, a deno task, a
Makefile target or wrangler. A folder with more than one has a picker. **Start** runs it through Weft; once it runs,
**Stop** ends it and **Restart** starts it again, and the row says what happened ("Started 23:40 · starting", "Restarted 23:41 · 2× ·
running") and links its url. A server a card already started is restarted, not started twice, and a port something
else already answers on is named, and a server a thread started names that card ("· by Fix login"), which a click opens.
Weft's own folder is listed last as "Weft itself" with no Start or Stop (its dev server is the one serving the board),
and a link to the address it runs on (`:1024 ↗`), which opens in your browser since the pane won't show Weft inside itself. In the
list below, a thread's name (a card's CLI, its dev server) opens its card too.

Dev servers aren't kept inside threads. A thread starts one through Weft (`mcp__devservers__start`, which
`/weft:preview` uses), so it keeps running after the thread's CLI closes and doesn't hold the CLI open. Its row
has its url (opens in the browser pane), Restart, and Start once it stopped. A server a thread still starts with
Bash in the background shows too, stop-only, and stays out of the thread's task strip.

## No waiting for CLIs to start

A CLI takes 12–50s to start with a full Claude Code setup (MCP servers, plugins, hooks), so the
board starts them before you need them:

- Each thread's CLI stays open between turns, so a reply starts in about two seconds. By default
  it stays open until the app quits (Settings → Threads → Keep conversations open).
- On launch, the copilot's CLI starts, plus a spare CLI in your most recent project.
- Picking a project, opening the new-thread dialog, or opening a card starts a CLI for it in the
  background. A new card takes over the spare in its folder (up to three spares are kept).
- At most six threads run a turn at once (Settings → Threads → Threads running at once, 2 to 12 or no limit). Past the cap a
  thread's message waits on its card, shown as "when a slot frees" in its reply queue, and goes out, oldest first, as a
  running turn ends. A thread waiting on your answer doesn't count, and the copilot isn't a card.
- puku-cli is held tighter, since each one is a whole Node process: 2 idle puku CLIs at most, closed after
  10 idle minutes, and one puku spare, started only when the new-thread dialog has puku picked.

## Board status

Every thread's system prompt (editable in Settings → Threads → Thread instructions) asks it to end each
reply with a line like `BOARD STATUS: column=review | stage=First shot | remaining=add a test`.
The board strips that line, moves the card to the column the thread reports (Needs you, Review, or
Done), and shows the stage and what's left on the card. When a thread asks a question with its
AskUserQuestion tool, the card shows the question and its options instead of Allow and Deny.
The thread asks it the way Claude Code does, above the reply box: numbered options you move with ↑/↓
and pick by number or Enter, checkboxes for multi-select, a tab per question with a Submit tab to
review (whatever you type there goes with the answers as a note on all of them). The reply box is the one place to type: your
own answer when nothing is picked, a note on your pick when something is, and text you were already
writing carries over. An option's preview (a mockup or snippet) shows in the card's browser pane as you
highlight it. **Chat about this** sends the box's text to the agent instead of an answer, and **Skip** declines the
question. A send, number key or click in the first moment after a question appears is held, so a message you
were just finishing doesn't become its answer; an answer that doesn't arrive brings the card back to try again.

When a background command or subagent ends, the thread shows the `<task-notification>` the CLI sent the agent
(its summary, red if the task failed), so a turn it started on its own answers something you can see. A Review card
whose thread wrote no review tour still gets a **Done** button beside **Build review tour**: it runs `/weft:done`,
like a tour's last step.

A card leads with what the thread last said, under its title, beside its latest picture: a
screenshot or image from the thread, or a capture of its browser pane taken after each turn (hover
to see it bigger; a badge counts the thread's images). A card with no picture shows an emoji Haiku
picks from its title, or its folder's initial until then. Below that, eight dots show how far
through the stages it is (Planning to Done) with what's left, and the footer reads
`● weft 12m · 1t · $1.22` (the dot is the CLI: orange for claude, purple for puku).

A card whose title says nothing (a picked-up session called "Image attachment", "Untitled thread", or just its
prompt's first line), or one longer than six words, is renamed after its next turn, by Haiku, to 3 to 6 words
like "🐞 Compile Error: missing CoverageBadge import"; its emoji becomes the tile. Titles are never cut off
mid-sentence. A title you typed or edited is
never replaced, and Claude Code's own session title stops overwriting it once Weft has named the card.

## Skills and automations

Weft ships its own skills in `plugin/`, a Claude Code plugin named `weft` that every board thread
loads, so they run as `/weft:<name>`:

- `/weft:done` wraps up a thread: architecture docs, lint, tests, then a commit of the files the
  thread changed, then a push of the branch. A copy of the `done` skill from `fotoflo/claude-skills`.
  **Push on Done** in Settings → Automations (on by default) controls the push: it's a plain `git push` (`-u origin`
  for a branch's first), never forced, so a rejected push leaves the commit local and the card in Review.
  The push is the deploy: on a project linked to Vercel, `deploy.mjs` then checks that Vercel deploys from
  origin's repo (by id, so a renamed or re-created repo is caught) and waits for the pushed commit's build to
  finish, behind any deploys already running. A failed build comes back with its log: the wrap-up fixes and
  pushes again (twice at most) when the cause is its own, else starts a card to fix the build; either way the
  card stays in Review until it deploys. Files other cards also edited are committed whole,
  and the wrap-up never ends on a question.
- `/weft:commit` commits the thread's changes with a conventional message (the `commit` skill,
  without its Vercel preview deploy).

A board thread's commits are co-authored by "Claude Opus 5.5 on Weft" (whichever model the card runs)
and its PRs say "Generated with Claude Code on Weft".

Settings → Automations holds rules of the form "When … run …":

- **a thread starts**: the skill is named in the thread's first message ("Start by using the /x
  skill"), so it runs with the task in view.
- **you move a card to Review / Done**: the skill runs in the card's thread as its own turn, as if
  you'd typed `/<skill>`. Several rules for one move run one after another; a turn that's stopped
  or fails drops the rest, and one that ends needing you waits for your reply.
- **a prompt matches**: a case-insensitive regex (e.g. `vercel|deploy`) is tested against each
  message you send in a thread. On a match the skill runs as its own turn right after, once per
  thread per skill. An invalid pattern never matches, and Settings refuses to save one.

A new install starts with one rule: moving a card to Done runs `/weft:done`. Moves only run
skills on cards that have already run (and, for picked-up sessions, that Weft has run), and only
your own moves count: the copilot's moves and a thread reporting `column=done` don't, so the done
skill can't trigger itself. The rule's skill can be one of Weft's, one of yours in
`~/.claude/skills`, or a project's own (it then only runs in projects that have it).

Each card's **Skills** button lists the skills its thread can run (Weft's, the project's, and
yours) and sends the one you pick.

### Skill sets

Each thread gets only the skills its work needs. ✦ on the left rail shows the board's project's
**default set**: Weft's skills, the project's own, yours in `~/.claude/skills`, and your Claude Code
plugins (posthog alone brings 173 skills), each with a switch. A project's set starts from what its
threads have actually run: the first time Weft sees a folder it reads that folder's transcripts in the
background, keeps Weft's and the project's skills on, and turns off every skill of yours and every
plugin none of them used. Until that scan lands, threads there get everything, as before.

✦N in a card's header is that thread's own set (N skills its model sees). Turn one on or off there for
that card alone; a dot marks a row that differs from the project. A CLI reads its skills as it starts, so
a change applies from the next message (an idle CLI closes and resumes with the new set). A hidden skill
still runs when you type `/name` or an automation runs it; a plugin turned off is gone for that thread.
Claude Code and puku threads get the set as `skillOverrides` and `enabledPlugins` settings; Codex,
puku and Goose get the skill list Weft writes into their first message, filtered the same way. The copilot keeps
every skill. Cards on the project's default set still take a warm spare; a card with its own set starts
its CLI fresh.

### Finding and checking skills

Type in either ✦ list's filter and Weft also searches [skills.sh](https://skills.sh), below your own
matches. Click a hit's name and it opens in a new thread: the skill's skills.sh page in the pane, Weft's
scan and AI review, a short summary, and a question whether to install it; say yes and that thread
installs it. The ▾ beside a hit shows the same scan right in the list. Either way Weft downloads the
skill, keeps that exact copy, and scans every file, SKILL.md
included: malicious code (scripts piped into a shell, reverse shells, credential reads), prompt
injection (instructions to ignore you or hide things, invisible characters), telemetry (analytics
SDKs, webhook endpoints, every host a script calls) and its license. **AI review** has Sonnet read the
skill against those findings and opens a page in the pane: what the skill really does, which findings
are real, which are false alarms, and what the rules missed. **Install** writes the copy that was
scanned into `~/.claude/skills`; a dangerous one asks first. A review is kept with its copy, so a skill
is reviewed once per version, and the drawer still shows it when skills.sh is down. The skills you
already have get the same scan: a ⚠ beside one opens its review.

## Projects, filter, and sort

The bar under the header lists your most recent project folders. Click one to see only its cards;
More lists every project, opens a folder, or creates a new one. Filter and sort controls sit on
the right: press `/` to filter, and while you type a short list of matching cards drops down (↑↓ and
Enter open one), ending in a row that carries your text into the ⌘K palette to search prompts,
projects and commands too. Opened empty, ⌘K starts with the cards that changed column in the last day,
latest move first, so Enter opens the one that just finished. Each card row shows its last line of output (or its error)
under the title and how long ago it changed on the right. New threads default to the selected project. The New thread dialog drags by its header and
resizes from any edge or corner; it stays inside the window and remembers its size and position.

Each project has a changelog Weft keeps: threads record what they ship with `mcp__board__changelog_add`
instead of editing CHANGELOG.md (which every card used to edit at once), each entry links to the card that
wrote it, and the card's own commit stamps it with the sha. Right after that commit Weft writes CHANGELOG.md and
commits it on its own; when a commit bumps package.json's version, Unreleased becomes that version's section. There's
no release step to run. More → **Changelog of <project>** (or the ⌘K palette) lists Unreleased, then each version.
Signed in, entries are mirrored to your account (docs/architecture/changelog.md).

The header shows the code quality ("87% code quality") of the project in view: the open card's
folder, else the selected project, else your latest card's. It never reaches 100%, because there's always
another refactor, a stricter lint rule or a better type:

- **The checklist earns 90 points**: test coverage (`coverage/coverage-summary.json` from `pnpm coverage`),
  file size, lint lockdown, type safety, guardrails (pre-commit hook and CI) and documentation (README, agent guide,
  architecture docs, a CHANGELOG, files that open with a comment, no stale paths in the docs), averaged (`lib/quality.ts`).
- **The refactor scout earns the last 10.** A read-only Sonnet run (Read, Grep, Glob) reads the project and
  ranks up to 15 concrete findings, each with file:line, a Fowler-named smell (Long Function, Duplicated
  Code, Feature Envy, Primitive Obsession…), a category (refactor, lint, types, tests, guardrails) and a
  one-line fix. It also suggests lint rules that aren't on and loose types. The band is
  10 × 10 ÷ (10 + debt), where each open finding costs 3 (high), 2 (medium) or 1 (low): fixes raise it,
  new findings lower it. Before the first run the score tops out at 90; it's capped at 99.
- The scout's report is cached in `~/.weft/scout/` with the commit it ran on. It runs on its own only
  once, for a project with no report; after that `/weft:done` scouts the session's files and merges its findings
  in, and **Re-scout now** reads the whole project again. A new commit alone never starts a run.
  It never runs on the start-a-card path.

Hover the badge for how the number is made. Click it for a menu: **Fix the checklist, weakest first**
starts one thread on the checklist, and each scout finding starts its own small card ("Long Function:
runner.ts"), so improving code quality becomes a stream of small cards.

Beside it, **+1262/-832** counts the uncommitted pile in that project's repo: every line in the working
tree that differs from HEAD (hover for the file count and how many Review cards it belongs to). Review
cards pile up with working code nobody committed, so several cards' edits end up mixed in one tree. Click
the counter, or **Review all** at the top of the Review column, to start a card that walks you through committing it (`lib/commit-pile.ts`): it lists the
Review cards with the files each touched and its last status, flags files several cards share, files
only busy cards touched and files no card claims, then goes card by card in the browser pane with a
checklist page written for non-engineers (each change as its card picture or emoji, a plain sentence on what it
does, its review tour's "try it" steps, the files folded under Technical details, and a review bar
under each change: Commit, Commit and push, Commit and run /done, Skip for now, or type what to change): what changed, lint, typecheck and tests, and a commit of just that card's files by path
(`commit.sh`; never `git stash`, `git reset` or a bare `git commit`). The Commit buttons carry the paths and
message, so a click runs on its own, no LLM turn (`lib/pile-commit.ts`, `POST /api/cards/<id>/commit`): Weft commits
only files that are still uncommitted, pushes if asked, moves the change's card to Done if asked, adds a Commit line to
the thread and stamps the page. Only a failure (a pre-commit hook that refuses, a rejected push) goes to the thread as
a message, so it can fix it; Skip and typed requests still go to the thread.

Next to it, a list icon and a number (**☰ 7**) count the cards waiting in Backlog in that repo. Click it to start a
card that plans them into sprints (`lib/sprint-plan.ts`, `app/api/sprint`). It reads each Backlog card against the
code without editing anything, sizes it S/M/L, and flags duplicates, cards already done, cards too vague to start
and cards too big for one go. It then groups the cards into sprints of 3 or 4 that touch different files, so a
sprint's cards can run side by side in one folder, clear of the cards already at work. The plan is a page in the
browser pane with one column per sprint, and its buttons (Start this sprint, Move to sprint…, Merge, Split, Archive)
answer the thread through `weft://reply` links. It starts a sprint's cards, or adds and archives cards, only when you say so.

## Progress: streaks, badges and your wefter card

Beside the code quality badge, **🔥 25 · Lv 15** is your streak and level (Settings → General → Show progress turns it
off). Hover it for today's numbers; click it for your **Wefter Profile**. A new badge or level pops up over the board
with a burst of confetti (none with Reduce motion on), and **See your profile** opens your badges. A level-up opens like
an episode: your rank's picture (our hovercar, wearing the Weft emblem, from a dusty garage at Thread to a cliff over the
woven city at Tapestry), "Episode XXIV" and a line of story rising over it, read aloud by a narrator (🔊 mutes the voice). **Replay last achievement**, in the avatar's
menu and the palette, shows the last one again:

- **XP and levels.** Starting a card earns 2 XP, a turn 1, and taking a card to Done 10, or 15 when its
  project's quality checklist scores 80+. Shipping pays more than starting, and healthy code pays more than
  volume. Levels climb a square curve, titled Thread, Strand, Yarn, Bolt, Loom and Tapestry.
- **Streaks.** Any day you start, work on or ship a card counts. Every 7 days in a row earns a streak freeze
  (up to 2); a missed day spends one instead of ending the streak. The chip dims when you haven't done
  anything yet today.
- **Your wefter card.** "Wefter: your name · your class", with your GitHub profile beside it when the `gh` CLI
  is signed in: picture, @login, bio, location, company, site, followers and repos (`lib/github-profile.ts`,
  `gh api user`, kept for 6 hours). Your streak reads as your wefting streak, so many days straight. Seven attributes worked out from what you build: Follow-through (cards that reach
  Done), Velocity, Range (projects and stacks), Rigor and Guard (the projects' testing, security and
  observability checks), Craft (the cards you wrapped up with `/done`, reviewed, documented and refactored) and Stamina. Your top
  two name your class, like "Roaming Shipper". Stack skills level up each technology (from `package.json`
  and friends) by the cards you ship with it.
- **Tokens and limit hits.** Your last 30 days of tokens as bars, read from every Claude Code and puku-cli
  transcript (in Weft or the terminal, so it has your history from day one), with a dot over each day you
  ran out of your 5-hour (amber) or weekly (red) plan limit. Hover a day for its tokens in and out and its hits.
  The legend shows your fastest burn of each window (from the window opening to the hit).
- **Limit badges and the Fastest Burn leaderboard.** A Limits badge family: a ladder for hitting your 5-hour limit
  1, 2, 5, 10, 20, 50, 100, 250, 500 and 1,000 times, the same for weeklies, speed badges for burning a window fast
  (⚡ Speedrun is a 5-hour window gone in under 30 minutes), and badges for several hits in a day or days in a row.
  The 🏆 Leagues dialog's **⏱️ Limit records** shows the all-time boards: fastest 5-hour, fastest week, most of each hit.
- **The cloth.** Your last 26 weeks as woven stitches, brighter for bigger days, blue where a freeze covered one.
- **Badges.** 143 of them in 17 families: milestones (to 2,500 shipped and 100,000 turns), streaks (to 1,000 days),
  speed (🏭 Assembly line: 10 ships in an hour), the calendar (🥧 Pi day, 🍂 Four seasons), habits, parallel (🐙 Octopus),
  tokens and spend (💰 Billionaire, 🐋 Whale), limits, craft (/done, code reviews, docs), the board, projects, leagues
  (🥇 Week winner, 🔄 Comeback), social (referrals, a team of 5), the Weft explorer family (first use of the vault, the
  webhook relay, a dev server, a pane screenshot, sharing, your profile, every feature intro), secret ones that show
  as ❓ until you earn them, code health and the production-ready tree. New ones and level-ups arrive as a toast.
- **Projects.** Each of your busiest repos' production-ready tree: Testing, Security (secrets ignored, secret
  scanning, Dependabot, security headers, SECURITY.md), Observability (analytics, error tracking, tracing,
  structured logs, a health route), Docs and Delivery. Every check Weft finds missing has **Set it up**,
  which starts a card to install it. All five branches make the project **🚀 Production-ready**.
- **League.** Signed in to Weft, you're in a weekly league of up to 30 builders, Cotton to Gold Thread, ranked by the
  XP you earn Monday to Sunday; the top 7 move up and the bottom 5 move down (fewer in a small league). Each row shows
  that builder's week (XP, cards shipped, streak, level, the badges they earned since Monday) and opens their
  `weft.zip/@username`. Only those numbers and your name go up, never prompts, code or project names. New accounts
  join the current week's Cotton league the day they sign up. The header's **🏆 Linen #1** chip, beside the streak,
  opens every league: click any tier, Cotton to Gold Thread, to see each of its leagues this week and who's in them.
  The profile's League tab keeps just yours.
- **League emails.** Weft emails you about your league: a welcome on day one with who's in it and the rules, a
  Thursday and a Sunday nudge only when a move is in play ("27 XP from moving up", "9 XP keeps you in Wool"), and
  Monday's results (moved up, held, or moved down, with last week's podium). One email a day at most; every one has a
  one-click unsubscribe.

Everything comes from `~/.weft/activity.jsonl`, an append-only log the board writes as cards change
(`lib/activity.ts`). The first time, it fills itself from your existing cards, imported Claude Code sessions
included, so your history counts from day one. See docs/architecture/gamification.md.

## Logging in

When a thread fails because its CLI isn't logged in, the board runs `<cli> auth login` in the
background and pops up a login window with the login page link, the CLI's output, and a box for
pasting a code. If the CLI needs a real terminal, it opens Terminal with the login command instead.
Once `auth status` reports you're logged in, the thread runs again. Settings shows each CLI's
login status. The app also sends a desktop notification when a card needs you or finishes while
it isn't focused, and shows the Needs you count on the dock icon. A card that moves to Needs you,
Review or Done without you keeps an accent tint and a pulsing dot until you open it.

### Weft account (optional)

**Sign in** in the top bar (right of Copilot) signs you in with GitHub; once you're in it shows your
avatar, which opens a small menu headed by your current team, its plan and one button: **Upgrade to Pro** on Free,
Open Source and Education, **Manage billing** on Pro and Team (`components/AccountPlan.tsx`). Settings → Accounts → Weft account also offers Google and an email link, and Sign out. Settings → Accounts also has a **Sign-in expiry** row, so a lapsing sign-in is something you find in Settings rather than when a thread trips over it: BlastCP's 30-day grant is the one that runs out and speaks up in its last week, while Vercel, Supabase and Cloudflare tokens don't expire and say so. Only the expiry crosses from Electron main — tokens stay in the Keychain — and nothing re-consents on your behalf (`components/TokenExpiry.tsx`). The board works the same
signed out; the account is for cloud features (page sync, share links) as they land. Sign-in opens
your default browser and comes back to Weft through a `weft://account-callback` link, so the board
shows you signed in a moment later. The session is kept in `~/.weft/account.json`, readable only by you
(sealed by the Keychain in the desktop app); Sign out forgets it on this Mac only. An email link has
to be opened on the Mac that asked for it.

### Teams

Every Weft account has a workspace. **Your team** in the account menu opens `weft.zip/team` in the browser pane
(sign in with GitHub there once): the roster, roles (owner, admin, member), email invites and pending invites. An
invite link joins whichever account opens it. Billing and the shared 🔐 vault hang off the same workspace
(docs/architecture/teams.md).

You can be in many teams. **Settings → Teams** lists every one with your role in it, the one you're viewing lit;
click another to manage its projects, members and invites below the list, or **New team** to make one you own.
Owners and admins choose who sees each project: **Access** on a project's row ticks the members who get it. Owners
and admins see every project; a member sees only the ones they've been given.
The pencil beside a team you own renames it; its weft.zip address stays the same. The trash deletes it, once you
type its name, as long as you're in another team too and it has no paid plan still running.

## Star and tags

Star the cards worth keeping: hover a card and click its ☆ (or click ☆ at the top of an open thread), press K in its
right-click menu, or drop it on ★ at the top of the rail on the board's left edge. A starred card shows ★ and is never
auto-archived. Click ★ on the rail to show only starred cards.

Tags sort the rest. They follow GitHub's label rules (lowercase, up to 50 characters, up to 8 on a card), so they
match issue labels one to one.

- A card shows up to two tags and "+N" at the end of its stage line. Click one to show only cards with that tag.
- **Tags…** in the card menu (G), or a click on the tags in an open thread's header, edits them: chips with
  autocomplete, saved as you go.
- 🏷 on the rail (⌘L) opens the tags drawer, like GitHub's labels page: make a tag with a colour, rename it
  (double-click or ✎) everywhere at once, recolour it, delete it from every card, click one to filter the board, or
  drop a card on one to add it. The catalog lives in `~/.weft/tags.json`.
- Weft tags cards for you. After a turn, the same Haiku call that names a card gives an untagged one 1 to 3 tags,
  reusing the board's own tags where one fits. Tags you set or clear yourself are never changed.
- The copilot can set tags, tag the cards it creates, and sees ★ and tags in its card list.

The old library's recipes, to-dos and notes became starred cards tagged `recipe`, `to-do` or `note`; their files in
`~/.weft/library` and the recipe skills in `~/.claude/skills` are still there. More in
[docs/architecture/tags.md](docs/architecture/tags.md).

### A starter Backlog for a new project

The first time a project lands on the board, Weft parks up to 6 cards in its Backlog from what it can already see:
**Set up for agents** when there's no CLAUDE.md or AGENTS.md, migrations the linked Supabase project hasn't applied,
up to 3 open GitHub issues assigned to you or labeled bug, the 2 most important failing production-ready checks, and the
file with the most TODOs. Nothing starts on its own, and nothing already on the board is added twice. **Re-seed Backlog**
in the project menu runs it again; the copilot's chips offer the same finds. More in
[docs/architecture/project-seed.md](docs/architecture/project-seed.md).

### GitHub issues

GitHub's mark at the bottom of the left rail opens the GitHub drawer: who the `gh` CLI is signed in as (or how to sign
in, with `gh auth login --web`), and each board project's repo with an **Issues → Backlog cards** switch, its last sync
("Synced 3m ago · 2 added"), **Sync now** and links to the repo and its issues in the browser pane. Weft never holds a
GitHub token; `gh` keeps its own. ⌘K → **Import GitHub issues into <project>** turns sync on too. Signed in to a Weft
account, **Instant, by webhook** adds a webhook to the repo (you need admin on it), relayed by the deployed Weft on Vercel and Weft's Supabase, so
cards follow issue changes within seconds instead of on the next 5-minute check.

A synced project's open issues become Backlog cards, through the `gh` CLI. Each card gets the issue's title, its body plus a link and a reminder to put `Fixes owner/name#N` in the commit,
and its labels as tags (in their GitHub colours). The card shows "#N", linked to the issue. Weft checks again every 5
minutes: a closed issue archives its card if the card never started, and a card that has started is never touched. A
card you delete stays deleted. It's one direction for now; Weft never edits an issue. More in
[docs/architecture/github-issues.md](docs/architecture/github-issues.md).

### Server-side cards (off by default)

Weft asks once, after a thread in your project has reached Review: "Turn on Project Sync for <project>?" with **Sync**, **Not now**
and a **Don't show me again** box (it asks again next launch until you sync or tick it; Settings → General → Reset tips brings it back).
Signed out, it is Weft's one sign-in ask instead: "Sign in to Weft?" with what an account gets you (Project Sync, share links,
leagues, the Puku trial) and **Sign in with GitHub**; once you're in, it offers to sync the project. Settings → Sync lists your recent projects with a switch each, and the switch follows you between Macs: sign in on a second Mac
and each project you sync elsewhere turns on there too, matched by its GitHub repo (a clone you make on that Mac included). A project that's on uploads its cards and threads to your
workspace on Supabase while you're signed in: an outbox sends a batch when a turn ends (never on the way to starting one),
pictures and pages go up once each by content, and the page shows the last sync, how many items went up, how many wait and the
last error, with **Sync now**. The avatar menu says it in one line under your plan ("Synced 2m ago · 3 projects", "Syncing 12
items…", "Sync failed" with why), with **Resync now** and **Sync <project>** / **Don't sync <project>** for the board's project,
and the avatar wears a dot while an upload runs (amber) or after one failed (red). At `weft.zip/<workspace>/board` the same cards show live, drawn by the desktop's **own
components** — the same header (New thread on N, your avatar with workspaces, Team, Billing and Sign out), the same project
chips, filter and sort, the same 38px rail (★ starred, 🏷 tags, Board, Team, Billing), the same columns and cards (stage,
tags, model, picture or emoji, what's left) and the same open-card window. One implementation, two hosts: a `variant="web"`
seam hides only what the Mac owns (the browser and terminal panes, the local Settings, the project's filesystem), so a change to
the desktop board reaches the web board with it.
A click opens the card framed over the board like on the Mac, its browser pane's page on the right (synced pages sandboxed, a
localhost page as its last capture) and the thread on the left the way the desktop draws it, oldest first with tool runs folded, Markdown, screenshots and tool outputs loading when you
open them. **New thread** on the web board starts a card on your Mac: pick one of your synced folders, write the prompt, and the Mac that
owns the folder makes the card and runs it, then the board opens it (the Mac has to be on and running Weft). The open card's reply
box is the desktop's own and sends to that Mac too: your message goes into the thread as if typed there (held until the running
turn ends, or **Send now** to stop it first), a permission request or question the thread is waiting on can be answered right there,
■ stops the turn, and what the thread says comes back within about a second. Thread text isn't encrypted yet, so
turn it on only for projects you're fine storing on Weft's servers. Separately, a long thread opens on its newest 50 items
and loads older ones as you scroll up. More in [docs/architecture/cloud-sync.md](docs/architecture/cloud-sync.md).

**Share…** on a card's right-click menu (or the share icon in the browser pane's toolbar, beside ☆ and Archive) makes a link, `weft.zip/s/<id>`, that shows the card's thread and the page in its browser
pane side by side, updating as it works: private to your workspace, public, behind an email or behind a password. A
`~/.weft/show` page runs in a sandbox; a localhost page shows as its latest capture. Key-shaped text is masked and long tool
outputs stay on your Mac. It reads what sync uploads, so the dialog turns sync on for the folder first. More in
[docs/architecture/sharing.md](docs/architecture/sharing.md).

**Share the board** (the share icon beside your avatar, its menu, ⌘K, or **Share** in the weft.zip board's header) shares the whole board: its link is your workspace's web board,
`weft.zip/<workspace>/board`, with Copy and Open, a list of who can open it (members and pending invites), and an email box.
An address that already has a Weft account joins the workspace at once; one that doesn't gets an email inviting them to sign
up and join. Only owners and admins invite; a teammate sees the link and the list.

Every account has a public profile at `weft.zip/@username` (your GitHub login): your Wefter Profile for anyone to see.
Your picture in a ring that fills toward your next level, your class, your GitHub bio and facts, this week's league
and rank, XP, cards shipped, streak, badges, the builder card's attributes and skills, the activity cloth, tokens
used in the last 30 days and your records, plus the mini apps and threads you've shared publicly. Your Mac posts the
card every 10 minutes while you're signed in (`lib/profile-card.ts`). It never shows your email, workspace, projects
or folders. More in
[docs/architecture/profiles.md](docs/architecture/profiles.md).

## Secrets vault

🔐 sits on the rail under ★ and 🏷 and opens the same drawer, with a vault for every project on the board. Its
project filter follows the project picked in the top bar until you pick another there (All projects shows every
vault); picking a project in the top bar takes it back. A vault belongs to the GitHub repo in `git remote` (or the
folder), so clones of one repo share it. It lists names by Development, Preview and Production with only the last
four characters showing.

- **Add** (or ⇧S on the board, or "Add a secret" in ⌘K) types a secret in by hand. With no value typed, the
  button is **Add blank / Add N blanks**: the name goes in without a value, the user fills it in from 🔐 later.
  The ✎ on a row, or **Change Value…** in its right-click menu, gives a secret a new value; a name still
  missing one gets a visible **Fill in** button (and **Fill In Value…** in the menu) with the hint a thread
  added under the name. Blanks sort first within each environment so the ones to fill in sit at the top.
  The 🎲 beside the value field fills in a random 40-character string (letters and digits) for a value you make
  up yourself, like a `CRON_SECRET` or a signing secret.
- **Copy to <project>** in a secret's right-click menu copies it into another project's vault inside Electron
  main, so the value never reaches the board; a name still missing its value goes over as missing.

- **Import…** reads the project's `.env` files (the root, `apps/*` and `packages/*`) in Electron main, never in a
  thread, and previews each name as new, same, differs or missing before anything is written. `.env` is offered
  unticked, `.env.example` brings names only (shown as missing until filled), `NEXT_PUBLIC_*` gets a public tag,
  short-lived `vercel env pull` values are skipped, and a file git tracks gets a warning to rotate its values.
- **Opening a project takes it in.** Pick a project on the board and Weft moves the new values in its untracked
  `.env` files into 🔐 with no click (never over a value the vault holds, never from a file git tracks: those get
  "rotate" instead). The keys its code reads, the names `.env.example` lists and the webhook routes it serves come
  in as 🔐 and 🪝 blanks with a link to each provider's page. A screen lists what moved and what's left, by name, with
  **Set it up in a thread** to start a card that walks you through the blanks and webhooks. Anything you remove stays removed.
- A dot on 🔐 means `.env.local` has values the vault doesn't hold yet; its count is names still missing a value.
- **Weft can write `.env.local` for you.** Tick "Then let Weft write .env.local from the vault" in the import preview:
  the file gets a `# Managed by Weft` header, stays gitignored and readable only by you, and follows every change to
  the vault, so `next dev`, Prisma and your scripts keep reading it. Edit it by hand and the drawer offers to import
  your change. Weft won't take over a file git tracks or one with values the vault doesn't hold yet.
- Revealing or copying a value asks for Touch ID (or a confirmation on a Mac without it). One Touch ID covers a few
  minutes of use, the drawer hides values again after 3 idle minutes, and a copied value leaves the clipboard
  after a minute.
- **Every Keychain access is logged.** Each time Weft opens something it keeps in the Keychain (the vault key, a
  provider's token, your sign-in), and each time a secret is revealed, copied, typed into a page, run with, pushed or
  written, by you, a thread or Weft, there's a line: who (whose thread it was), which names, where, and whether it was
  allowed. Names only, never values. The log is kept in your Weft account, not on your Mac, where it could be edited:
  each line uploads within seconds and is then deleted from the Mac, the database stamps when it arrived, and lines
  are numbered, so a line held back or removed before upload shows. See it in Settings → Security → **Keychain access**.
- **Give a thread standing access.** Right-click a card → **Give 🔐 Vault Access for 1 Hour**, or let the thread ask
  (`mcp__secrets__request_access`): one Touch ID and its fills, commands and dev server stop asking for an hour. It
  still never sees a value, and writes still ask. Revoke it from the same menu or from Settings → Security.
- **Threads save a key they need as a blank right away.** When a key isn't in the vault yet, the thread
  calls `mcp__secrets__add_blank` (with a hint for where to get the value) and keeps going with what
  doesn't need it; 🔐's count goes up, the row shows **Fill in** and the hint under the name, and you
  paste the value when you're ready. Blocked on it now, the thread calls `mcp__secrets__ask_add` and shows
  an input for the key right in the thread: paste the value, click **Add to vault**, and the thread carries on.
  A key that already has a value stays as it is, and the thread is told so.
- **Threads store values they made or got themselves.** A signing secret it generated, or new price ids from a
  Stripe sandbox: `mcp__secrets__set_value` adds the name or fills its blank, and with `replace: true` overwrites
  the old value. Touch ID asks every time and says which it is ("let a thread overwrite the production value of
  STRIPE_PRICE_PRO (aimhuge/weft) with a new one").
- **Threads fill fields for you without seeing the value.** A thread lists the vault's names
  (`mcp__secrets__list`), opens the page in the browser pane and calls `mcp__secrets__fill_field`: Touch ID asks
  "let a thread type GITHUB_CLIENT_SECRET (aimhuge/weft) into supabase.com", then the value goes into the field,
  masked, and reads back to the thread as `‹GITHUB_CLIENT_SECRET›`. One yes covers that card on that site for 3
  minutes; https pages only; the drawer being unlocked never lets a thread in.
- **Threads run commands with secrets without seeing them.** `mcp__secrets__run("pnpm run job", ["DATABASE_URL"])`
  shows you the exact command, the `package.json` script behind it and the names, with **Allow once** or **Always
  allow**, then Touch ID. Electron main runs it with no shell and the values in its env only, and the thread gets the
  exit code and output with every value (raw, URL-encoded, JSON-escaped or base64) shown as `‹DATABASE_URL›`. Pipes,
  redirects, `$VAR`, `sh -c`, `node -e`, `printenv` and network tools like `curl` are turned away. Always allow is
  remembered per vault, folder and command, and asks again if a thread edits the script.
- **Dev servers get the vault's development values.** Starting a card's dev server from its review tour asks the same
  way the first time; the values reach the server only, its log is redacted, and threads' own shells never get them.
  A card that used secrets has them swapped for `‹NAME›` in every tool result Weft stores or indexes.
- Values are encrypted at rest (XChaCha20-Poly1305 under a per-vault key sealed to this device's X25519 key,
  whose private half safeStorage keeps in the Keychain), in `~/.weft/vault/`. Only the board window can open
  the drawer's side of the vault, never the copilot or a browser-pane page; threads get names, and values only
  through a Touch ID'd fill, run or dev server. More in [docs/architecture/secrets.md](docs/architecture/secrets.md).

## Vercel

▲ under 🔐 on the left rail links each board project to a Vercel project. Paste a token from
[vercel.com/account/tokens](https://vercel.com/account/tokens) once; Weft checks it with Vercel and keeps it in your
Keychain, and threads never see it. **Link…** lists every project the token reaches, across your account and teams,
best fit for the folder's GitHub repo or name first, with a search. **+ New project** makes one instead: the name
starts as the repo's, the team as your default, the framework comes from `package.json`, and a tick connects the
folder's GitHub repo so every push deploys. Either way Weft writes `.vercel/project.json` (and adds `.vercel` to
`.gitignore`), just as `vercel link` does, so the Vercel CLI in any thread works on the right project. A linked
project shows its team, production URL, latest deploy (Ready, Building, Failed; click to open it in the browser
pane), whether it deploys from this folder's repo, and links to the latest deploy's page, logs, env vars, domains and
the Vercel dashboard. Its 🔐 line lines up the project's vault secrets with its Vercel variables per environment:
**Push** sends a value from the vault to Vercel (as sensitive, after Touch ID), **Push all** sends every one
behind a single Touch ID, and a thread can do the same with
`mcp__secrets__push_to_vercel`, so a key never goes through the dashboard or a thread. The other way, **pull** brings
a plain Vercel variable the vault has no value for into it (sensitive ones can't be read back), and **Live pull from
Vercel** does it the moment one is added, through a team webhook relayed by the deployed Weft (Pro or Enterprise teams,
signed in to Weft). When the two drift apart, Weft notices on its own as a project opens: 🔐 and ▲ on the rail light
up, the drawers say "4 on Vercel not in vault: pull? · 2 missing on preview: push?" with **Pull** and **Push N** beside
it, and the copilot lists it under what isn't set up yet. More in
[docs/architecture/vercel.md](docs/architecture/vercel.md).

## Supabase

Supabase's green bolt under ▲ links each board project to a Supabase project. Paste a personal access token from
[supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens) once; Weft checks it with
Supabase and keeps it in your Keychain, and threads never see it. **Link…** lists every project the token reaches,
best name match first, and **+ New project** makes one right there (name, org, region; Weft makes the database password
and keeps it in the project's 🔐 vault as `SUPABASE_DB_PASSWORD`); Weft writes `supabase/.temp/project-ref` (and keeps `.temp` out of git), just as `supabase link`
does, so the Supabase CLI in any thread works on the right project. A folder whose `.mcp.json` already points the
Supabase MCP server at a project shows up linked. A linked project shows its org, state (Healthy, Paused…; **Restore**
wakes a paused one), region, API URL, which of the folder's `supabase/migrations` haven't been applied yet (with **Migrate**, a card that
reviews them, applies them on your OK and lines the files up with Supabase's history), and links
to its auth users, logs, API keys, usage and dashboard. A thread that writes a migration applies it itself in the same
turn; it asks first, with buttons, only when the migration drops or rewrites data. More in
[docs/architecture/supabase.md](docs/architecture/supabase.md).

## Cloudflare

Cloudflare's orange cloud under Supabase's bolt links each board project to a Cloudflare Worker or Pages project. Paste
a setup token from [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens) once (the
"Create additional tokens" template): Weft makes its own narrower token with it ("Weft on <your Mac>": account
settings, Workers and Pages, in every account), keeps that in your Keychain and deletes the setup token. A token you
made for Workers and Pages yourself works too, kept as it is. Threads never see either. **Link…** lists every Worker and Pages project across the accounts the token reaches, best fit first: the
one the folder's `wrangler.toml` / `wrangler.json(c)` names, then the one built from its GitHub repo, then its name.
Cloudflare has no link file of its own, so Weft keeps links in `~/.weft/cloudflare-links.json`. A linked project shows
its account, address (custom domain, else `pages.dev` or `workers.dev`; click to open it in the browser pane), latest
deploy (Ready, Building, Failed for Pages; Deployed and by what for Workers), where it deploys from, and links to its
deploys, logs, settings, domains and dashboard. More in [docs/architecture/cloudflare.md](docs/architecture/cloudflare.md).

## BlastCP

The BlastCP rocket under 🔐 and ▲ on the left rail shows what each board project has queued on [BlastCP](https://blastcp.com), the
posting queue. Signed in to your Weft account, you're connected with no browser: Weft swaps its sign-in for a BlastCP one
and BlastCP makes you an account the first time (if your email already has one, you confirm it on BlastCP once).
**Connect with Weft** does it by hand, and **Another BlastCP account** opens BlastCP in your browser to sign in and approve
Weft (OAuth with PKCE). Either way Weft keeps the sign-in in your Keychain and threads never see it. **Link…** picks the property a project posts as, from
every workspace you're in, best name match first, or **+ New property** makes one on BlastCP (named after your
search or the project, in the workspace you pick) and links it. A linked project shows its next scheduled posts with their
platform and time, a line of drafts, posts to approve and failures, and when the last one went out; clicking any of
them opens it in the browser pane. BlastCP sign-ins last 30 days: one made through your Weft account renews itself in its
last week, and one made in the browser warns and offers Reconnect. Your Weft plan comes with BlastCP: connected with
your Weft account, your own BlastCP workspace goes on BlastCP Creator while you're on Team, or own a Pro, Open Source
or Education workspace, and back to BlastCP Free when that ends (a BlastCP plan you pay for yourself is never touched).
More in [docs/architecture/blastcp.md](docs/architecture/blastcp.md).

## Connectors

Settings → **Connectors** lets your threads work in your own accounts. The first one is **Google Workspace**,
through [gog](https://github.com/steipete/gogcli), which Weft.app ships: Gmail, Calendar, Drive, Docs, Sheets,
Contacts and Tasks from any thread's Bash. Choose a Google Cloud OAuth client JSON (Desktop app) once, then **Sign in
with Google** for each account; tick **Read-only** to keep threads from changing anything. Threads ask before
they send mail, change events or share files. More in [docs/architecture/connectors.md](docs/architecture/connectors.md).

**Simulators** sits beside it: threads drive iOS simulators and Android emulators with `mcp__simulator__*` (boot,
install and launch an app, open a deep link or your dev server in mobile Safari or Chrome, read the screen, tap and
type by element, screenshot, logs), and `watch` puts the device live in the browser pane. The card shows what's on
your Mac (Xcode, an iOS runtime, AXe, the Android SDK, adb, a virtual device), and **Install** beside each missing
piece downloads and sets it up for you, showing its progress in the row (Xcode and Android Studio themselves get a link). More in [docs/architecture/simulators.md](docs/architecture/simulators.md).

## Slack

Slack's four-colour mark on the rail connects the board to a Slack workspace. Weft talks to Slack over Socket Mode, a
connection from your Mac out to Slack, so nothing needs a public URL. **Create the Weft app** opens Slack with Weft's
app manifest filled in (or `pnpm slack:manifest <app id>` puts it on an app you already made); install it, then paste
its bot token (`xoxb-…`) and an app-level token with `connections:write` (`xapp-…`). Both stay in your Keychain. Pick a
default channel and what goes there, and map any project to a channel of its own: **commits** and **pushes** (from every board repo, whoever made them), **Vercel deploys**
when they finish, and **card status**: when a card lands in Needs you, Review or Done, its own Slack thread gets the
column, stage, what's left, a preview of its latest reply and a link to the card on weft.zip, where you can reply,
review or move it (its project needs to sync). Any kind can have a channel of its own under **Channel per kind**, so
commits can go to one channel and deploys to another whatever project they happened in. **Growth** is there too: a new
user, a new team and every payment land in the growth channel as they happen, and a summary with the headline numbers
and the growth dashboard's address goes out every morning. In Slack, `/weft fix the login bug` or **@Weft fix the login bug** starts
a card in that channel's project (or your default one), and **@Weft** in a card's thread sends that card your next message. More in
[docs/architecture/slack.md](docs/architecture/slack.md).

## Copilot

Press ⌘J (or the Copilot button) to open the copilot, your product partner: it helps you decide what to build next,
shapes an idea into cards, answers anything about your projects, and keeps an eye on refactors and your analytics. It
doesn't report the board back to you (the swim lanes do that), so its launcher shows a dot only when it has said
something you haven't read, never a count.
It uses `mcp__board__*` tools to list cards, read threads, create cards, start them, reply to
them, move and stop them, and answer their permission requests. Reading and rearranging the board
happen without asking; starting a thread, replying to one, or answering for one asks you first in
the copilot window. Each message you send it also carries a short note, which only the copilot
sees, of what finished, needs you or failed on the board since your last message
(`lib/copilot-digest.ts`), as context it brings up only when it changes the answer.

The copilot also speaks first, at most three times a day and never from 21:00 to 7:00: once in the morning, with the one
thing it would build or fix next (from the roadmap, recent commits and, when it can read them, your analytics), and after
work lands in a project, with the refactor worth doing now. When it has nothing worth your time it answers QUIET and the
check-in leaves the chat. Turn it off with "Checks in on its own" in the copilot's name menu
(`lib/copilot-initiative.ts`, docs/architecture/copilot-initiative.md). "New chat" starts a fresh copilot session. In a normal browser tab the
copilot opens as a pop-up at `/copilot`.

Pick who your copilot is from its name in the lane header (`lib/copilot-personas.ts`). **Wingman**, the default, is your
partner on what to build next. **Founder** tests the business before you build it: competitors, buyers, pricing, offer and unit economics, one
thread per step writing to a `founder/` folder, every number traced to an input (adapted from
[founder-skill](https://github.com/Jakeschincariol/founder-skill), MIT). **Captain** runs the work as a sprint: office
hours, CEO, engineering and design reviews, build, a staff-engineer review, QA, ship, retro, each step a thread (adapted
from [gstack](https://github.com/garrytan/gstack), MIT). Both run those projects' own skills when they're installed.
Switching persona starts a new chat, since the copilot reads its persona only when its CLI starts.

A new copilot chat suggests what to ask: up to four chips Haiku writes from what Weft knows about your work, about
direction more than status: what to build next, a refactor worth doing, your users, then anything blocking ("Build the
diff view in Review next, 20 cards wait on review", "Fill the Stripe vault blanks in weft: STRIPE_SECRET_KEY and
STRIPE_WEBHOOK_SECRET"). It also reads each project's roadmap and last week's commits (`lib/copilot-sources-product.ts`). It reads every open card in full (how long it has waited, its latest reply,
an open question with each option's meaning, the error, rate limits), the last day's finished cards, cards editing the
same file, spend and plan limits, the uncommitted pile, code quality and the refactor scout, your streak, Backlog, vault
and webhook blanks, what you asked the copilot lately and which chips you clicked, the latest Vercel deploy, unapplied
Supabase migrations, open GitHub PRs and issues, and which analytics each project ships (`lib/copilot-context.ts`,
`lib/copilot-sources.ts`, each source with its own timeout). The chips refresh in the background after a card moves and
sit above seven fixed starters, minus any a chip already covers (`lib/copilot-suggest.ts`). A chip sends itself, and
when it's about a card the copilot is told which one. `GET /api/copilot/suggestions?context=1` shows exactly what Haiku read.

The copilot also onboards you. It checks what isn't linked yet for your projects (`lib/copilot-setup.ts`: the Weft account,
the GitHub CLI's sign-in, Vercel, Supabase, Cloudflare, analytics), offers one "link it" chip when that would help, and
on "Help me get started" (or when a task needs it) reads `setup_status` and walks you through one link at a time, pointing
at the right rail drawer or offering a thread that adds PostHog or GA4 to a project.

On the board the copilot floats in the bottom-right corner like Intercom's messenger: a round launcher with its face
and a count of what's new, over the board, the New thread and card windows, Settings, the welcome and every other
dialog, so it's there wherever you are. Rest the mouse on it to peek (what finished since you last asked, the cards
waiting on you, its latest reply and an ask box; the maximize button opens the chat); click it to open the chat above
it, click again (the ×) to close it. The board keeps its full width. The browser pane stops short of the launcher and
steps aside while the chat covers it, since nothing in the page can draw over that native view. The top bar's ✨ Copilot
button, ⌘J and the command palette open and close it, and the choice sticks; ⌃⌥Space still opens the separate copilot
window, which works with the board hidden.

## Terminal

Press Control-backtick (⌃\`, as in VS Code) anywhere, `t` on the board, View > Terminal, or the terminal button in the header to
open a real shell in a drawer along the bottom of the window, for the commands a thread wasn't
allowed to run. Each folder gets its own shell: the drawer shows the open card's folder, else the
selected project's, else the latest card's, and switching project or card switches shell. Hidden or
switched-away shells keep running with their output. Split (or ⌘\\ in a terminal) adds a shell side
by side, up to three per folder; hover a terminal for its restart and close buttons. It's your login shell on a pty (`node-pty`, `electron/terminal.cjs`), drawn
with xterm.js (`components/TerminalDrawer.tsx`). Desktop app only.

## Email at weft.zip

Mail to any address at weft.zip (hello@, support@, you name it) lands in one inbox. Resend receives it (the domain's
MX record) and posts an `email.received` event to the deployed Weft, whose `/api/email/webhook` checks the signature,
reads the mail back and sends it on from `forward@weft.zip`, named "<sender> via <alias>" and replying to the sender.
Nothing runs on your Mac. `pnpm resend -- create|verify|webhook` sets up the Resend side through the vault. More in
[docs/architecture/email-forwarding.md](docs/architecture/email-forwarding.md).

## How it fits together

- `electron/main.cjs` starts the Next.js server, shows it in a window, and hosts the side browser
  as a native `WebContentsView`. Agents reach that pane through a token-protected control server on
  127.0.0.1; the board reaches it over IPC (`electron/preload.cjs`).
- `lib/runner.ts` runs each thread with the Claude Agent SDK (`query()` with streaming input, one
  CLI process per thread), streams messages to the board, and routes permission prompts to the card. For puku-cli it points the SDK at the
  `puku-cli` binary (`pathToClaudeCodeExecutable`).
- `lib/goose-runner.ts` runs a Goose thread instead: one `goose run` process per turn, its `stream-json`
  output on stdout parsed into the thread's rows, and the provider's key put in the subprocess's env by
  `electron/goose-env.cjs` from a one-time grant — so the key is in the process and nowhere else
  (docs/architecture/goose.md).
- `lib/new-thread.ts` holds the one list of CLIs — `BACKENDS`, `BACKEND_IDS` and `ALL_MODEL_IDS` — and
  every route that validates a backend checks against it, so the CLI you pick in the New thread dialog is
  the CLI the card runs on.
- `lib/board-tools.ts` gives the copilot its board tools, and every board thread a small `board`
  server with just `list_cards` and `create_card` (a card made this way records its `parentId`; `list_cards` prints
  one line per open card, newest first, and lists done and archived ones only with `include_done`); `lib/copilot.ts` keeps its thread, which
  has the fixed id `copilot` and is left off the board.
- `plugin/` is Weft's own skills, loaded into every board thread with the SDK's `plugins` option;
  `lib/skills.ts` lists them with yours and a project's. `lib/automations.ts` turns the Settings
  rules into messages, and `queueMessages()` in `lib/runner.ts` runs them one turn at a time.
- `lib/browser-tools.ts` gives every thread `mcp__browser__*` tools (open_url, read_page,
  screenshot, click, type_text) that drive the side pane. They're allowed without a prompt. Its
  `BROWSER_PROMPT` asks a thread facing a long task to open its plan as a page in its first tool calls and
  tick the steps off as it builds, so you watch the plan instead of a blank pane.
- `lib/show.ts` keeps the pane from ever being empty or stale. A card whose pane has no page gets a
  working page the moment its turn starts: a dimmed, slowly drifting scene of the Weft hovercar (one per card, from
  `electron/assets/backdrop-*.jpg` plus the splash's desert) behind the card's title, your ask with pasted images as
  thumbnails, and a running clock; the splash screen's desert scene sits beside the New thread
  dialog while you write the prompt, with a tip under it that changes every 8 seconds (a shortcut, or a drawer with
  **▶ Watch** for its intro; `lib/new-thread-tips.ts`), and starting the thread opens its card. Nothing plays there on
  its own: an intro and its voice start only when you click ▶ Watch or ▶ by the dialog's title. A turn that ends without opening
  anything in the pane gets a teammate's update page (how it's going, what we did, what's next),
  written in the background by Haiku with a bare CLI (~12s) and opened in that card's pane. A live app
  (an http page) and pages the thread opened itself are left alone. Pages live in `~/.weft/glance/`.
- `electron/pane-pages.cjs` remembers each card's page in `~/.weft/pages/index.json` (pages a thread wrote to
  `/tmp` are copied beside it), so a card opened after a restart shows its last page again, or its last
  update page when that page won't load (a dev server that isn't running).
- `app/api/*` is the backend: cards, threads, permissions, and a server-sent events stream
  (`/api/events`) that keeps the board live. Every route only answers requests addressed to
  127.0.0.1/localhost, and writes need an `x-weft-token` header, so other websites can't drive it.
- Cards live in `~/.weft/board.json`, thread views in `~/.weft/threads/`. The CLIs keep their own
  full transcripts as usual. Set `WEFT_DATA` to use another folder. A `~/.threadboard`
  folder from before the rename is moved to `~/.weft` the first time the app starts.

## Troubleshooting

If the page reloads over and over in development, stop the app, delete `.next`, and start it
again; a stale dev build cache causes this.

If a card, the thread, the browser pane, the rail, the terminal or the footer says it "failed to draw", a thread
was probably partway through editing Weft. The rest of the board keeps working, and the piece draws itself again
once the file is fixed (or click Try again). If the whole board fails, its page offers Try again and Reload window.
A build error (one file importing a name another no longer exports) is past any error boundary, since the code never
compiles, so Weft catches it at the edit instead: after every Edit or Write, a board thread and its subagents are told
which imports that edit broke, in any project, and fix them before you see the dev server's error
(`lib/import-check.ts`; `scripts/import-check-hook.mjs` does the same for other Claude Code sessions in this repo).
If one gets through anyway (a stray `}` mid-edit), the board you have keeps running the last version that built: a
small bar names the broken file in place of the dev server's Build Error overlay, and goes away once the file is fixed
(`components/BuildErrorBar.tsx`, `lib/build-error.ts`). Reloading the window while the file is broken shows the error page.
When a thread crashes or restarts Weft (stops its server, or leaves a file that doesn't build),
its card is ringed red with a **💥 Broke Weft** chip saying what it did; × dismisses it, and the thread is told with
its next message so it doesn't do it again (`lib/crash-blame.ts`). Starting a second Weft dev server in Weft's own
folder, the usual cause, is refused outright.
At startup, if the board doesn't load or its renderer crashes, the start screen says why and offers Retry, Logs
and Quit, rather than waiting on "Starting the board…" or leaving a blank window.

Every launch is timed, phase by phase: Electron start, login shell PATH, freeing the port, server start, board page
load and the board's first cards. The times go to `~/.weft/startup.jsonl` (the last 50 launches). When a launch takes
well over your usual time (1.5x and at least 2s more), the board shows a toast that names the slowest phase. To see
recent launches, run `node electron/startup-timer.cjs`.

See [docs/ROADMAP.md](docs/ROADMAP.md) for the feature list, and [docs/FAQ.md](docs/FAQ.md) (also at [weft.zip/faq](https://weft.zip/faq)) for common questions.

## weft.zip

The same Next.js app, deployed on Vercel, is Weft's website: with `VERCEL` set at build time, `/` renders the home page
(`components/home/Home.tsx`, what it says in `lib/home.ts`) instead of the board, which has no CLIs to run there. On your
Mac the page is at `/home` (`WEFT_HOME=1` shows it at `/` too). Its download button reads the latest release's
`update.json` from GitHub Releases once an hour and links the dmg; until the first release it points at the repo. The
shared-link picture is `app/opengraph-image.tsx`. The page is one screen, on purpose: the steel weave emblem and the twin suns scene from
`electron/assets/` (through `next/image`), one sentence, the download button, a real screenshot of the board in
`public/brand/board.png`, and the narrated welcome tour under it (`components/home/Tour.tsx`); retake that one when the board changes a lot (`mcp__board_view__screenshot` with the thread
panel and drawers closed).

Under the five pillars sits a short FAQ (`components/home/FaqTeaser.tsx`, six questions in `FAQ_HIGHLIGHTS` in
`lib/faq.ts`), each linking to its full answer on `weft.zip/faq`. That page renders `docs/FAQ.md` itself
(`app/faq/page.tsx`, `components/home/FaqDoc.tsx`) with the home page's nav and footer, so the repo and the site never
drift; the FAQ's pictures live in `public/brand/faq/` so GitHub and the site show the same files.

`weft.zip/terms` and `weft.zip/privacy` are the Terms of Service and the Privacy Policy (`app/terms/page.tsx`,
`app/privacy/page.tsx`), linked from the footer. Google Analytics and PostHog (with session replay) load on weft.zip only
after a visitor presses Accept in a small corner banner (`components/ConsentBanner.tsx`, the choice in `lib/consent.ts`);
the privacy page's Cookies section switches it back (`components/ConsentChoice.tsx`). One rule for every visitor, no
geo check. A local Weft never shows the banner, because it never loads either tool.

`weft.zip/login` is a real sign-in page (GitHub only) so a visitor can leave the marketing site with
a Weft account without the desktop app first. It has its own cookie session (`/auth/sign-in`, `/auth/callback`,
`/auth/sign-out`, refreshed by `proxy.ts`), so each visitor is their own account. A sign-in lands on the team page
(`/team`); `/app` is a small "you're in" card with the download CTA. The page is
`app/login/page.tsx`; the form is in `lib/auth/`, a thin wrapper whose public API mirrors
`@aimhuge/auth`.

## Contributing and license

Contributions are welcome, and the license is built so they stay open: you keep your copyright,
there's no CLA, and your code becomes Apache-2.0 two years after it ships. Start with
[CONTRIBUTING.md](CONTRIBUTING.md); security reports go to [SECURITY.md](SECURITY.md).
Weft is source-available under the [Functional Source License 1.1, ALv2 Future License](LICENSE)
(FSL-1.1-ALv2), with Weft Additional Terms. You can use Weft at work and build client work with it.
You can fork and change it for personal use, non-commercial education and research, and to send changes
back. A modified Weft used in or for a business, or built into a commercial project, needs a commercial
license. No copy may switch off or get around Weft's plans, limits or payments. You can't offer Weft,
or something built mainly on it, as a product or service that competes with Weft.
Each release becomes Apache-2.0 two years after it ships. Versions up to and including v0.3.0 were
released under Apache-2.0 and stay that way.

Weft™ and the Weft logo aren't covered by the license: a fork you share needs its own name and icon
(see [TRADEMARKS.md](TRADEMARKS.md)).

## Known gaps

- A card in a folder with no spare (or with a different CLI) still waits for its CLI to start the
  first time, unless it was opened or its project picked a little earlier.
- The copilot hears what finished or needs you only with your next message to it; it doesn't act
  on its own when a thread ends.
- puku-cli connects, but it was logged out during testing, so a full puku thread hasn't run yet.
  Run `puku-cli auth login` first.
- Only Claude Code sessions are picked up; puku-cli sessions (`~/.puku-cli/projects`) aren't yet.
- Picked-up cards open with the last 400 items of the conversation, and show the conversation as
  it was last read from disk, not live, until you reply in Weft.
- Automated tests are thin: `pnpm test` runs a Vitest suite over `lib/` (status parser, review tour,
  API guard, automations, formatting, settings, store, board tools) and over the API routes, with the
  runner and store mocked, and over the runner's SDK loop with a fake `query()`. UI tests have only started: the card, the reply box and the new-thread dialog (`components/*.test.tsx`, jsdom + Testing Library); the board and thread view have none. CI runs lint, typecheck and tests; a pre-commit hook type-checks what's staged. A "use client" module that reaches a Node built-in or a server-only module fails lint (`weft/no-client-server-leak`), because Turbopack panics on it and the board route 500s with nothing the UI can show.
- The packaged app's terminal drawer (`node-pty` now ships in the Electron bundle) hasn't been tried on a fresh Mac yet.
- Cards share a working tree unless you make one Isolated (docs/architecture/worktrees.md). An isolated card
  starts a cold CLI (no warm spare in its worktree yet), and its dev server's own port reaches it as `PORT`, which
  Vite ignores (pass `--port`). The pool's size is `worktreePool` in `~/.weft/settings.json` (0 to 3, default 1);
  there's no Settings row for it yet.
