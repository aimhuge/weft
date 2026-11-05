# File drop

Files dragged from Finder land anywhere in the window and reach the right composer.

## Key files

- `lib/file-drop.ts`: the hand-off store (`handFiles`, `takeFiles`, `onHandedFiles`, keyed by a card id or `NEW_THREAD`) and `dropSpotAt`, which reads where a drop goes from the DOM.
- `lib/use-file-drop.ts`: `useFileDrop` (window listeners and the hover outline) and `useHandedFiles` (a composer's side).
- `components/FileDrop.tsx`: the board's router and the "Drop to…" pill, mounted once in `Board.tsx`.
- `components/Composer.tsx`: the `dropTarget` prop, and drops on its bars or in its Markdown view.

## Data flow

1. `useFileDrop` listens on `window` for drags that carry `Files` (a card dragged between columns carries only `text/plain` and is ignored).
2. `dropSpotAt(event.target)` decides: over a `.composer` the editor takes its own drop at the cursor; over `[data-card-id]` it is a card; over `[data-drop-target]` (the open thread panel, the copilot's launcher, chat and window) it is that thread; anywhere else, a new thread.
3. The card or thread under the cursor gets `data-file-over` (outline in `app/globals.css`); the pill names where the files go.
4. On drop, `FileDrop` calls `handFiles(target, files)`, then opens the card (`openCard`) or New thread (`openNew`, skipped if it is already open).
5. The composer with that `dropTarget` (`ReplyBox` passes its card id, `NewCardDialog` passes `NEW_THREAD`, `ReviewPanelTour` passes its card id because it replaces the reply box) takes the files and runs them through `insertFiles` like a paste.

## Patterns

- Files wait in the store because the target composer may not exist yet (a closed card, a dialog not open). `useHandedFiles` takes the waiting files on the next task (`setTimeout 0`), not in the effect: TipTap's node views call `flushSync`, which React refuses during a commit.
- Every window drop is `preventDefault`ed, so Electron never navigates the board to `file://`.
- A drop over the native browser pane never reaches the window; it goes to the page shown there.
