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
- `components/BoardList.tsx` — the list view: the same cards as a slightly futuristic Google Sheet on a pane
  of frosted glass (`.list-glass`), with grid lines across and down, a numbered gutter, and the column
  bands stuck under the header (`components/SheetBand.tsx`; a click folds a band, the Backlog band comes
  first and starts folded). It hands every card row to `Board` with its place in the tree (`RowNest`), so it
  holds no card details of its own, and draws subagent rows itself (`components/AgentRow.tsx`). The corner
  cell clears the filters, or with none on opens New thread.
- `components/SheetRow.tsx` — one row of the sheet: the numbered gutter and the row's content beside it.
  Every row of the list view is one of these — a card, a subagent, a cron's run — so the grid lines up
  down the sheet.
- `lib/list-sheet.ts` — the board's columns on `@aimhuge/sheet` (the shared sheet kit, docs/architecture/sheet.md),
  pure: `BOARD_SHEET`, each column's values (`cellValues`; tags can be several, blanks are `(blank)`), `sortBy` (stages in pipeline order, statuses loudest first,
  age by real time, blanks last both ways, ties in board order), `rowMatches` (the title search, then
  unticked values, stored as the hidden ones so a new value shows by default), `filterCount`, and the row
  status `CardRow` draws. The sorts, filters and value counts themselves are the kit's
  (`@aimhuge/sheet`), driven by `SheetHeader`; Weft keeps only the board's own names and rules.
- `lib/column-tone.ts` — each column's colour, in one place (`COLUMN_TONE`): the text a column's name and
  stage take, the bar its stage steps fill with and the dot its band is marked by. The card's progress
  line, the list view's row cells and the sheet's band all read it, so a column that changes colour
  changes in one edit.
- `lib/list-tree.ts` — the rows as a tree: a card started by another (`parentId`) or a cron run (`cronOf`)
  folds under it; an opened card lists its subagents (`card.tasks`, kind `agent`), then its child cards. A
  child waiting on you, or whose tree's top sits in a folded band, also stands on its own in its band; a
  parent loop leaves both top-level; a match deep in a tree keeps its path. `bandsToDraw` keeps an empty
  Backlog and Running so there's always somewhere to type a card. Type-ahead matches are ranked by `@aimhuge/sheet`'s `typeahead`.
- `lib/cron-fold.ts` — the one rule for which card a card folds under (`foldParentOf`): a cron run under
  its holder (`Card.cronOf`), anything else under the thread that started it (`Card.parentId`). The board's
  stacks, the list view's tree and the crons drawer all read it, so the column view and the sheet never
  disagree about who owns a run.
- `SheetHeader` + `SheetFilterMenu` (from `@aimhuge/sheet/client`, fed `BOARD_SHEET`) — the header row: a click on a name opens
  its menu with the cursor in the search box. Title filters cards as you type; other columns narrow their
  values (↑↓, Enter keeps only the match, Only per value, Show/Hide all) under a two-button sort bar. Age
  flips its sort on a click. A filtered header says what it's filtered to. Menus are the kit's `SheetPopover`,
  a portal because the cells clip. `components/use-list-sheet.ts` keeps the sort, filters, title search and
  folded bands in localStorage (`weft:list-sheet`) as an external store.
- `components/CardRow.tsx` — one line of the list, its cells in `components/CardRowCells.tsx`: the title
  (indented, a fold toggle with a count, underlined under the pointer), the status (`RowStatusCell.tsx`: a
  click or right-click opens Stop / Run now / Continue / Restart / Move to Backlog or Review from
  `lib/list-actions.ts`; Done is left out because it runs /weft:done), the stage, the tags, the folder
  (`RowFolderCell.tsx`: a click opens a type-ahead picker of `knownFolders`, a typed path, or Choose folder…,
  and moves the card with `api.setCwd`) and the age.
- `components/SheetQuickAdd.tsx` — the row at the foot of the Backlog and Running bands: type a title and
  Enter files a Backlog card (`start: false`, the cursor stays for the next); in Running it starts a thread.
  Its folder chip picks the folder (the most recently busy one on the sheet by default), More… opens New thread.
- `lib/list-keys.ts` + `components/use-list-keys.ts` — the list's keyboard, a capture-phase listener: a typed letter
  starts the title search (`HeaderMenu`, held by `BoardList`, opens Title with that letter), and Space is a leader:
  Space then B or R puts the cursor in the Backlog's or Running's quick add, any other key goes on to the board's own
  shortcut, so n, b, t, c… are Space n, Space b… in the list. j, k, ?, / keep their meaning; nothing fires in a field,
  with a modifier, or with a dialog or a thread open. A pill at the sheet's foot shows while Space waits (1.5 s).
- `components/use-sheet-drag.ts` — drag a top-level Backlog row onto another (its gutter is the grip) to reorder,
  through the board's `drag.onReorder`; off while the sheet is sorted, since a sort would undo it.
- `components/SheetCrons.tsx` + `lib/list-crons.ts` — crons in the sheet. The ⏰ Crons band at the foot has a
  row per cron (`cronRows`: soonest first, matched by the title search): on with its next run or off, its
  schedule, fork or fresh, folder, last run and run count; its status opens Run now and Switch on/off
  (`useCrons`, read by the sheet itself so Board.tsx stays out of it), and its toggle folds open the run cards
  as the board's own rows. Elsewhere a run row carries `⏰ run N` and the card its runs fold under
  `⏰ next in 3h` (or off), through `RowNest.cron` (`cronBadge`); "⏰ cron" is a value in the Tags filter.
- `components/list-grid.css` — the sheet's columns (the rest of its look is `components/list-sheet.css`). The template lives in CSS because it needs
  `minmax()`, and Tailwind drops an arbitrary value holding a comma. The tracks are fractional, so the
  sheet always fits the board it is drawn in; a narrow board drops the tags and the folder, then the age,
  through **container queries** (the board's width follows the rail and the thread panel, not the window).
- `components/ViewToggle.tsx` — the board / list toggle in the project bar. The choice is a preference
  (`lib/board-prefs.ts`), read through `lib/use-view-mode.ts`.
  Escape flips it too, from `lib/use-escape-view.ts`: the bottom Escape layer, on only while no thread,
  new-thread dialog, browser or closable drawer is up, and never for an Escape typed in a field.
  The flip pops a toast under the toggle — `components/ViewHint.tsx`, drawn from the state in
  `lib/use-view-hint.ts` — naming the view you landed in and what the next Escape does ("List view ·
  hit Esc again to switch to board view"). It closes itself after a moment (4 s, `HINT_MS`), on its ✕,
  or on the next Escape (which puts the toast away rather than flipping again, since the toast says
  what Escape does).
  It hangs off the toggle rather than taking a row, so it costs no vertical space on a small
  screen. The Escape layer itself decides the flip and hands the new view to the hint, so the two
  can never disagree about what happened.
  The toast is deliberately loud — big type, an accent icon tile, a bright accent border and a wide
  glow, and a short entrance (`.view-hint-pop` in `app/globals.css`) so it pops in rather than
  merely appearing. It is one row and never wraps: an absolutely-positioned box with no width
  shrinks to its content and then wraps its text into a narrow column, which left the icon adrift
  from the words and stranded the ✕ between them, so it carries `w-max` and `whitespace-nowrap`.
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
- `components/Modal.tsx` — the shell every dialog sits in, and where it draws. The shell portals into a
  `div[data-weft-modal]` it creates on `document.body` (and removes on unmount), not into wherever it was
  asked for. A dialog opened from the header — the leagues, from `components/LeagueBadge.tsx` — sits inside
  `<header class="app-drag">`, and on macOS that header is the window's drag region
  (`-webkit-app-region: drag`, `app/globals.css`), which is a stacking context: the header's whole subtree
  is stacked as one unit, so the dialog's `fixed z-50` backdrop could only paint *inside* it, under the
  board sheet and the rail drawer beside it. No z-index lifts a child out of an ancestor's stacking
  context; only leaving it does. The portal's host is a div of its own rather than `document.body` itself:
  React removes a portal's nodes when the tree that made them unmounts, and a body shared by several roots
  makes that bookkeeping ambiguous — one dialog's unmount could take another's nodes with it.
  The host is made in a lazy `useState` initializer, and React 19's StrictMode runs such an initializer
  **twice** on the same mount while its double-mount also runs the effect cleanup between the two mounts.
  Two hosts meant React portaled into one the cleanup had taken off the body, and a portal into a detached
  node draws nothing: the dialog rendered but never painted, which is why Settings (a dialog) stayed shut.
  The second call therefore claims the first call's host instead of making another (a `data-weft-modal-waiting`
  marker, cleared in a microtask so a host nobody claimed is forgotten rather than adopted later), and the
  mount effect puts the host back on the body if StrictMode's cleanup took it away.
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
  whose card never leaves Running gives up after `STOP_SETTLE_MS` (10 s) and reloads. The copilot's card goes
  through the same overlay (`onCard` overlays it before `updateCopilot`; `useCopilotCard` and `useCopilotThread`
  overlay their loads and redraw on `onOptimistic`), so its Stop, answers, rename and mode draw at once too. The
  web board is not covered.
  A permission prompt's answers are intents too: Allow and Deny (`answerNow`, from the card row and a thread's
  plain Allow/Deny), This first and You first (`firstNow`), Others first (`otherFirstNow`) and Wait (`waitNow`,
  through `localTransport`) draw
  the card as the runner will leave it (prompt gone and Running, or waiting on the holder) until the server's
  card shows another request or none. A question or form with answers still waits, so a refused form stays filled.
  Card fields go through `patchNow`: star, tags (Tags… and a drop on the 🏷 drawer), archive and unarchive
  (with Undo), rename, permission mode and dismissing the broke chip draw at once; a patch ends when the server's
  card has every field (false, missing and [] read alike), after `STOP_SETTLE_MS`, or on a refusal (reload).
  More `patchNow` users: ▶ Resume / Restart and Resume all (`lib/resume-actions.ts`, `column: "running"`), the
  first-message banner's Rerun on the backup model (running, error gone), and the thread header's model picker
  (`components/BackendPicker.tsx` with `lib/backend-pick.ts`: the new CLI and model; a CLI move on a live thread is
  refused at once in the server's words, without a call).
- `lib/pending-sends.ts` + `lib/use-pending-sends.ts` — a reply shows in the thread the moment you send it. The reply
  box empties at once (Send, Send now, ↑ edit, Send fresh) and puts the text back if the send fails (unless you've
  typed since). `ThreadView` sends through `usePendingSends().track`, which draws the message after the page's items
  until a user item lands at or after its index (`unsent`: each new user item stands for the oldest send waiting
  there; texts aren't compared, since the server may reword one), or `PENDING_SEND_MS` (30 s) after the server took it.
  An edit's message lands after the one it replaces (`useEditLast`'s `track`).
- Send later (`lib/use-reply-schedule.ts`) draws its queue row and empties the box at once; an X'd or taken-back row
  leaves at once and comes back on a refusal, so a second click can't schedule or cancel twice.
- Drawer switches draw at once and reload (or restore) on a refusal: cron on/off (`useCrons().update`), cloud sync
  folders (`useCloudSync().setFolder`), Slack settings (`useSlack().save`), webhook Mark registered
  (`useWebhooks().update`) and the GitHub drawer's sync and instant boxes (a `drawn` override until its reload).
- `lib/board-derive.ts` — the small values read off the board's state each render: `filterState`,
  `footerFor`, `workFolder`, `openCardOf`, `headerCounts`.
- `lib/use-board-dialogs.ts` — the dialog flags (`useBoardDialogs`, `DialogFlags`) and what they cover:
  `dialogLayers` returns `overlay` (something is over the board, so the native pane hides) and `boardKeys`
  (the shortcuts that act on the board stand down).
- `lib/use-escape-view.ts` — `useEscapeTogglesView` and `bareBoard`: the bottom Escape layer, the one
  that flips between the column view and the list view when nothing else is up. Its extra inputs are
  one `ViewFlipOptions` object (`onFlip`, `hintUp`, `onDismiss`) rather than a long parameter list, so
  the call site reads as what it means. `onFlip` is told the view it switched to; while the toast is
  up (`hintUp`), Escape calls `onDismiss` instead of flipping again, because the toast is what tells
  the user what Escape does.
- `lib/use-view-hint.ts` — `useViewHint` and the toast's words: the last flip (`mode` and an `id` that
  counts the flips, so the toast can key itself on it and restart its timer), `show` and `clear`, and
  the text — `viewLabel`, `hintTitle` ("List view"), `hintOther` (the other view's name) and
  `hintOtherText` ("hit Esc again to switch to board view"). The name and the trailing clause are
  separate so the toast can set the name in accent and weight and the eye lands on the answer before
  the sentence around it. The toast closes itself after `HINT_MS` (4 s).
- `lib/use-open-card.ts` — `useOpenCard`: which card is open, its thread and streaming text, the last one
  opened, Rename…, and the unseen moves. Opening a card always brings the browser pane back: `select`
  asks the shell to show it and opens the workspace's `pane` column, so a thread never opens beside an
  empty slot — not even one the user closed earlier. Closing the card hides the pane again; the pane
  column itself stays open, so the next card comes back with it.
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
- **A toast that says what the key does has to be what the key does.** The view toast names the view you
  landed in and what the next Escape will do, so the Escape layer has to honour that: while the toast is
  up, the next Escape dismisses it instead of flipping the view again. The layer decides the flip and
  hands the new view to the toast, so the two can never disagree about what happened.
- **A card's own signal, on the card.** A state that belongs to one card is drawn by that card, not by the
  board: a cron run's violet stub (`components/CronMark.tsx`), a card that broke Weft's red ring
  (`lib/crash-blame.ts`), a card that asked Weft to restart (`components/RestartMark.tsx`). Each mark is a
  component with a `cardClass(card)` helper and its own CSS file, so the board passes the state down and the
  card draws itself. The colour is that feature's alone: a feature picks one (violet for crons, red for a
  restart) and keeps it, so two signals never read as one.
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
