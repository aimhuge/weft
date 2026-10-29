# Desktop shell

The Electron layer that wraps the Next.js server: the main window, the copilot
window, the side browser pane, the macOS plumbing, and the packaged-server
supervisor.

## `electron/main.cjs`

Boots the app, wires the OS in, and supervises nothing itself — server supervision
lives in `electron/server.cjs`.

- `app.setName("Weft")`, `productName` in `package.json` is "Weft".
- `TOKEN` is a 24-byte random hex string generated once at startup; passed to the
  control server (see below) and to the Next server as `WEFT_SHELL_TOKEN`.
- `PREFERRED_PORT` is `WEFT_PORT` or `1024`. From source, `server.cjs` first runs
  `electron/free-port.cjs`, which kills whatever listens there and deletes the dev build folder
  (`.next`), so a stale server never forces a second port or a shared build folder; the packaged
  app still falls back to a free port when 1024 is taken. (`pnpm dev`, the board-only mode without Electron, also
  uses `1024`, so a dev server and the desktop app never collide on different ports.)
- `app.requestSingleInstanceLock()` makes a second `weft` launch just emit
  `second-instance`, which the first process handles by calling `showMain()` and
  routing any `weft://` argument through `handleLink()`.
- `app.on("open-url", …)` is the macOS deep-link entry; in packaged builds the
  `weft` scheme is registered with `app.setAsDefaultProtocolClient("weft")`
  (`build.protocols` in `package.json`).
- `createMainWindow()` builds a hidden `BaseWindow` with `titleBarStyle:
  "hiddenInset"`, mounts a `WebContentsView` (`appView`) as its child, and reveals
  the window on `did-finish-load`. On macOS, `win.on("close", …)` hides instead of
  quits; `quitting` is set in `before-quit`, so ⌘Q actually closes.
- `createCopilot()` creates a second `BrowserWindow` (note: not a `BaseWindow` with a
  child view — it has its own webContents) that loads `${server.url}/copilot`. Same
  close-to-hide behavior so the conversation survives.
- `followThemeChoice()` runs before any window opens. It reads the board's
  `weft-theme` cookie (set from Settings → Appearance; see `lib/theme.ts`) from the
  default session and sets `nativeTheme.themeSource` to match (`electron/theme-source.cjs`: a scene follows
  its light or dark base; see docs/architecture/themes.md), then keeps watching
  the cookie. Window backgrounds, native menus, and the splash screen follow it.
- `COPILOT_SHORTCUT = "Control+Alt+Space"` is registered with `globalShortcut` at
  startup. If the OS refuses it, a warning is logged.
- The application menu, the context menu (`attachContextMenu`), the tray
  (`createTray` + `updateTray`), the dock menu and badge (`setupDock`,
  `refreshWaiting`), and the splash → main view transition (`boot`, with the splash's
  `startup.show`/`fail`/`loadBoard`/`watch` in `startup-screen.cjs`) are all in this file.
- `weft://` links (`handleLink`):
  - `weft://copilot` → `showCopilot()`
  - `weft://card/<id>` → `sendMenu("open-card", id)`
  - `weft://new?prompt=…&folder=…&title=…&cli=puku` → POSTs `/api/cards`
    (with `x-weft-token: 1`) and then opens the new card. `start=1` is
    ignored on purpose: the card is always created with `start: false` and
    the New Thread dialog opens pre-filled, so a clickjacked link can't
    fire a thread (L-3). The handler is in `electron/new-thread-link.cjs`
    (`createNewThreadLink`); main injects the dialog so the test can pass
    a mock. If `folder` is missing, the most recent project's path is
    read from `/api/settings` (falling back to `os.homedir()`).
- IPC handlers at the bottom: `browser:open` (url, card key; the handler only
  answers the board window's `webContents` — `e.sender === appView?.webContents`
  — so a compromised renderer can't navigate the pane to an arbitrary URL
  (L-5); per-card origin allowlists in `electron/pane-origins.cjs` further
  constrain where a thread can navigate: a host outside the card's list asks the user with Touch ID through
  `electron/touch-id.cjs`, and a yes adds it to the list), `browser:active`, `browser:prune`, `browser:state`, `browser:visible`,
  `browser:bounds`, `browser:back/forward/reload`, `copilot:toggle`,
  `dialog:openFolder`, `shell:openExternal` (http/https only), `shell:reveal` (opens an existing
  absolute folder in Finder), `menu:popup` (shows a native context menu from the items the board
  sends, see `lib/card-menu.ts`, and resolves to the picked item's id or null), `badge:set`, and
  `splash:action` (`retry` re-runs `boot()`; `logs` opens the logs folder; `quit`
  quits).
- `prewarm()` is not called from here — it's called by the Next server from
  `GET /api/cards` (`app/api/cards/route.ts`).

## `electron/server.cjs`

Supervises the Next server. Three run modes, decided by `app.isPackaged` and the
env var `WEFT_PROD`:

- **Dev** (`pnpm desktop`): `next dev -H 127.0.0.1 -p <port>` under
  `npm_node_execpath` (the same Node that ran `pnpm desktop`). Stdout and
  stderr are also written to the parent's stdout.
- **Start** (`pnpm app`): builds into `.next-app`, then runs `next start`, gated on
  `WEFT_PROD=1`.
- **Packaged standalone** (`pnpm dist`): the standalone build at
  `process.resourcesPath/server/server.js` is launched as `${name} Helper` (e.g.
  `Weft Helper`) — the helper binary inside `Weft Helper.app/Contents/MacOS/`,
  launched with `ELECTRON_RUN_AS_NODE=1` so it runs as plain Node. Falling back to
  `process.execPath` works too. `NODE_ENV=production`, `PORT=<port>`,
  `HOSTNAME=127.0.0.1`.

`startServer({ preferredPort, env, onStatus, onFatal })`:

- `pickPort(preferred)` returns `preferred` if it's free, else asks the kernel for
  one with `net.createServer().listen(0, "127.0.0.1")`.
- `waitForServer` polls `GET ${url}/api/cards` every 250ms with a 120s timeout.
- On exit, if the process wasn't stopped on purpose and wasn't replaced, the
  supervisor reads the tail of its log and classifies the failure. Two are
  recoverable and don't count toward the crash budget: a "Another next dev
  server is already running" error (a peer dev server in the same project —
  Next 16.4's project-wide guard rejects the new spawn; the supervisor kills
  the named PID and retries), and a "Module not found: Can't resolve 'X'" where
  `X` resolves to a file on disk (a stale Turbopack cache; the supervisor
  `rm -rf .next` and retries). Otherwise a crash timestamp is recorded; once
  `crashes.length > MAX_RESTARTS` (3) within `RESTART_WINDOW_MS` (2 minutes),
  `onFatal` fires (or `failStart` rejects before the first successful start).
  Otherwise it logs and `setTimeout(launch, 500)`. The recoverable classifier
  is in `electron/server.cjs` (`classifyTail`); the canonical pure version
  with tests is `lib/dev-server.ts`.
- The log is appended to `~/Library/Logs/Weft/server.log` (via
  `app.getPath("logs")`); files over `MAX_LOG_BYTES` (5 MB) are rotated to
  `server.log.old`. Returns `{ url, logPath, stop, restart }`.

## `electron/browser-pane.cjs`

A native `WebContentsView` overlaid on the board. Lazily created on first
`setVisible(true)` so the board's placeholder is shown until then.

- `state()` returns `{ visible, url, title, loading, canGoBack, canGoForward }`.
- `setBounds(rect)` clamps to non-negative integers; `layout()` only shows the
  view once a page has loaded.
- The view is a native sibling of the board's `WebContentsView`, so no DOM `z-index` can put a
  board menu over a page. The board keeps the page out of the way instead: a full-window overlay
  (a dialog, an image opened full size) hides it, while a local menu (the zoom menu, a card's mode
  picker) only makes the page step around the rectangle the menu covers (`lib/overlay.ts`,
  `lib/pane-clear.ts`).
- `setWindowOpenHandler` denies pop-ups and reopens them inside the same view. Links the
  board and the copilot window try to open in new windows are sent to this pane too.
- A focused page swallows keys the board never sees, so `before-input-event` replays a plain Escape
  into the board (which closes its newest layer via `useEscape`). Fullscreen pages keep it, and a
  modified Escape (Shift/Ctrl/Alt/⌘) is left to the page. The rule itself is
  `electron/pane-escape.cjs` (`escapeToReplay(input, { fullscreen })`), with a test beside it
  (`electron/pane-escape.test.ts`). Escape types nothing, so Chromium reports it as a `rawKeyDown`
  rather than a `keyDown`; the rule takes both, or the board never hears the key at all
  (docs/bug-fixes/044-escape-from-a-focused-page-in-the-browser-pane-never-reached-the-board.md).
  With nothing open in the board, the replayed Escape flips between board and list view
  (`lib/use-escape-view.ts`), and the board pops a toast naming the view it landed in
  (`components/ViewHint.tsx`).
- A page load takes keyboard focus, so `open()` gives it back to the board when the board had it, and
  `layout()` hands focus to the board when it hides a view that holds it. Otherwise no key (Escape
  included) reaches the board. `useEscape(..., { panel: true })` marks board panels (thread, browser,
  library), which close only after every dialog and menu.
- `normalizeUrl(raw)` accepts `https?/file/about:` schemes, prepends `http://` to
  bare `localhost`/`127.0.0.1`/`[::1]`, rejects other schemes, and prepends
  `https://` to bare hostnames.
- Agent-facing API is the control server (`startControlServer`): a plain
  `http.createServer` on `127.0.0.1` with routes
  `POST /browser/open`, `GET /browser/text`, `GET /browser/screenshot`,
  `POST /browser/click`, `POST /browser/type`. Every request is checked for
  `Authorization: Bearer <token>` (the same `TOKEN` from `main.cjs`); the URL +
  token are passed to the Next server as `WEFT_SHELL_URL` /
  `WEFT_SHELL_TOKEN`, where `lib/browser-tools.ts` reads them and wraps
  them as `mcp__browser__*` MCP tools (`open_url`, `read_page`, `screenshot`,
  `click`, `type_text`). The board itself drives the pane over IPC
  (`electron/preload.cjs`).
- The routes beyond `/browser/*` (account session, vault blanks, folder access, restart when idle,
  webhooks, Vercel and Supabase status for the copilot, board view) live in `electron/pane-routes.cjs`
  (`paneRoutes(deps)`), which `main.cjs` calls with getters because the vault, Vercel and Supabase
  are set up after the pane. It replaced a 25-line inline block in `main.cjs` (Extract Module),
  which is how its size cap went down.
- `POST /browser/url` returns the URL a card's page shows ("" with no page).
  `lib/show.ts` uses it, with `paneUrl()` / `openInPane()` in
  `lib/browser-tools.ts`, to keep the pane from being empty or stale: a working
  page when a card's turn starts with no page (a dimmed scene picked per card id by
  `backdropFor()` from `electron/assets/backdrop-*.jpg` plus the splash's own, with the
  card's ask), and a Haiku-written update page after a turn that opened nothing (never
  over a live `http` page).
- `electron/pane-pages.cjs` (`createPanePages(dataDir)`, held as `pages` in `browser-pane.cjs`) remembers
  each card's page in `~/.weft/pages/index.json`: every `did-navigate` calls `record()`, which stores
  `{ cardId, url, kind: file|app|web, title, updatedAt, savedUrl? }`. A `file:` page in a temp folder
  (macOS clears those) is copied to `pages/<card>/` and kept as `savedUrl` (20 MB cap). The index
  shape mirrors a future `card_pages` table for cloud sync.
- `setActive(key)` calls `restore(key)` when the card opens with a blank browser (after a restart):
  `restoreUrl()` gives the saved copy or the url, or (never recorded) the last
  `mcp__browser__open_url` in `threads/<card>.json`; if that fails to load, `fallbackUrl()` gives
  `~/.weft/show/<card>.html`. Nothing is restored at startup.
- `electron/pane-error.cjs` + `pane-error.html`: Chromium paints a failed main-frame load as a blank white page, so a
  stopped dev server left cards empty. `watchLoadFailures(wc, { back })` (wired where each card's view is made in
  `browser-pane.cjs`) catches `did-fail-load` and loads `pane-error.html` with everything in its query string:
  the failed `url`, a `title`/`hint` from `describeFailure()` (connection refused on localhost reads "Nothing is
  running at host"; also file gone, name not resolved, offline), the `reason`, `wait=1` for a local server and
  `back`, the card's last good page (`lastGoodPage`). The page offers **Try again** and **Back to the last page**
  and, with `wait`, polls the server every 2s and reloads when it answers. `ERR_ABORTED` (a load another load
  replaced) and a failed error page itself are ignored, so it can't loop. `failedUrl()` reads the failed URL back
  out of an error page: the toolbar shows it and `pages.record()` skips the error page, so it is never a card's
  saved page. The board's own view gets no `back`.

## `electron/preload.cjs`

The single `contextBridge.exposeInMainWorld("weft", …)` call. The UI's only
door into the shell: `browser.*` (open / state / setVisible / setBounds / back /
forward / reload / onState), `dialog.openFolder`, `openExternal`, `revealFolder`, `popupMenu`, `setBadge`,
`copilot.toggle` and `copilot.onState`, `onMenu`, and `splashAction` (only used by
the splash screen's retry/logs/quit buttons). Typed in `lib/client.ts` as
`ShellBridge`; when `window.weft` is absent the board is running in a normal
browser tab (`pnpm dev`).

## `electron/env.cjs`

`fixPath()` replaces `process.env.PATH` with the user's login-shell `PATH` (default
shell `$SHELL` or `/bin/zsh`, with `-ilc` to source rc files), then merges in the
existing `PATH`. Apps opened from Finder or Dock inherit a bare PATH
(`/usr/bin:/bin:…`) that doesn't contain `claude`, `puku-cli`, or nvm's `node`.

## `electron/window-state.cjs`

`loadWindowState(name, defaults)` reads `userData/<name>-window.json` (e.g.
`main-window.json`, `copilot-window.json`) and verifies the saved bounds are still
on a connected display (`onScreen` — at least 120×80px of overlap with a display's
`workArea`); otherwise returns the defaults. `trackWindowState(name, win)` saves
`{ x, y, width, height, maximized }` on resize/move (debounced 400ms) and close,
skipping the call when the window is destroyed/minimized/fullscreen.

## `electron/splash.html`

A static `file://` page that `appView` loads while the server starts. `setStatus()`
and `showError()` are called via `webContents.executeJavaScript()`. On a fatal
startup error, the splash shows an error line and three buttons wired to
`splashAction`: `retry` (re-runs `boot()` or calls `server.restart()`), `logs`
(`shell.openPath(app.getPath("logs"))`), `quit`.

`electron/startup-screen.cjs` (`createStartupScreen`) drives it: `show(status)` and `fail(message)` load the
splash if it isn't up and call `setStatus`/`showError` (`fail` also brings the window forward and names the server log);
`loadBoard(url)` loads the board and swallows a rejected load. `watch(webContents)` turns two failures that used to
leave a stuck splash or a blank window into `fail()`: the board's main frame failing to load (except ERR_ABORTED, a load
replaced by another one such as Fast Refresh's reload) and its renderer dying (any reason but a clean exit).
Tested against a fake window in `electron/startup-screen.test.ts`.

## Startup timer (`startup-timer.cjs`, `lib/use-startup-check.ts`)

Every launch is timed. `createStartupTimer()` is created at the top of `main.cjs`; `mark(name)` records ms since the
process started at each phase (`ready` Electron start, `path` login shell PATH, `port` freeing the port, `server`
server start, `page` board page load), and the board finishes the run with the `board` mark (its first cards are on
screen) through `startup:ready` (`weft.startupReady()` in the preload). `finish()` appends the run to
`~/.weft/startup.jsonl` (the last 50) and returns a verdict: the total, the median of the last 10 launches in the
same mode (null until there are 3), the slowest phase, and `slow`. Slow means over 1.5x the usual time and at least
2s over it. `lib/use-startup-check.ts` shows a toast naming the slowest phase when `slow` is true. List recent
launches with `node electron/startup-timer.cjs`.

Two things keep a launch short, both measured with this timer:
- `env.cjs` `fixPath()` applies the PATH saved in `~/.weft/shell-path` at once and asks the login shell (`zsh -ilc`,
  about a second) in the background for the next launch; with no saved PATH it waits for the shell as before.
- `free-port.cjs` deletes the build folder only when a stale server held the port, so Turbopack's cache in
  `.next/dev/cache` survives a normal launch.

Lazy-loading Board's panels was tried and backed out: under the same load the board page was slower (4.5-4.9s against
3.8s).

Tested in `electron/startup-timer.test.ts`, `electron/env.test.ts` and `lib/use-startup-check.test.ts`.

## About window (`about.cjs`, `about.html`, `about.js`, `about-preload.cjs`)

Weft ▸ About Weft (the app menu on macOS, the bottom of Help elsewhere) opens the shell's own
window instead of the native panel, which can only show text. `showAboutWindow()` keeps one
instance and focuses it if it is already open. The page is a bundled `file://` file with a
`script-src 'self'` CSP, so it opens even when the server is down. It is a sandboxed,
fixed-size window on its own `about` session, and navigation and `window.open` are denied.
`about.js` renders everything with `textContent`.

`registerAboutBridge({ tagline, dataDir, getServer })` (called from `app.whenReady`) answers three
`weft-about:*` ipc channels, each checking that the caller is the About window:
- `info`: version, arch, packaged or not, Electron/Chromium/Node versions, data folder, the app's
  PID, and the server's port and PID from `server.port` / `server.pid`.
- `open`: `"data"` or `"logs"` only; the page never passes a path.
- `copy`: writes the page's plain-text twin to the clipboard (capped at 20k characters).

`server.cjs` exposes `port` and a `pid` getter (the current supervised process; it changes on
restart). In dev that PID is `next dev`'s launcher, not necessarily the process holding the port.

## Dev wrapper (`scripts/dev-protocol.cjs`)

`pnpm desktop` first makes `~/Applications/Weft Dev.app`, a wrapper that declares `weft://` and re-launches
the dev Electron on this folder. It warns when the checkout is in Desktop, Documents or Downloads, and the
wrapper reads `package.json` before launching so a macOS folder-permission refusal shows a dialog that says
to move the folder, not Electron's bare EPERM (docs/bug-fixes/019-desktop-checkout-eperm-on-macos-protected-folder.md).

## Packaging

`package.json`'s `build` block drives `electron-builder`:

- `appId: app.weft.desktop`, `productName: Weft`, `output: dist`,
  `buildResources: build`.
- `files: ["electron/**/*", "package.json", "!node_modules${/*}", …]` — the Electron
  app bundles only the shell + `package.json`. The Next server is shipped under
  `extraResources`.
- **`!node_modules${/*}` drops the whole top-level `node_modules`**, so every package
  Electron main requires at runtime has to be named explicitly after it, or the packaged
  app dies on launch with "Cannot find module" before a window opens (2026-10-28: the shared
  vault added `electron/account-client.cjs`, which requires `@supabase/supabase-js`; it was in
  `package.json`'s dependencies and in the Next server's standalone bundle, but not on this
  list, so every shipped build crashed on launch — docs/bug-fixes/047-packaged-app-could-not-find-the-supabase-client.md).
- **The package list is derived, not hand-kept.** `scripts/electron-runtime-deps.mjs` computes the
  closure of packages Electron main needs at runtime — the bare `require()`s out of `electron/*.cjs`,
  then the runtime requires out of each package it finds, transitively — and `--write` puts the
  result into `build.files`. `pnpm dist` runs it before electron-builder, so a new `require()`
  ships with its package. Two details make the closure right: both the CommonJS and the ESM entry
  are read (a package's `main` can vendor a dependency its `module` build imports — realtime-js's
  `dist/main` vendors its own phoenix, its `dist/module` imports `@supabase/phoenix`), and only
  packages Weft has installed count, so optional peers don't drag in React Native.
  `electron/packaged-deps.test.ts` fails if `build.files` drifts from the closure.
- **`scripts/verify-packaged-app.cjs` checks the built app.** It reads the archive itself — a
  package counts as shipped only if `app.asar` holds it, never by resolving from the repo's
  `node_modules`, which has everything and would hide a broken build — and then loads the
  packaged `account-client.cjs` out of the archive and builds a Supabase client from it. `pnpm dist`
  runs it at the end, so a build that would crash on launch fails the build instead.
- **The toolchain ships pnpm and npm** under `Contents/Resources/toolchain` (see below), so a fresh
  Mac with no Node can install a project's dependencies. `scripts/verify-packaged-toolchain.cjs`
  checks the bundled pnpm runs, matches `packageManager` in `package.json`, and can install.
- `extraResources` copies `.next-dist/standalone` to `server/` and, separately,
  `.next-dist/standalone/node_modules` to `server/node_modules`, because electron-builder
  drops the top-level `node_modules` of a copied folder.
- `protocols: [{ name: "Weft", schemes: ["weft"] }]` registers the deep-link
  scheme. `mac.target: dir`, `arch: arm64`, `category:
  public.app-category.developer-tools`, `identity: null`, `hardenedRuntime: false`,
  `NSAppleEventsUsageDescription: "Weft opens Terminal to run a command-line
  tool's login when it needs a real terminal."` (used by the AppleScript in
  `lib/login.ts`).

### The app checks its own bundle (`electron/runtime-deps.cjs`)

The derivation and the build-time verification catch a missing package before it ships. They can't
catch a bundle that arrives broken another way — an interrupted install, a half-copied update — so
the app checks itself at boot, before anything needs the packages.

`checkRuntimeDeps()` resolves each package Electron main requires, from Electron main's own
directory: inside `app.asar` that means the package is in the archive. A package that resolves but
won't load (a pruned native build) is caught too, by requiring it. When something is missing, the
app shows the splash's error state with the package named and "Reinstall Weft to repair it", instead
of dying on a require with a native "A JavaScript error occurred in the main process" dialog.

The require itself is **lazy** for the same reason: `electron/account-client.cjs` requires
`@supabase/supabase-js` when the client is first built, not when the module loads, so a bundle
missing it still opens a window and can say so.

### The toolchain's trees are installed after an update (`electron/toolchain-install.cjs`)

What an auto-update brings down (Squirrel.Mac replaces the whole `.app` bundle):

| Tree | How it ships | Needs an install? |
| --- | --- | --- |
| `app.asar` | Electron main's packages, in the derived allow-list | No — already installed |
| `Resources/server` | The Next standalone bundle | No — already installed |
| `Resources/toolchain/pnpm` | A self-contained pnpm | No |
| `Resources/toolchain/npm` | npm plus its own `node_modules` | No |
| `Resources/toolchain/puku` | puku-cli's tree, installed at build time | **Yes** |

The puku tree is the one gap: `scripts/bundle-toolchain.mjs` installs it from a caret range with no
lockfile, then prunes packages out of it (telemetry, other platforms' native builds). A build that
pruned too much leaves a tree that looks installed and isn't.

So after an update, the app runs `pnpm install` against that tree. **Not** against the app's own
packages: those are inside the asar, already installed, and a `pnpm install` next to an asar would
write a `node_modules` folder the app never reads.

The app knows an update landed by the version changing since the last launch
(`electron/updated-since.cjs`: the version is written to `~/.weft/updated-version`, and a launch
whose version differs had a new bundle). The install runs in the background — the board never waits
for it — and the version is recorded when it finishes. On an ordinary relaunch nothing is installed;
the tree is only checked.

**Folder access.** macOS (TCC) refuses `~/Downloads`, `~/Documents` and `~/Desktop` to a process that was never
allowed, and every thread's tools run as children of Weft, so Weft's grant covers them. Weft never asks on launch:
a thread that gets "Operation not permitted" (or is told to use files there) calls `mcp__board__request_folder_access`
(`lib/folder-access-tool.ts`, in every thread's board tools, no permission prompt since it only asks the user), which
posts to the control server's `/folder-access/ask`. `electron/folder-access.cjs` lists the folder, which is what makes
macOS show its own prompt the first time. If the answer is already No (`EPERM`/`EACCES`) macOS won't ask again, so a
dialog explains it and **Open Settings** opens `Privacy_FilesAndFolders`; the tool tells the thread which button the user
took (and to retry after a restart). The packaged app's Info.plist carries `NSDownloadsFolderUsageDescription`; the dev
Electron binary has none, so its prompt has no purpose line.
Dev Weft is ad-hoc signed `Electron.app`, so macOS ties a Full Disk Access or Files and Folders grant to that exact
binary's hash: after Electron is updated or reinstalled the Settings list still shows "Electron" switched on, but the
grant no longer matches and reads of a protected folder get `Operation not permitted` (seen 2026-10-17: Desktop and
Documents read fine, Downloads didn't). Remove the Electron entry with **−**, add `node_modules/electron/dist/Electron.app`
again with **+**, and relaunch Weft. The "Weft" entries are the `~/Applications/Weft.app` launcher, a different app.

`pnpm dist` runs `WEFT_DIST=.next-dist WEFT_STANDALONE=1 next
build && node scripts/prepare-standalone.mjs .next-dist && electron-builder --mac
--dir`. The build flow:

1. `next build` with `output: "standalone"` (`next.config.ts` sets it when
   `WEFT_STANDALONE=1`) produces `.next-dist/standalone/`. Tracing pulls in the whole
   project, because `lib/login.ts` spawns CLIs by a computed path, which Next can't trace
   narrowly; the prepare script prunes the extras.
2. `scripts/prepare-standalone.mjs`:
   - Prunes `standalone/` to the set `{ server.js, package.json, node_modules,
     public, <distDir> }`.
   - Copies `<distDir>/static` into `standalone/<distDir>/static` and
     `public/` into `standalone/public`.
   - Ensures `@anthropic-ai/claude-agent-sdk` and the platform package
     (`@anthropic-ai/claude-agent-sdk-<platform>-<arch>`) are present in
     `standalone/node_modules` (tracing can miss them), `chmod 0o755` the
     `claude` native binary, and `claude --version`s it to confirm.
   - Walks the standalone folder, replacing any symlink that points outside
     it with a copy of its target (the app is copied around at install time,
     so dangling or external symlinks break).
3. `electron-builder --mac --dir` lays out `Weft.app/Contents/Resources/server/`
   and `Weft.app/Contents/Frameworks/Weft Helper.app/...` from the prepared
   standalone and the shell.

The server in packaged builds is launched as `Weft Helper` (Electron's helper binary, with
`ELECTRON_RUN_AS_NODE=1`) instead of the main `Weft` executable. Started from the main
executable, macOS saw a second app named Weft, and quitting by name (`osascript -e 'quit app
"Weft"'`) went to the wrong one; as a helper it doesn't register as an app.

## Right-click menus

The board's card and column menus are native, so the narrow board never clips them.
`lib/card-menu.ts` builds them as plain data (`cardMenu`, `columnMenu`; flat, no submenus, tested in
`lib/card-menu.test.ts`); `components/use-board-menus.ts` passes them to `weft.popupMenu` and runs
the picked id through the board's own move, archive, open and API calls. In a plain browser tab there is
no shell, so the browser's own menu shows.

The `menu:popup` IPC handler itself lives in `electron/main-menu-popup.cjs` (`createMenuPopup`).
It builds a one-off `Menu` from the items the board sends, pops it up on the sender window, and
resolves to the picked id or `null`. `Menu` and `BrowserWindow` are injected so the test file can
pass mocks without a real Electron; the `setTimeout` in the popup's callback waits a tick for the
`click` handler to set `picked`, since the click fires before the callback on macOS but not on every
platform. `electron/main.cjs` calls `createMenuPopup({ ipcMain, Menu, BrowserWindow })` once at
startup.
