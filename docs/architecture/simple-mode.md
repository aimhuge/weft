# Simple mode

Simple mode is a preset: it turns on a bundle of small view toggles that each also work alone. With all of them on,
Weft shows two things, the chat and what the chat built. It's for builders and PMs on a 13" screen, and for anyone
new. Nothing is taken away: each toggle folds a piece of UI into something that already exists (a count, a pill, a
folded line), and the pieces open again with one click.

Status: the first four pieces are built (2026-11-15). Where each lives:

- Prefs: `lib/simple-mode.ts` (`SIMPLE_PIECES`, `simplePieceOn`, `setSimplePiece`), `lib/use-simple-piece.ts`; the
  switch and its checkboxes in `components/SettingsGeneralPage.tsx` + `components/SimplePieces.tsx`.
- Full-page pane: `components/OpenCard.tsx` wires it; `components/RailPill.tsx` (pill in `PaneTabs`, or the toolbar
  with one tab), `lib/pane-rail-open.ts` (open/closed, in memory), `components/PaneBottom.tsx` (live line from
  `lib/pane-live-line.ts`, the thread panel's permission block, and the same `ReplyBox`), `CardWorkspace`'s `hidden`.
- Folded steps: `lib/turn-steps.ts` (`foldTurnSteps`, `turnSteps`), `components/TurnSteps.tsx`, `ThreadItems.tsx`.
- One-box new card: `lib/use-one-box.ts`, `lib/one-box.ts` (chips, pills, composer look), `components/NewCardOneBox.tsx` (the phone's layout: project chips, where + model pills, More).
- Three piles: `lib/three-piles.ts` (order, labels, the `weft-simple-opened-columns` cookie), `components/BoardColumns.tsx`.

Known gaps: the pane's
box has no instant echo or @mention check; Backlog's strip shows only when the board would show Backlog; the
command palette, weft.zip and the phone still say Running and Review; shared threads fold for a viewer in Regular.

## The preset

Simple mode **is** the existing regular mode, extended: `boardMode()` in `lib/board-prefs.ts` (`weft-board-mode`
cookie, `useRegularMode()`), switched from Settings → General → **Advanced mode** (off = simple). Regular mode
already strips the board's chrome (`AdvancedOnly`, `HeaderBadges`, `BoardHeader`, `ProjectBar`, `CardFooterMeta`,
the list view), and the welcome dialog already picks it for a new install (`components/WelcomeDialog.tsx`), so
**new installs start simple** with no change. An existing board stays advanced until you flip it.

- **Existing boards switch once.** The update that brought simple mode moves a board still on advanced to regular the
  first time it loads, with a toast that says so and a **Switch back** button (`lib/simple-switch.ts`, called from
  `Board.tsx`). A `weft-simple-switched` cookie marks it done, so switching back (or Settings) is never undone.
- **Escape steps through the views.** On a bare board (no card, dialog, browser or loose drawer open), Esc goes
  Simple → Board → List → Simple (`lib/view-stops.ts`, from `lib/use-escape-view.ts`); Simple is regular mode, Board
  and List are advanced with that view. The hint that pops up names the view and the next one, in simple mode too.
- Each first-cut piece below is its own cookie toggle in `lib/board-prefs.ts` (same pattern as `showBacklog`), and
  regular mode turns them on as its defaults: a toggle with no cookie of its own follows the mode, so you can keep one
  piece in either mode.
- The setting's label moves from "Advanced mode" to a **Simple mode** switch when the first piece lands, with the
  pieces listed under it (`components/SettingsGeneralPage.tsx`, `lib/settings-search.ts`).

## First cut

### 1. Full-page pane (`weft-pane-full`)

The page takes the whole pane. The show rail (`components/ShowRail.tsx`, 72 px) folds into a pill in the pane's tab
bar (`components/PaneTabs.tsx`): `⧉ 7`, the count of minis. Clicking the pill opens the rail and clicking again
folds it. The page is a native view, so no DOM can float over it: opening the rail shrinks the page, which is the
same flex layout as today.

When the page fills the pane, the pane works the way it does on the phone (docs/architecture/mobile.md, "the pane
is the app"). Under the page:

```
┌───────────────────────────────┐
│  page, full width        ⧉ 7  │  pill = the folded rail
│                               │
├───────────────────────────────┤
│ ● Editing lib/foo.ts…         │  live line: status dot + latest step or last sentence
│ [Monthly] [Yearly]            │  card.pending → answer / Allow / Deny
│ [ Reply…              ] 🎙 ■  │  the shared Composer, mic toggle, Stop while running
└───────────────────────────────┘
```

- **The composer is not new.** It is `components/Composer.tsx` in its compact layout, with `ComposerMicButton` and
  `DictationPill` (docs/architecture/dictation.md) for toggled voice recording, posting through the thread
  transport (`lib/thread-transport.ts`) like `ReplyBox`. The thread panel and the full-page pane render the same
  component, so a fix to one is a fix to both.
- **The live line and the pending row** come from shared logic in `packages/weft-client`. The dot uses `status.ts`
  and the rail's dots (`show-rail.ts`), and the answer buttons use `pending.ts`. The desktop, weft.zip and the phone
  all read these same functions. The phone (`~/dev/weft-mobile`, `src/components/Composer.tsx`, `AskBar.tsx`) should
  move onto the same helpers as it can. Its UI stays React Native, but the logic is shared.
- The thread column is hidden too, as on the phone, where the pane is the app. The live line ("Thread ›") opens it,
  and then there is still one composer: the strip under the page goes, the thread column keeps its own reply box and
  ask in the phone's look (`ReplyLookContext` in `lib/reply-elsewhere.ts`, read by `components/ThreadFooter.tsx`), the
  page runs the full height, and "Hide thread" sits in the pane's toolbar beside the pill (`components/HideThread.tsx`).
  The board's card list folds away meanwhile (`BoardSidebar`'s `folded`). With the thread hidden, the strip runs
  under the whole card and the columns leave their own box out (`ReplyElsewhereContext`). Both toggles live in memory
  for the session (`lib/pane-rail-open.ts` over `lib/session-flag.ts`, `lib/use-pane-full.ts`).

**The phone composer and voice mode.** With the piece on, `PaneBottom` hands `ReplyBox` `look="phone"`, which it passes
to the same `Composer` (no fork): one rounded box, the words on top and one row of round buttons under them
(`components/ComposerPhoneRow.tsx`): ＋ (the file picker; paste and drop still work), then the mic (dictates into the
field, as today), 〰 and the reply box's `components/ReplyPhoneActions.tsx` (Continue and Done as small words, Stop ■
while the turn runs, a filled Send ↑ once there is something to send, doing what Enter does: queue, after the next tool
call, answer). The format bar, H, Markdown view, model picker and Send later's menu are left out; Enter, Shift+Enter,
@ and / and the mode chip stay. 〰 turns on voice mode (`lib/voice-mode.ts`, `lib/use-voice-mode.ts`; `weft-voice-mode`
in localStorage, one switch for every composer until ⌨ turns it off, like the phone's `useVoiceMode`): the field gives
way to `components/VoiceBar.tsx`, "Press Space to talk". Space or a click starts the composer's own `useDictation`
(whisper in the renderer, not the desktop pill, so the words come back to it), the bar pulses with the level and the
seconds, and Space again stops: the words go in beside any attachments and out at once (`voiceAction`: an empty box's
Continue becomes Send). Esc drops it; a spinner shows while it transcribes. New thread's one-box doesn't use the look yet.

### Living pages (every thread's page)

A builder thread keeps one page in the pane the way a research thread does: living blocks at the top edited in place
(Plan, What changed, How to check), a section per turn appended, everything a turn didn't touch folded into an
accordion, and each turn ending with one `focus` on what changed. One kit for both: the research skill's
`kit/research.css` + `research.js` (which label sections "Turn" under `<body data-unit="Turn">`), copied with its rules
(`lib/page-kit-rules.ts`) to `~/.weft/show/_kit/` by `lib/page-kit.ts` when a card starts; `BROWSER_PROMPT` points
every thread there. It's in the prompt for all threads, not only simple mode: the prompt is built on the server, which
doesn't see the board's cookies.

### 2. Fold tool steps (`weft-fold-turn-steps`)

`components/ToolRun.tsx` already folds each run of tool calls into one line ("Ran 3 commands, read 2 files…"). Simple
mode goes one step further and merges every run in a turn into a single line, `Weft ran 14 steps`. Prose, pictures,
questions and permission prompts stay. Screenshots stay visible, as they do today. Find in the thread still opens
the line (`lib/find-reveal.ts`). The grouping is pure: write it in `lib/` next to `describeToolRun` with tests.

### 3. One-box new card (`weft-simple-new-card`)

`components/NewCardDialog.tsx` shows the composer and attachments only. The agent, model, isolate and permission
controls (`NewCardDialogControls.tsx`) are hidden, and the card uses the project's defaults
(`packages/weft-client/src/new-card-form.ts`). A "More" link opens the full controls for that one card. It is the
same `Composer` as #1.

### 4. Three-pile board (`weft-three-piles`)

The board isn't a kanban: it is one narrow list on the left (280 px), like a chat app's conversations
(`components/BoardSidebar.tsx`). Sections run **Needs you · Working · Ready** (`needs_you`, `running` and `review`,
renamed in simple mode only), each a header with its count over compact rows: the column's dot (pulsing while it
works), the title and its age. Then Backlog and Done, shut to a header with a count that opens on a click
(`sidebarSections` in `lib/three-piles.ts`, the `weft-simple-opened-columns` cookie). A row opens its card as a card
on the board does, and a right-click opens the board's own card menu. The rest of the board is the command center: the
board's browser pane, or the open card or New thread, which sits inside the board beside the list at its full height,
with no window and no backdrop (`components/BoardFrame.tsx` passes `CardFrame` its `inBoard` from `useSurfaceMode`, and `lib/use-board-slot.ts`
measures the sidebar and the frame's own origin, so the header, project tabs and filters above stay in reach). Cron runs fold under their thread; there is no drag and drop.

Wiring: `useSurfaceMode` (`lib/use-board-sidebar.ts`) turns the board's view into `"sidebar"` while the piece is on
and the view is the board; `components/BoardBeside.tsx` draws the sidebar and then the board's pane, and
`BoardSurface` leaves the space beside them. The list view and advanced mode are unchanged. weft.zip's board doesn't use
the sidebar and still draws the three piles as columns with Backlog and Done as strips (`components/BoardColumns.tsx`).

## Later (from the brainstorm, not in the first cut)

- Just-in-time drawers: 🔐 🪝 🚀 on the left rail hidden until a thread needs one.
- Pane without an address bar: page title + Back. The url is the title's tooltip; clicking the title copies the url.
- One **Ship it** at the end of the review tour (commit, push, deploy).
- Rail opens by itself while a turn runs and folds when it ends.

Stage names (Planning, First shot, …) stay as they are in simple mode.

## Rules for mini apps and pages

The pane's page is clipped at its own bounds, whether or not the rail is showing. Popovers and tooltips must stay
inside `innerWidth` and `innerHeight` (flip them at the edge). The growth app's `showTip()` does this.
