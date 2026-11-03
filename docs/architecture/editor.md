# The editor column

An open card is four columns side by side: **thread · editor · pane · show**. The editor opens files from
the card's folder: code in CodeMirror 6, markdown in a TipTap editor that edits the rendered document, and a
**Changes** view of the file against git HEAD. The thread shows each Edit/Write's diff on its own row, and any
file path in the thread opens the file in the editor.

## Four columns

- `lib/workspace-layout.ts` is the pure model: `COLUMNS` in order, `open` and `width` per column, `MIN_WIDTH`,
  and the **fill** column (pane, else editor, else thread, else show) that takes what's left while the others keep
  their widths. `dragDivider` moves the divider between two neighbours, changing whichever of them isn't the fill
  column (it grows as the divider moves away from it) and clamping to the minimum widths; `fitToWidth` shrinks the fixed columns when the window is narrow;
  `toggleColumn` never closes the last open column.
- `lib/use-workspace-layout.ts` keeps it in localStorage (`weft-workspace-layout`) and holds the `dragging` flag.
  Its `dragDivider` reads the store's latest layout, because a divider binds its pointermove handler once at pointerdown.
- `components/CardWorkspace.tsx` draws the columns, a 6px divider between each pair of open columns (right after the left one, so
  thread | ✏︎ strip | pane still resizes), and an 18px strip with the
  column's icon in place of each closed column; click the strip to reopen it. The closed editor gets no strip while the
  thread shows: `components/EditorToggle.tsx`, the ✏︎ beside the thread's X, opens and closes it instead. While a divider drags, the native browser
  view is hidden (it would swallow the pointer), the same way `BrowserPane`'s own resize handle used to work.
- ⌥⌘1–4 toggle the thread, editor, browser and show columns while a card is open (`components/board-shortcuts.ts`).
- The pane's × now closes the pane column. The card closes from the thread header's ×, the backdrop or Escape.
- The show rail is its own column now; `BrowserPane` still takes a `rail` prop for the board's pane without a card.

## Opening a file

`lib/open-file.ts` is one window event, `weft:open-file`, carrying `{cardId, path, line?, diff?}`. `openFile()` also
queues the request: the board opens the editor column when it hears one for the open card (`onOpenFile`), and the
editor, mounted a moment later, takes the queue with `drainOpenFiles(cardId)`. A request's `line` rides on its tab
(`setLine` in `lib/editor-tabs.ts`, applied by `lib/use-editor-column.ts`, not persisted) and `EditorColumn` passes it to
`CodeEditor`, which scrolls to it when the file's view is built. Callers:

- a file named in a thread message, in prose, in inline code or as a markdown link (`[x](lib/a.ts:9)`). Names are matched
  against the folder's real file list (`lib/file-refs.ts`), so only files that are there link: a full or absolute path, a
  unique tail (`api/cards/[id]/files/route.ts`), a unique bare name (`ToolLine.tsx`), or a folder with one entry file
  (`/api/cards/[id]/files` opens its `route.ts`), each with an optional `:line`. `Next.js`, `weft.zip` and ignored files
  like `.env` stay plain. `lib/use-file-index.ts` reads the list through the transport's `listFiles` when the thread opens and
  again as it grows (at most every 15 s); `lib/remark-file-links.ts` turns prose mentions into `weft-file:` links that
  `components/Markdown.tsx` draws as buttons. The contexts (`components/file-link-context.ts`) are set only by `ThreadView`,
  so the copilot and share pages stay plain, and weft.zip (no `listFiles`) links nothing;
- a tool row's path (`item.file`), with an "open diff" link on edit rows;
- the permission prompt's file.

## Files on the server

`lib/file-access.ts` + `app/api/cards/[id]/files/route.ts`, called through `lib/client-files.ts`:

| Call | What it does |
|---|---|
| `GET ?path=` | the file as `{path, exists, text, hash, mtime, size}`; a missing file reads as `exists: false` |
| `GET ?path=&op=stat` | mtime and size only, for the editor's 2 s poll |
| `GET ?path=&op=head` | `git show HEAD:./<path>`; null when untracked or not a repo |
| `GET ?op=list` | `git ls-files --cached --others --exclude-standard` (capped at 20,000), else a bounded walk |
| `PUT {path, text, baseHash}` | writes atomically (temp file + rename); 409 with the file as it is now when `baseHash` doesn't match |

Paths resolve against the card's `cwd` with the deepest existing ancestor realpath'd, so a symlink can't lead out.
Anything outside the folder, inside `.git/`, or a secret file (`isSecretFile`, the `.env` family) is refused. Reads stop
at 2 MB, and binary files (a NUL byte in the first 8 KB) are refused. GETs pass `guard(req, {write: false})` and the PUT
needs `x-weft-token: 1`, like every other route.

## The editor

- `lib/editor-tabs.ts`: the tabs per card (`{path, mode}`, `edit` / `changes` / `source`), saved under
  `weft-editor-tabs:<cardId>`; absolute paths inside the folder become relative, outside ones are dropped.
- `lib/use-open-file.ts`: one tab's file. It loads the file and tracks saved vs. edited text and the hash it was read at.
  `save()` sends that hash, so a file the thread changed meanwhile comes back as a conflict (the banner offers **Reload**
  or **Overwrite**) instead of being overwritten. While the tab is visible and has no unsaved edits, it polls `stat` every 2 s and
  reloads when the thread edits the file. An edited tab that changes on disk gets the same banner.
  A worker card's file can't afford the poll (`live: false`); over the worker's session line it is watched instead
  (`files.watch`, `lib/line-file-watch.ts`), and `lib/use-file-watch.ts` re-reads it on each pushed hash under the same
  rule: a clean tab reloads, an edited one gets the banner. Without a line it reloads when reopened.
- `components/EditorColumn.tsx` (+ `EditorColumnPills.tsx`): the tab strip (name, unsaved dot, ×), the mode menu,
  ⌘S, ⌘P (`components/QuickOpen.tsx`, fuzzy over the file list), ⌘W, the empty state and the conflict banner. The three
  editors load lazily, so the board's bundle doesn't carry them until a file opens.
- `components/CodeEditor.tsx`: CodeMirror 6; the language comes from `LanguageDescription.matchFilename` over
  `@codemirror/language-data`, loaded on demand; colours come from Weft's CSS variables, so it follows themes and scenes.
- `components/DiffEditor.tsx`: **Changes**, `@codemirror/merge`'s `unifiedMergeView` against HEAD, editable, with a
  revert button per chunk and unchanged runs collapsed.
- `components/MarkdownEditor.tsx`: TipTap (StarterKit, `@tiptap/markdown`, `@tiptap/extension-table`) on `.md`/`.mdx`, with
  a **Source** mode. A markdown round trip rewrites spacing, tables and HTML, so a save goes through
  `lib/markdown-preserve.ts`: a diff3 merge of (editor's markdown right after load → editor's markdown now) onto the
  original text, so only the lines you changed are replaced and an untouched file saves byte for byte.

## Diffs in the thread

`lib/runner-turn.ts` stores `edit` (an `EditPreview` from `lib/edit-preview.ts`, capped at 40 lines) and `file` on each
Edit/Write/MultiEdit/NotebookEdit tool item when the call is made, so a Write diffs against the file before it's written.
`components/EditDiff.tsx` draws it in the tool row (`components/ThreadItems.tsx`) with a "+A −R" chip, and the
permission prompt uses the same component.

## Gaps

- The editor column is desktop only; the weft.zip board's thread renders file links, but nothing listens for them.
- An editor save doesn't take a symbol claim (`lib/claim-guard.ts`), so a busy thread isn't warned before it edits
  a file you have open; the hash check on save and the live reload cover the clash after the fact.
- Columns resize but don't reorder.
