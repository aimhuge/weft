# Keyboard shortcuts

## Overview

One registry holds the board's keyboard shortcuts. Components register theirs, a single window listener dispatches key presses, and the `?` dialog lists whatever is registered, so a new shortcut shows up in the list with no extra work. Settings → Shortcuts renders the same list inline (with the rebindable dictation row above it), so users who land on the settings page for shortcut help see every shortcut without first learning the `?` key — the two views share `useShortcutList`/`shortcutSections`/`KeyCaps` from one source.

Other pieces share the name and are separate: `lib/shortcuts.ts` holds user-rebindable bindings (dictation) kept in localStorage, and the native menu accelerators in `electron/menus.cjs` (⌘N, ⌘F, ⌘, and so on) are handled by Electron. Keys handled where they apply (the composer, reply box, terminal, palette, app menu) are written down in `lib/shortcut-catalog.ts` so the dialog can list them too.

Discoverability is built on the same registry: tooltips, key badges, native right-click menus and the hold-a-modifier card all read keys from it instead of hardcoding them.

## Key files

- `lib/hotkeys.ts`: the registry, `useShortcuts`, `useShortcutListener`, `useShortcutList`; `keyCaps`/`keyLabel` for drawing keys, `useShortcutHint` for tooltips ("Copilot (C)"), `toAccelerator` for native menus.
- `lib/shortcut-catalog.ts`: what the dialog lists. `shortcutSections` merges the registry with the fixed shortcuts handled elsewhere (`FIXED_SHORTCUTS`) and the app menu's keys (`MENU_ALIASES`, desktop only); `filterSections` searches by words or by key ("cmd k", "esc"). Update `FIXED_SHORTCUTS` when a key handled outside the registry changes.
- `components/ShortcutsDialog.tsx`: the `?` dialog, a searchable two-column list of `shortcutSections`, up to 1100px wide; `splitDescription` puts a description's fine print on a dim second line.
- `components/ShortcutSettings.tsx`: the same `shortcutSections` rendered inline on the Settings → Shortcuts page, with the rebindable row(s) above it.
- `components/KeyCaps.tsx`: `Cap` and `KeyCaps`, the one way to draw a key spec as key caps.
- `components/submit-keys.ts` + `lib/new-thread.ts` + `lib/use-mod-held.ts`: the New thread dialog's start keys. Enter is a new line; ⌘↵ starts the thread and closes the dialog; ⌃↵ (macOS only, since Ctrl is the mod key elsewhere) starts it and keeps the dialog open, emptied, for the next one (`onCreate`'s `{ stay }`: the board doesn't open the new card). `useHeldModifiers()` tells ⌘ from ⌃ while held, and `startButton()` relabels the Start button to match ("Start & close ⌘↵", "Start, keep open ⌃↵"). `submitFor()` decides what Enter does in the raw Markdown box.
- `components/ModifierHint.tsx`: hold Shift, or ⌘ (Ctrl off macOS) for 0.6s, and a card bottom-left lists the registered shortcuts that use it.
- `lib/card-menu.ts`: every right-click menu item has a key (`MENU_KEYS`), live only while the menu is open; `electron/main.cjs` sets it as the native item's key equivalent. Items with a board shortcut take the registry's key instead (`components/use-board-menus.ts`), skipping Return, arrows and the other keys the open menu uses itself.
- `components/use-board-commands.ts`: registers the board shortcuts (`components/board-shortcuts.ts`) and mounts the listener once, from the same input as the command palette and the menu bridge (`components/Board.tsx` passes it in).
- `components/CardView.tsx`: cards carry `data-card-id`, and `Board` marks each column with `data-column`; keyboard navigation moves DOM focus between them.

## How it works

- A key is written `"n"`, `"?"`, `"ArrowDown"`, or `"mod+k"` (`mod` is ⌘ on macOS, Ctrl elsewhere; `ctrl`, `alt` and `shift` also work, and `ctrl` is Control on macOS too). Letters compare case-insensitively; for a symbol like `?`, Shift is whatever it takes to type it.
- Plain keys are ignored while typing in an input, textarea, select, or editor. A shortcut using `mod` or `alt` still fires there, and `allowInInput` opts one in outright.
- When several shortcuts share a key, the one registered last runs first. A handler returning `false` passes the key on to the next and leaves the browser default alone; anything else counts as handled and prevents the default. This is what Escape handling should build on: a dialog registers Escape with `allowInInput` and returns `false` when it has nothing to close.
- `useShortcuts` reads keys and descriptions once, at mount; handlers and `enabled` follow the latest render, so they can use current state. The list must keep the same ids on every render.
- A disabled shortcut stays in the help list. Board shortcuts are disabled while a dialog or the project menu is open.

## Current shortcuts

General: `?` or ⌘/ help, `n` new thread, `/` filter, `,` settings, `c` copilot, `b` browser, Shift+`S` add a secret (opens the 🔐 drawer on its Add form; the ask waits in `lib/use-vault.ts` until the drawer has loaded a vault).
Board: `j`/`k` or ↓/↑ between cards, `h`/`l` or ←/→ between columns, Home/End first and last card, Enter or `o` open the focused card, `a` jump to a card that needs you, `z` reopen the last card you had open (`lastOpenId` from `lib/use-open-card.ts`, the card still outlined after you close it; stands down while a card is open), `[`/`]` previous and next project, `s` cycle sort.
Thread: `r` reply in the open thread, Shift+`A` archive or unarchive it (plain `a` stays "needs you"), Shift+`E` archive every Done card on screen, Shift+`Z` undo the last archive (plain `z` reopens the last card), ⌘⇧↵ (or `mod+shift+Enter`) send "continue" through the same `onSend` path a typed message uses — the same call the card-level ▶ makes (`lib/resume-actions.ts`); the shortcut greys out while a turn runs, a question waits, the box is a `!` shell command, or you're editing the last message (`lib/use-reply-continue.ts`).

Writing, terminal and app shortcuts (⌘↵, ⌘B, ⌘\\, ⌘J, ⌃⌥Space and more) are listed from `FIXED_SHORTCUTS`.

Buttons and menus that have a shortcut show it: header tooltips, the `N` cap on New thread, the `/` badge in the filter box, "? Shortcuts" in the footer, and the right-click menus. Hold a modifier outside a text field for the cheat card (`ModifierHint`); it renders nothing until first used, since macOS key names differ between server and client.

## ⌘T: a new browser tab

File → New Tab (⌘T) is a menu accelerator, so it works from the composer, a reply box or a page in the pane alike. `electron/menus.cjs` opens a blank tab for the open card (`pane.newTab()`, which also shows the pane), gives the keyboard back to the board's webContents and sends `new-tab`. `lib/board-menu-bridge.ts` passes it to `lib/pane-new-tab.ts`, and `components/BrowserPane.tsx` bumps the same `fresh` counter the toolbar's + does, so the address bar empties and takes focus. The pane may mount only after the ask (it was closed, and loads lazily), so the ask waits up to 3s for a pane to take it, once.

## ⌘F: find, by where the keyboard is

⌘F, ⌘G and ⇧⌘G are Edit menu accelerators, so no page ever sees them as keys. `sendFind` in `electron/menus.cjs` reads the focused webContents (only main can tell a page in the pane from the board) and sends the menu action with payload `"pane"` when a pane page holds the focus.

- **Page in the browser pane focused:** `components/PaneFind.tsx` opens. Its field replaces the address bar for as long as find is open: the page is a native view nothing can sit over (`lib/overlay.ts`), and taking the address bar's slot adds no row and leaves the page's size alone, so it never reflows under a search. `electron/pane-find.cjs` drives `findInPage`/`stopFindInPage` on the active tab and sends `browser:found`. A new page or tab re-runs the search. Esc closes it from the field, or from the page through the Escape replay (`electron/pane-escape.cjs`), and gives the keyboard back to the page.
- **A thread open, no dialog:** `lib/board-menu-bridge.ts` raises `requestThreadFind` (`lib/find-events.ts`) and `lib/use-thread-find.ts` opens `components/FindField.tsx`, floated over the top of the messages. Only `ThreadPanel` passes `findable`, so the copilot's chat stays out of it.
- **Settings open:** `components/SettingsSearch.tsx` takes `find`, as before. The bridge's `threadOpen` is false under a dialog.
- **Nothing open:** the board's filter.

The pane's find field holds the board's focus while you type, so main reports "the board"; `paneFindFocused()` (`data-pane-find`) stops those keys reaching the thread behind it.

**Finding in a thread works on data, then the DOM.** A thread draws only its newest 50 items (`lib/thread-page.ts`) and folds tool runs, edited turns, briefs and long results, so the DOM can't answer. `GET /api/cards/[id]/thread/search?q=` runs `matchThread` (`lib/thread-find.ts`) over the whole stored thread, long tool results included, and returns which items hold the query and how many times. That makes the count. A Worker card's transport searches its synced rows the same way (`workerThreadSearch`, `lib/worker-thread-reads.ts`), its long tool results paged from `cloud_tool_outputs` and put back in their items, so a hit lands on that item's index (a sealed row or output matches nothing). A transport without `searchThread` (the web) searches its loaded window; off the desktop ⌘F is the browser's own anyway.

The current match counts from the newest, since a thread is read from its bottom: Enter walks up it, Shift+Enter back down, and both wrap. Landing on one: a match above the window walks `loadPage` back to it; `FindRevealContext` (`lib/find-reveal.ts`) opens whatever folds it while it's current, and it folds back when find moves on; `lib/find-highlight.ts` paints the drawn matches with the CSS Custom Highlight API, so React's DOM is untouched (`::highlight()` in `app/globals.css`); a MutationObserver repaints as rows change. Matches in folded rows that aren't current count but don't paint, since they aren't drawn.

The count comes from source text and the paint from drawn text, and they can differ slightly: Markdown is flattened to compare (`plainMarkdown`), and a row drawing fewer matches than its source lands on its last one.

## The printed sheet

Every shortcut on one landscape page, to keep by the screen. `shortcutSheetHtml()` (`lib/shortcut-sheet.ts`) renders
the same `shortcutSections` the `?` dialog lists (`components/use-shortcut-sections.ts` shares them), dropping each
description's fine print so it stays one page, as plain HTML with no script and `@page { size: landscape }`.

- **Printing.** `printHtml()` (`lib/print-sheet.ts`): on desktop it hands the HTML to Electron main (`print:html` in
  `electron/print.cjs`), which loads it as a data URL in a hidden, sandboxed window with JavaScript off and calls
  `webContents.print({ silent: false })`, so the system print dialog opens (with no printer, it still saves a PDF). In a
  browser tab it prints from a hidden `srcdoc` iframe and removes it on `afterprint`.
- **Where it's offered.** The `?` dialog's footer has a **Print** button for everyone (`PrintSheetButton`). The welcome's
  last screen (`components/WelcomeFirst.tsx`) shows `PrintSheetOffer`, a short pitch for the keyboard with a **Print the
  sheet** button, only when `print:printers` (`webContents.getPrintersAsync()`, macOS's added printers; no prompt, no
  network) names at least one. On the web, or a shell from before this, it lists none and the pitch stays hidden.
- An AirPrint printer on the network that was never added in System Settings isn't listed, and Save as PDF isn't a
  printer, so neither turns the pitch on.

## The rebindable dictation binding

`lib/shortcuts.ts` holds the one binding a user can change: dictation, `⌥'` by default, kept in localStorage under
`threadboard.shortcuts`. Settings → Shortcuts shows it above the full list, so a rebound key shows there too.

Two rules make it behave the way people expect:

- **The binding is a set of modifiers, not an exact combination.** A binding of `⌥'` fires on `⌘⌥'` as well, because the
  extra Command is what people reach for when the bare combination is taken (or is used by another app). Every modifier
  the binding names has to be held; the ones it leaves out are free. Shift is the exception: it changes which character
  the key produces, so it has to match exactly.
- **It matches the physical key, not the character.** `matches()` compares `event.code`, so `⌥'` is `Quote` on any layout
  and Option doesn't change what the key is. The Composer's capture handler claims the key before the editor or textarea
  can type its macOS character first (Option+`'` is `æ`).

The key is claimed in the capture phase, so the editor never types the character. The hook's own state is one render
behind while the microphone is still opening, so the toggle reads a ref instead: a second press in that window cancels
the recording that is starting rather than opening a second microphone (or leaving one running with nobody listening).

In the desktop app the binding is also a system-wide hotkey (`bindingAccelerator()` → `electron/dictation-helper.cjs`), so it
works in every app (docs/architecture/dictation.md#anywhere). macOS takes a registered hotkey before any window sees it, so
the exact combination never reaches the composer there. A system hotkey is an exact combination, though: `⌘⌥'` still
reaches the composer's handler inside Weft, which starts the same floating pill, but does nothing in other apps.

## Gotchas

- Enter opens a card only when the card itself has focus, so it still presses a button inside one.
- Don't register a shortcut that duplicates a native menu accelerator; in the desktop app the key may reach both.
