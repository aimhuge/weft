# Agent browser

Status: built 2026-10-26.

The browser pane is where you're logged in and where you watch, so it's where agents should browse. Until now a
thread could open a page, read its text, screenshot it, and click or type by CSS selector, with the click sent as
`element.click()` from a script. That missed menus that open on `pointerdown`, handlers that check `isTrusted`, and
everything a person does with the keyboard, and the agent had no way to see a page's console or its failed requests.
Now each pane page has one Chrome DevTools Protocol session, and the thread's tools drive the page through it the way
Playwright drives a browser, in the pane you can see.

## The tools

`lib/browser-act-tools.ts`, spread into `browserMcpServer()` (`lib/browser-tools.ts`) next to `open_url`, `read_page`
and `screenshot`. Every thread gets them (Claude Code and puku in-process, Codex through the MCP bridge).

| Tool | Route | What it does |
| --- | --- | --- |
| `snapshot` | `POST /browser/snapshot` | `Accessibility.getFullAXTree` as an outline, one element per line, with a `ref` on everything actionable |
| `click` (`ref` / `selector`, `double`) | `POST /browser/click` | scrolls it to the middle, hit-tests the centre, then a trusted `Input.dispatchMouseEvent` press and release |
| `hover` | `POST /browser/hover` | a trusted `mouseMoved` at the centre |
| `type_text` (`text`, `submit`) | `POST /browser/type` | focuses the field, selects what's in it, `Input.insertText`; `submit` presses Enter |
| `press_key` (`keys`) | `POST /browser/press` | `"Enter"`, `"Shift+Tab"`, `"Meta+a"`… as an `Input.dispatchKeyEvent` down/up pair (`electron/pane-keys.cjs`) |
| `select_option` (`values`) | `POST /browser/select` | picks `<select>` options by value or label, fires `input` and `change` |
| `scroll` (`direction`, `amount`) | `POST /browser/scroll` | a `mouseWheel` at the viewport (or element) centre, so the box under it scrolls; with only a target, scrolls it into view |
| `wait_for` (`text` / `gone` / `selector`, `timeout_ms`) | `POST /browser/wait` | polls every 150 ms, up to 30 s |
| `set_viewport` (`phone` / `tablet` / `desktop`, or `width`+`height`) | `POST /browser/viewport` | `Emulation.setDeviceMetricsOverride`, plus touch for phone and tablet |
| `console_logs` (`level`) | `POST /browser/console` | console messages and uncaught errors since the page loaded |
| `network_errors` | `POST /browser/network` | requests that failed or got a 4xx/5xx since the page loaded |

`BROWSER_PROMPT` tells threads the workflow: snapshot, act by ref, `wait_for`, and read the logs before guessing.

### Refs

A ref is `e` + the node's `backendDOMNodeId`. Chrome keeps that id for as long as the element is in the document, so a
ref from one snapshot still works three clicks later, and there's no selector to guess. `DOM.resolveNode` turns it
back into the element; a ref whose element is gone says "take a new snapshot". The outline (`electron/pane-ax.cjs`)
skips Chrome's wrapper roles (`generic`, `paragraph`, `LabelText`…) unless they have a name, doesn't repeat a button's
label as text under it, prints a field's value on the field's line, and stops at 800 lines or 30,000 characters.
Password fields come out of Chrome already masked.

## How it works

- **One session per page** (`electron/pane-cdp.cjs`). `createBrowserPane()` attaches `webContents.debugger` as it
  creates each card's view, before the first load, so messages from the start of the page are caught. The
  `Runtime`/`Log`/`Network` enables are sent without waiting: a view that hasn't navigated yet doesn't answer them
  until it does (found the hard way, by a prototype that hung). Electron allows one debugger client per webContents, so
  anything else that needs CDP (the screencast recording card) uses this module's `send()` instead of attaching again.
- **DevTools.** Opening DevTools on a pane page detaches the session. The next tool call attaches again, or says
  "close DevTools" while they're open.
- **Buffers.** Per page, the last 200 console entries and 200 failed requests, cleared on each full navigation.
  Electron's own dev-mode warnings (frames under `node:electron/`) and requests the page cancelled are left out.
  Network bodies aren't buffered (`maxTotalBufferSize: 0`).
- **Trusted input** (`electron/pane-input.cjs`). Every action is a fixed page function run with
  `Runtime.callFunctionOn` on the element, then `Input.dispatch*` events in CSS pixels, so page zoom needs no maths
  (checked at 150%). A click whose centre is covered by something else (a modal, a cookie banner) is refused, naming
  what's on top. A label on top of its own input counts as the input. Each click leaves a short orange ripple where it
  landed, so you can watch the agent work. Every remote object an operation makes is in one object group, released
  when the route answers.
- **macOS shortcuts.** Chrome on the Mac doesn't run editing shortcuts from synthetic keys, so `Meta+a/c/x/v/z` are
  sent with CDP's `commands` (`selectAll`, `copy`…).

## What guards it

The routes sit on the pane's token-guarded control server like the rest of `/browser/*`. There's still no route for
arbitrary JavaScript: each operation is a fixed script with its arguments JSON-encoded in. Navigation stays behind
the per-card origin allowlist and Touch ID (`electron/pane-origins.cjs`). Snapshot text, titles, console text and
failed-request URLs go through `paneSecrets.redact`, so a vault value a thread typed into the page reads back as
`‹NAME›`. The vault's own fill still uses `electron/pane-actions.cjs` `typeText`.

## Tested

`electron/pane-ax.test.ts`, `pane-keys.test.ts`, `pane-cdp.test.ts` and `pane-input.test.ts` run against fakes. The
CDP calls themselves were checked end to end in Electron 44 against a test page: a trusted `pointerdown` menu, typing
and Enter submitting a form, select, Escape, wait, wheel scroll, phone viewport, console and a 404, a covered button
refused, stale refs, and a click at 150% zoom.

## Next

- **Who's driving**: an outline on the pane while an agent acts, and agent input paused while you type.
- **`upload_file`** (`DOM.setFileInputFiles`), once paths go through `lib/secret-guard.ts` so a thread can't upload
  what it isn't allowed to read.
- **Viewport in the toolbar**: the phone/tablet switch for you, not just agents.
- **Iframes**: `getFullAXTree` covers the main frame only.
- **Recording and background browsing**: the "🎥 Record agent browser sessions" card, on this session.
