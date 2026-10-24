# The board

The board is one screen: a header, a project bar, a row of columns, a browser pane, an open card and a
footer. It is drawn by `components/Board.tsx`, which owns the **state** and the **wiring** and nothing
else: everything that decides something lives in a hook under `lib/`, and everything that draws a layer
lives in its own component under `components/`.

## Overview

- **`components/Board.tsx` is the wiring.** It holds the cards, the projects, the roots, the home folder,
  the filter, the sort, the drag state, the rail's panel and filter, and the browser and terminal state,
  then hands each layer to its own component. `Board()` is `components/Board.tsx:83`; the file is capped
  at 404 counted lines and complexity 26 (`eslint.config.mjs:15` and `eslint.config.mjs:43`).
- **Hooks under `lib/` own the logic.** The board's live event stream (`lib/board-live.ts`), the dialog
  flags (`lib/use-board-dialogs.ts`), the open card's state (`lib/use-open-card.ts`), the New thread splash
  page in the pane (`lib/use-new-thread-pane.ts`), the menu/dock/tray actions (`lib/board-menu-bridge.ts`)
  and the small values derived from the board's state (`lib/board-derive.ts`) are all separate modules,
  each with a test beside it.
- **Components under `components/` own the layers.** `BoardHeader`, `BoardProjectBar`, `BoardColumns`,
  `BoardBrowserPane`, `OpenCard`, `BoardBottom` and `BoardDialogs` each draw one part of the screen and
  take state in through props. They never fetch and never own board-wide state.
- **The board's own API calls go through one helper.** A badge that needs the server's data
  (the pile counter, the code-quality score, the streak, the league, the Backlog count) and the
  open card's thread read all fetch through `apiFetch` (`lib/api-client.ts`), which puts the
  `x-weft-token` header on the request. `lib/guard.ts` refuses every route — reads included —
  once the desktop app has written a launch token, and a 403 that a call site swallows into an
  empty default is a feature that vanishes with no error. `lib/api-token-guard.test.ts` fails the
  build if a `"use client"` file fetches a local `/api` route without the header.
- **The board's own keyboard, palette and menu share one input.** `components/use-board-commands.ts`
  takes one `BoardCommandsInput` and feeds the same state and actions to the shortcuts
  (`components/board-shortcuts.ts`), the command palette (`components/board-palette.ts`) and the desktop
  menu bridge (`lib/board-menu-bridge.ts`).

## Key files

### The board itself

- `components/Board.tsx` — the state and the wiring; the only place that knows how the layers fit together.
  Its framed New thread branch renders `NewThreadWindow`; an open card gets its pane through `OpenCard`.
- `components/BoardHeader.tsx` — the top bar (logo, running / needs-you counts, restart chip, header
  badges, the browser / terminal / share / settings / new-thread buttons, the account button). Grouped
  props: `counts`, `panes`, `slots`. `variant="web"` draws the same bar on weft.zip, leaving out what the
  Mac owns (the browser / terminal / settings buttons) — see `docs/architecture/cloud-sync.md`.
- `components/BoardProjectBar.tsx` — the bar under the header: project chips, the rail's ★/tag filter
  chip, the filter box and the sort menu, in its own `CrashGuard`. `variant="web"` is the same bar on
  weft.zip, where the project menu is the picker alone.
- `components/BoardColumns.tsx` — the `<main>` sheet and one `components/BoardColumn.tsx` per visible
  column. Each column's extras are wired **by column id** here, so `Board` only passes state in: Backlog
  gets the reorder and the sprints, Review gets Resume all / Review all / the filter chips, Running and
  Needs you get Switch all. Grouped props: `drag`, `archive`, `review`.
- `components/BoardBrowserPane.tsx` — the standalone browser pane, drawn while no card is open (an open
  card's pane lives in its workspace's `pane` column, `components/OpenCard.tsx`).
- `components/OpenCard.tsx` — `CardFrame` (the backdrop and the framed window over the board, a
  `role="dialog"` named by its optional `label`) and
  `OpenCard` (the open card's four-column workspace: thread | editor | pane | show).
- `components/NewThreadWindow.tsx` — the framed New thread form beside its desktop browser pane, which fills the rest of the window (`expanded`) instead of keeping an open card's saved width.
- `components/BoardBottom.tsx` — the footer (the open or latest card's model, folder and limits) and, below
  it, the terminal drawer.
- `components/BoardDialogs.tsx` — every dialog, sheet and overlay the board stacks over its columns, each
  still loaded through `guarded()`.
- `components/DeleteCardDialog.tsx` — the delete-card confirmation, Weft's own modal because a native
  confirm can't show a checkbox. It names the card, says a running turn stops and that the CLI
  transcript stays on disk, and carries a "Don't ask again" tick. Both delete paths use it: the trash
  button in an open card's header (`components/CardActions.tsx`) and the right-click menu's Delete
  (`components/use-board-menus.ts`, whose `deleteDialog` node the board draws). The tick is saved only
  when the user confirms the delete; cancelling leaves the preference alone. The way back is
  Settings → Security's **Ask before deleting a card** row (`components/DeleteConfirmSwitch.tsx`),
  which turns the question back on.
- `components/rail-context.ts` — `RailContext`, the seven props every rail drawer shares; `SideRail`
  (`components/LibraryRail.tsx`) takes it as one `ctx` prop. Every tool drawer also shares the shell's ▶ and the
  intro video under its title (`useFeatureIntro`, [feature-intros.md](feature-intros.md)).
- `components/use-board-commands.ts` — the shortcuts, the command palette and the menu bridge sharing one
  input (`BoardCommandsInput`).

### The logic, under `lib/`

- `lib/board-live.ts` — `useBoardLive` and what each server event does to the board's state
  (`onBoardEvent`), plus the full reload on the first connect and every reconnect (`reloadBoard`).
- `lib/optimistic-cards.ts` — Delete and Stop land on the board before the server answers. Every Delete and
  Stop button (header trash, right-click menu, card Stop, reply box ■, palette, first-message banner) calls
  `removeNow` / `stopNow`; each records an intent and tells `useBoardLive` to redraw (`applyIntents`): a
  deleted card disappears, a stopped one moves to Review with its Stop gone. Server cards (events and
  reloads) pass through `overlay` / `overlayAll`, so a late update can't undo the intent; an intent ends when
  the server's card shows the stop done, on `card_deleted`, or on a refusal, which reloads the board. A stop
  whose card never leaves Running gives up after `STOP_SETTLE_MS` (10 s) and reloads. The copilot lane's Stop
  and the web board are not covered.
- `lib/board-derive.ts` — the small values read off the board's state each render: `filterState`,
  `footerFor`, `workFolder`, `openCardOf`, `headerCounts`.
- `lib/use-board-dialogs.ts` — the dialog flags (`useBoardDialogs`, `DialogFlags`) and what they cover:
  `dialogLayers` returns `overlay` (something is over the board, so the native pane hides) and `boardKeys`
  (the shortcuts that act on the board stand down).
- `lib/use-open-card.ts` — `useOpenCard`: which card is open, its thread and streaming text, the last one
  opened, Rename…, and the unseen moves.
- `lib/use-new-thread-pane.ts` — `useNewThreadPane`: the New thread splash page in the pane while the
  dialog is up. It returns the pane's visibility from before the dialog while the restore on close lands, which
  `BoardBrowserPane` reads (`held`) so the pane doesn't remount open and slide shut.
- `lib/board-menu-bridge.ts` — `useMenuBridge` and `runMenuAction`: what the app menu, dock, tray and
  global shortcuts ask the board to do.
- `lib/delete-confirm.ts` — `shouldConfirmDelete` and `rememberDeleteConfirm`: the "don't ask again"
  flag behind the delete-card dialog, in localStorage under `weft.delete.skipConfirm` like the Switch
  all dialog's. Both delete paths ask `shouldConfirmDelete()` first: when it is off the card is
  removed straight away, otherwise the dialog opens.
- `lib/use-delete-dialog.ts` — `useDeleteDialog` and `removeCard`: the delete confirmation's state
  (which card is waiting to go, and the dialog node the board draws) and the board's delete itself
  (it clears the open card if it was the one going, then tells the server). It lives here rather than
  in the menu hook so `components/Board.tsx` keeps its size ratchet.
- `lib/api-client.ts` — `apiFetch`, `API_HEADERS` and `API_TOKEN_HEADER`: the one place that knows the
  board's fetch header, so every board-side request carries `x-weft-token`.
- `lib/thread-transport.ts` — the desktop's `localTransport`: it reads an open card's thread page from
  `/api/cards/:id/thread` through `apiFetch`, so a refused read shows as a failure rather than an empty
  thread.

### The board's keyboard and palette

- `components/board-shortcuts.ts` — `boardShortcuts(c)`: every board shortcut as a `ShortcutDef`, with the
  state and actions it reads in `BoardShortcutContext`.
- `components/board-palette.ts` — `boardPaletteItems(state, actions)` and `promptItems(...)`: what the
  command palette offers (the board's actions, the projects, every card, the prompts you wrote).

## Data flow

```
lib/board-live.ts (server events ──▶ onBoardEvent ──▶ reloadBoard on reconnect)
        │
        ▼
components/Board.tsx  ── state + actions ──▶  components/BoardHeader.tsx
        │                                      components/BoardProjectBar.tsx
        │                                      components/BoardColumns.tsx
        │                                      components/BoardBrowserPane.tsx
        │                                      components/OpenCard.tsx
        │                                      components/BoardBottom.tsx
        │                                      components/BoardDialogs.tsx
        │
        └── state + actions ──▶ components/use-board-commands.ts
                                 ├── components/board-shortcuts.ts  (keys)
                                 ├── components/board-palette.ts    (⌘K items)
                                 └── lib/board-menu-bridge.ts       (menu, dock, tray)
```

1. The server publishes an event; `lib/board-live.ts` turns it into a state change and `Board` re-renders.
2. `Board` derives the small values (`lib/board-derive.ts`) and passes them to the layer components.
3. A layer calls back with an action (`onOpenCard`, `onToggleBrowser`, `onProject`, …); `Board` changes the
   state it owns, or hands the action to a hook that owns it (`lib/use-open-card.ts`, `lib/use-board-dialogs.ts`).
4. The same state and actions go to `components/use-board-commands.ts`, so a shortcut, a palette item and a
   menu item can never drift apart.

## Patterns

- **One owner per piece of state.** The board's flags live in `lib/use-board-dialogs.ts`, the open card's in
  `lib/use-open-card.ts`, the live stream's effects in `lib/board-live.ts`. A component draws; a hook
  decides; `Board.tsx` wires.
- **Grouped props.** A layer with many props takes them grouped by what they are: `BoardHeader` gets
  `counts`, `panes` and `slots`; `BoardColumns` gets `drag`, `archive` and `review`; `BoardBottom` gets
  `terminal`; `OpenCard` gets `browser`. New props belong in the group they belong to, not as a tenth
  loose prop.
- **Extras by column id.** `components/BoardColumns.tsx` decides which column gets which control
  (`id === "review"`, `id === "backlog"`, …) instead of `Board` growing a branch per column.
- **One input for keyboard, palette and menu.** Add the state or action to `BoardCommandsInput`, and the
  three read the same value.
- **Guarded pieces.** Every piece that a thread is likely to edit loads through `guarded()`
  (`components/guarded.tsx`), so a module that throws as it loads breaks only its own spot
  (docs/architecture/error-boundaries.md).
- **Weft's own modal, not `window.confirm`, when the dialog needs a choice.** A native confirm sheet
  has only Cancel and OK, so it can't carry a checkbox. The delete-card dialog
  (`components/DeleteCardDialog.tsx`) and the Switch all dialog
  (`components/switch-all-button.tsx`) are Weft's own modals for that reason, and each keeps its
  "Don't ask again" tick in `localStorage`.
- **Tests.** Each new module has a test beside it: `components/BoardHeader.test.tsx`,
  `components/BoardColumns.test.tsx`, `components/BoardProjectBar.test.tsx`,
  `components/BoardBrowserPane.test.tsx`, `components/BoardBottom.test.tsx`, `components/OpenCard.test.tsx`,
  `components/LibraryRail.test.tsx`, `components/use-board-commands.test.tsx`, `lib/board-derive.test.ts`,
  `lib/board-live.test.ts`, `lib/board-menu-bridge.test.ts`, `lib/use-board-dialogs.test.ts`,
  `lib/use-open-card.test.ts`, `lib/use-new-thread-pane.test.ts`, `lib/delete-confirm.test.ts`,
  `components/DeleteCardDialog.test.tsx`, `components/use-board-menus.test.tsx`,
  `lib/use-delete-dialog.test.ts`.

## How to add

### A column extra (a control only one column has)

1. Add the state and the action to `components/BoardColumns.tsx`'s props — in the group it belongs to
   (`archive`, `review`, `drag`), or a new group if it is its own thing.
2. In `OneColumn` (`components/BoardColumns.tsx:77`), decide by column id which column gets it, and pass it
   to `components/BoardColumn.tsx` (or its `components/ColumnHeader.tsx`).
3. `components/Board.tsx` passes the state and the action into `<BoardColumns …>`.
4. Test it in `components/BoardColumns.test.tsx`, which already asserts that only Backlog gets the reorder
   and the sprints, and only Review gets Resume all / Review all / the filter chips.

### A shortcut

1. Add a `ShortcutDef` to `boardShortcuts(c)` in `components/board-shortcuts.ts` — an `id`, the `keys`, a
   `description`, a `group`, and an `enabled` rule (`c.boardKeys` stands it down while a dialog or the
   project menu is up).
2. If it needs state or an action it does not have, add it to `BoardShortcutContext` in
   `components/board-shortcuts.ts`, then to `BoardCommandsInput` in `components/use-board-commands.ts` and
   to the `useBoardCommands` call in `components/Board.tsx`.
3. The shortcut shows up in the `?` dialog and in Settings → Shortcuts with no extra work: both read
   `shortcutSections` from the registry (docs/architecture/keyboard-shortcuts.md).

### A palette item

1. Add a `command(...)` entry to `commandItems` in `components/board-palette.ts` — an `id`, a `label`, an
   `icon`, a `run`, and optionally the `keys` it shares with a shortcut and `keywords` for the search.
2. If it needs state or an action, add it to `PaletteState` or `PaletteActions` in
   `components/board-palette.ts`, then to the `paletteItems` call in `components/use-board-commands.ts`.
3. The palette is built only while it is open, so the list stays fresh without churning every render.

### A delete confirmation

1. Draw the modal in `components/DeleteCardDialog.tsx`: it names the card, carries the "Don't ask
   again" tick, and calls `rememberDeleteConfirm(true)` only when the user confirms with the box
   ticked. Cancelling leaves the preference alone.
2. In the path that deletes, call `ask(card)` from `useDeleteDialog` (`lib/use-delete-dialog.ts`): it
   asks `shouldConfirmDelete()` first (`lib/delete-confirm.ts`), and if the flag is off it deletes
   straight away; otherwise it opens the dialog and deletes on confirm.
3. A path that lives in a `.ts` file can't hold JSX: the dialog is built with `createElement`
   (`BoardDeleteDialog` in `components/DeleteCardDialog.tsx`) and the node is handed to the board to
   draw (`deleteDialog` in `components/BoardDialogs.tsx`, wired from `components/Board.tsx`).
4. Test the modal in `components/DeleteCardDialog.test.tsx` and the flag in
   `lib/delete-confirm.test.ts`; a menu path is driven through the native menu by stubbing
   `window.weft.popupMenu` (`components/use-board-menus.test.tsx`).

### A dialog flag

1. Add the flag to `DialogFlags` and to `useBoardDialogs()` in `lib/use-board-dialogs.ts`, with its setter.
2. If it covers the native browser pane, include it in `dialogLayers`'s `overlay`; if the board's shortcuts
   must stand down while it is up, include it in `boardKeys`.
3. Render the panel in `components/BoardDialogs.tsx` (each panel loads through `guarded()`), and pass the
   flag and its close handler from `components/Board.tsx`.
4. Test the rules in `lib/use-board-dialogs.test.ts` and the panel in `components/BoardDialogs.test.tsx`.
