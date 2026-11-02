# The worker's browser

Status: built 2026-11-02 (parity package T4). Not yet run on a real worker or watched from Electron's board.

A card on a Weft Worker used to have one browser tool: `open_url`, which uploads a page it wrote. Every other tool threw,
because `lib/browser-shell.ts` reaches Electron main and a worker has none. Now a worker runs its own headless Chromium,
and a worker card's thread drives it with the same tools, the same routes and the same CDP code a desktop card's pane
uses ([agent-browser.md](agent-browser.md)). The user watches it live in the card's pane and can click it.

```
thread ─ mcp__browser__click ─ lib/browser-act-tools.ts ─ shell("/browser/click")      (unchanged)
                                                    │ WEFT_WORKER=1, no WEFT_SHELL_URL
                                                    ▼
lib/worker-browser-routes.ts   the same routes and answers as electron/browser-pane.cjs + pane-input.cjs agentRoutes
  │ electron/pane-cdp.cjs, pane-input.cjs, pane-ax.cjs, pane-selector.cjs   (the desktop's own code, unchanged)
  ▼
lib/worker-browser-page.ts     a webContents-shaped adapter over one page's flattened CDP session
lib/worker-browser.ts          one Chromium, a browser context per card, the file guard, idle shutdown
lib/worker-chromium.ts         find, launch (--remote-debugging-pipe), and the pipe's CDP framing
```

## The tools

All of `mcp__browser__*` except `fill_field`: `open_url`, `read_page`, `screenshot` (with `highlight` and `save_to`),
`snapshot` with refs, `click`, `hover`, `type_text`, `press_key`, `select_option`, `scroll`, `wait_for`, `set_viewport`,
`console_logs`, `network_errors`. `browser-tools.ts` and `browser-act-tools.ts` didn't change: `shell()` sends a
`/browser/*` route to `workerShell` (`lib/worker-browser-routes.ts`) when it runs on a worker with no shell URL.

- **The same code as the pane.** pane-input's `agentRoutes`, pane-cdp's console and network buffers, the AX outline and
  its refs, the selector compiler with Playwright's text pseudo-classes and the key combos all run unchanged. They take an
  Electron `webContents`; `browserPage` gives them one: `debugger.sendCommand` is the page's CDP session,
  `did-navigate` is the main frame's `Page.frameNavigated`, `isLoading` follows its start and stop.
- **`open_url`** (`lib/worker-pane.ts`): a page the card wrote still uploads as before, so the pane, weft.zip and share
  links show it as itself, and it also opens in the worker's browser so `read_page` and `click` act on it. A public
  site or this box's own dev server (`http://localhost:3000`) opens in the browser and the pane shows it live. A site
  still shows as itself when the browser can't start; a dev server has no other way, so the agent gets the reason.
- **One page per card.** A context per card (`Target.createBrowserContext`), so cards share no cookies or storage. `new_tab`
  is ignored, and a popup (`window.open`, `target=_blank`) is closed as it opens.
- **A card, always.** A call with no card id (a spare thread not yet given one) is refused, never served from a page
  every card-less caller would share; so is pane input with no card. A DevTools call unanswered in 60 s fails
  (`CALL_MS`), so a hung page can't hang a tool call.
- **Lifetime.** Chromium starts on a card's first browser tool. A card's context closes after 10 minutes with no tool
  call and no live view, and Chromium with the last one. Its profile is a temp folder, removed when it exits.
- **`fill_field` stays desktop-only.** It types vault values, and a worker has no vault and no Touch ID; the route
  refuses by name (`FILL_REFUSAL`). `read_page` and the rest redact nothing on a worker for the same reason: no value can
  have been typed.

## What guards it

- **No port.** Chromium is driven over `--remote-debugging-pipe`, never `--remote-debugging-port`: a port on 127.0.0.1
  would let anything on the box, a thread's own `curl` included, drive the browser past the guard below.
- **Files** (`lib/worker-browser-guard.ts`). `Fetch.enable` pauses every `file://` request on the card's page session and
  on every out-of-process frame it auto-attaches (they start paused, so the guard is in before they load; a frame whose guard fails to go in stays paused and blank rather than load unguarded). A file goes
  through only when `workerMayUpload` would let it leave the box anyway (a web file in the show folder or a checkout, no
  dot folder, links followed: `lib/worker-blobs.ts`) and `isSecretFile` doesn't know it (`lib/secret-guard-files.ts`).
  So `worker.json`, `worker.env`, the seal key, a symlink in `show/` to any of them, and a page's `<iframe>` or link to
  them all fail with `net::ERR_ACCESS_DENIED`; `open_url` refuses them before Chromium sees them.
- **Schemes.** http, https and ws go through: localhost is the point, the box's own dev servers. `about:blank`, `data:`,
  `blob:` and the error page are what a page makes for itself. `chrome://`, `view-source:`, `devtools:` and anything else
  are refused. Downloads are denied (`Browser.setDownloadBehavior`, browser-wide and again for each card's context, which the browser-wide setting doesn't cover).
- **Input from the pane** comes only through what already guards the simulator: the relay's elevated `input` command
  with the card's own-card check, or the session line's `input:<device>:<nonce>` channel, which needs a card of this
  worker's own watching that device (`lib/host-line-screen.ts`).

## The live view

`lib/worker-browser-screen.ts`. Any route that changes the page (`click`, `hover`, `type`, `press`, `select`, `scroll`,
`viewport`, and `open` of anything but a file) starts or extends the card's live view for 10 minutes and puts it in
`card.page` as `weft-screen:<token>?device=browser-<16 hex>&name=Browser&fast=1`. The device id is the card's id hashed,
so it passes the line's channel label (`[A-Za-z0-9-]{1,64}`) and `isBrowserScreen` (`lib/host-line-protocol.ts`) tells
the board it's a browser.

```
Page.startScreencast (JPEG q70, ≤1280 px, a frame on each repaint, each acked)
  ├─▶ Realtime worker-screen:<token>  { jpg }, ≤4/s + one every 3 s  ─▶ WorkerScreen <img>   (either board, unchanged)
  │     ◀── input command: tap = a click, swipe = a wheel, watch = Resume  (lib/worker-screen's path, browserInput)
  └─▶ session line, input:<device>:<nonce> channel: every frame, 4-byte length + JPEG in 16 KB chunks (sendFrame)
        ─▶ lib/use-line-frames.ts frameReader ─▶ createImageBitmap ─▶ WorkerScreen <canvas>
        ◀── the same channel: down/move/up as mouse events, keys as HID usages (lib/worker-browser-keys.ts)
```

- **Why JPEG, not an RTP track.** A headless Chromium hands out its screen as JPEG or PNG frames (CDP screencast); H.264
  would need an encoder on the box. The session line already carries the simulator's length-prefixed frames on a
  channel, so the browser rides the same framing on its input channel and the board draws it on the canvas WorkerScreen
  already has. `useScreenVideo` sends a browser device to `useLineFrames` instead of the H.264 m-line, never to the
  screen's own line, and the pane hides the video quality menu for it.
- **Pace.** The screencast only sends a frame when the page repaints, so a still page costs nothing on the line; the
  Realtime topic gets at most 4 a second plus one every 3 s for a board that just opened, like the simulator. A line
  viewer more than 1 MB behind skips frames.
- **Taps land** at the fraction of the frame's CSS size (the screencast's `deviceWidth`/`deviceHeight`), so they stay
  right under `set_viewport phone`.
- **Wiring** (`scripts/weft-worker.ts`): the browser screen joins the Realtime opener the simulator uses, the line's
  `screen` and `watcher` look up a browser device first, and the daemon's `input` sends a browser device to
  `browserInput`.

## Installing Chromium

`install/worker.sh` downloads Chrome for Testing's `chrome-headless-shell` 156.0.8078.80 into `~/.weft/tools/chromium`
for mac-arm64, mac-x64 or linux64, pinned by the zip's SHA-256 (the release publishes no digest). A failure only skips
it. `findChromium` (`lib/worker-chromium.ts`) looks in order at `WEFT_CHROMIUM`, that folder, Playwright's cached
`chromium_headless_shell-*` builds (newest first), then the system's Chrome or Chromium; with none, the tools say how to
get one. As root on Linux, or where AppArmor/sysctl blocks unprivileged user namespaces (Ubuntu 24.04, GitHub runners), it adds `--no-sandbox`. An enrolled box gets it with `weft-worker update`, which reruns the
script; an auto-update doesn't.

## Tested

`lib/worker-browser.real.test.ts` runs a real headless Chromium (skipped, saying why, when the machine has none): a
localhost page opened and read; snapshot refs; a trusted `pointerdown` menu clicked by ref; typing, Enter submitting a
form, select, Tab; wheel scroll; phone viewport; a screenshot with a highlight; the page's `console.error` and a 404;
screencast JPEG frames; a tap from the pane clicking the menu, a swipe scrolling; live keys over a line channel typing
"Hi" with Shift; a show-folder page whose `<iframe>` of `worker.json` is denied; `worker.json`, a symlink to it and
`chrome://settings` refused; two cards' contexts kept apart. It passed against Playwright's chrome-headless-shell 1228
and the pinned 156.0.8078.80 (mac-arm64). The rest is unit tests over a fake CDP: `worker-chromium`, `worker-browser`,
`-page`, `-guard`, `-keys`, `-screen`, `-routes`, `use-line-frames`.

## Next

- Run it on m1mini and a Linux box, and watch it from Electron's board over a real session line.
- Paste and wheel from the pane (the board sends neither yet), and a cursor on the canvas.
- An H.264 track where the box has an encoder, for smoother video than JPEG.
- `upload_file`, tabs, and iframes in the snapshot, as on the desktop.
