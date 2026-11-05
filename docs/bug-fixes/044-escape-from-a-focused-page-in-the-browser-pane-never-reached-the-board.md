# 044: Escape from a focused page in the browser pane never reached the board

**Date:** 2026-10-27 · **Severity:** Medium (no crash; Escape was simply dead while a page in the
browser pane had the keyboard focus, so the board's bottom layer — the flip between the column view
and the list view — could not be reached from inside a page)

## Symptom

With a page loaded in the browser pane and the page holding the keyboard focus, pressing Escape did
nothing at all. The board never heard the key, so nothing closed and the board/list view did not
flip. Escape worked everywhere else on the board: on a card, on the New thread dialog, on the
browser pane itself when the page was not focused.

The flip is the bottom Escape layer (`lib/use-escape-view.ts`): with no thread, no dialog, no
browser and no closable drawer up, Escape swaps the column view for the list view. From inside a
page in the pane, that last resort was unreachable.

## Root cause

**The page's Escape was swallowed, and the replay dropped it.** A page in the browser pane is a
native `WebContentsView` with its own focus, so a key pressed there never reaches the board's
DOM. The pane has always replayed a plain Escape into the board for exactly this reason
(`electron/browser-pane.cjs`, `before-input-event`), so the board can close its newest layer.

The replay matched one input type:

```js
// before — electron/browser-pane.cjs
wc.on("before-input-event", (_e, input) => {
  if (input.type !== "keyDown") return;
  if (input.key !== "Escape") return;
  ...
});
```

But **Escape types nothing**, so Chromium reports it as a `rawKeyDown`, not a `keyDown`. The
replay threw that event away, and the board never heard the key at all. The key was neither
delivered to the page nor replayed into the board — it simply disappeared at the pane's edge.

## Fix

**The rule that decides what the pane replays now lives in its own module, and it takes the
`rawKeyDown` too.** `electron/pane-escape.cjs` is a pure function with a test beside it
(`electron/pane-escape.test.ts`), so the rule is checked without a window:

```js
// after — electron/pane-escape.cjs
function escapeToReplay(input, { fullscreen = false } = {}) {
  if (input.type !== "keyDown" && input.type !== "rawKeyDown") return null;
  if (input.key !== "Escape" || fullscreen) return null;
  if (input.shift || input.control || input.alt || input.meta) return null;
  return { type: "keyDown", keyCode: "Escape" };
}
```

- `electron/browser-pane.cjs` calls it (`const { escapeToReplay } = require("./pane-escape.cjs")`)
  and replays the result into the board's `webContents`, with the matching `keyUp`.
- The replayed Escape now reaches the board's bottom layer, so with nothing else open it flips
  between the column view and the list view, and the board pops the toast naming the view it
  landed in (`components/ViewHint.tsx`).

The rule stays narrow on purpose: a `keyUp` is not replayed, a fullscreen page keeps Escape (a
fullscreen video needs it to leave fullscreen), and a modified Escape (Shift/Ctrl/Alt/⌘) is left
to the page, so the page's own shortcuts still work.

## Key rule

**A key that types nothing arrives as a `rawKeyDown`.** Any handler that matches a key by its
input type has to take that type too, or the key is lost between the page and the board.

## Files involved

- `electron/pane-escape.cjs` — the rule that decides which key the pane replays into the board
- `electron/pane-escape.test.ts` — the rule's tests, including the `rawKeyDown` case
- `electron/browser-pane.cjs` — calls the rule and replays the Escape into the board
- `lib/use-escape-view.ts` — the board's bottom Escape layer, the one that flips the view
- `components/ViewHint.tsx` + `lib/use-view-hint.ts` — the toast that names the view the flip landed in
- `docs/architecture/desktop-shell.md` — the pane's key handling
- `docs/architecture/board.md` — the view toggle, the Escape flip and the toast
