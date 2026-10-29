# Board view

Status: built 2026-10-12.

A thread that changes the board (a drawer, a dialog, a card) used to be able to test it only in jsdom: the browser
pane is a separate browser with no `window.weft` bridge (so the 🔐 drawer there just says it "lives in the
desktop app"), and the main window has no debug port. `mcp__board_view__*` gives threads eyes and hands on the real
board window (`appView` in `electron/main.cjs`).

## The tools

`lib/board-view-tools.ts` (threads only, not the copilot; trusted like `mcp__browser__*`, so no permission prompt):

| Tool | Route | What it does |
| --- | --- | --- |
| `screenshot` (`save_to`, `highlight`) | `POST /board-view/screenshot` | `webContents.capturePage()` of the board, optional orange box around a selector |
| `click` (`selector`) | `POST /board-view/click` | a real, trusted mouse event at the element's middle (times the zoom) |
| `hover` (`selector`) | `POST /board-view/hover` | a real `mouseMove` input event at the element's middle (times the zoom), so CSS `:hover` and `mouseenter` fire |
| `type_text` (`selector`, `text`) | `POST /board-view/type` | focuses an input, textarea or contenteditable, selects its contents, `insertText` |
| `read` (`selector?`) | `POST /board-view/read` | `innerText` of the element, or the whole page, 30,000 characters at most |

It's the user's live window: every click lands in front of them, and a hover moves what the board thinks the mouse
is over. A minimized or hidden window captures empty, which the tool reports as an error.

## How it's guarded

- **Token.** The routes sit on the browser pane's control server (127.0.0.1, random port). Its front door,
  `electron/control-server.cjs`, wants the launch's bearer token on every request (compared in constant time) and runs
  only routes in its table; anything else is 401 or 404. The token reaches the Next server as a 0600 file threads
  can't read (`electron/shell-token.cjs`, `lib/secret-guard.ts`).
- **Allowlist.** `electron/board-view.cjs` has exactly five operations (`OPERATIONS`). Each runs a fixed page script
  (`scripts`) with its selector passed through `JSON.stringify`, so a selector is always a string literal, never code.
  There is no route that takes JavaScript. A selector may also carry Playwright's text pseudo-classes
  (`:text-is("Settings…")`), which the same compiler the browser pane uses (`electron/pane-selector.cjs`) matches by
  reading text.
- **Secrets.** The vault's reveal and copy already need Touch ID in main (docs/architecture/secrets.md). On top:
  - Elements marked `data-secret` (a revealed value in `components/SecretRow.tsx`, the value field in
    `components/VaultParts.tsx`) read as `‹secret›`: reading one gives only that, and any text that contains a
    data-secret element's value has the value cut out, wherever it shows up on the page.
  - Screenshots insert CSS for the length of the capture that turns data-secret text transparent and hatches the
    block (`BLANK_SECRETS_CSS`), then remove it.
  - Controls marked `data-secret-action` (the row's reveal 👁 and copy buttons) can't be clicked from here, so a
    thread can't trigger a reveal or put a value on the clipboard (where `pbpaste` could read it). Right-click
    menus are native and out of reach: a click is a mouse event at a point on the page, so it opens a menu
    rather than choosing one of its items.
  - `type_text` only types into fields, so it can't send Enter or Space to a reveal button.
  - Anything inside `data-human-only` (the permission panel, the reply box while a question waits, the mode picker,
    Settings) can be read and screenshotted but not clicked or typed into: a thread there would approve its own
    prompts or loosen its own limits (pentest 2026-10-20, P-1). The gate is the marker in the page plus a
    `data-human-only` hit on the element, and the click itself is a real, trusted mouse event (below), so a
    handler that gates on `event.isTrusted` can't be fooled either.
- **A click lands where it was aimed.** The page script returns the element's centre and main sends the mouse event
  at that point, so the click is trusted (an `Element.click()` from `executeJavaScript` is not, and a handler
  gating on `event.isTrusted` would let it through). Before sending, the script hit-tests that point with
  `document.elementFromPoint` and refuses unless the element there is the one selected or one of its descendants —
  otherwise a tooltip, popover or layered button sitting on top would receive a trusted click the selector never
  named. The refusal says "Something is on top of <selector> at its centre; ask the user to close it or click it
  themselves" (`covered()` in `electron/board-view.cjs`).

When you add UI that shows a secret value, mark it `data-secret`; a control that reveals or copies one,
`data-secret-action`; a control that answers a permission, grants access or changes settings, `data-human-only`.

## Tests

`electron/control-server.test.ts` (token check, route table), `electron/board-view.test.ts` (the allowlist, a
selector that tries to break out of its string, redaction, refused clicks, every operation against happy-dom),
`lib/board-view-tools.test.ts`, and `components/VaultDrawer.test.tsx` (the markers are on the drawer).

## Not built

Scroll, key presses and waiting for an element; a "Weft is being driven" indicator; pausing agent actions while you
use the board.
