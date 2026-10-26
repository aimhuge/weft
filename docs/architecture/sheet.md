# The sheet

A table that reads like a slightly futuristic Google Sheet: frosted glass over the theme, grid lines across and down,
a numbered gutter, a header that stays put; a click on a header opens a type-ahead filter, a number or date column
flips its sort on a click, and typing anywhere starts the search. The board's list view is built on it, and so is
the superadmin Users page.

## Where it lives

The kit is `@aimhuge/sheet` in `aimhuge/components` (`packages/sheet`, its README is the reference), installed from a
tag like the other `@aimhuge` packages: `github:aimhuge/components#v0.9.0&path:/packages/sheet`.

- `@aimhuge/sheet` — pure: `SheetSpec` / `SheetColumn` (values, filter, number, rank, flip, sort names, and the
  search's column, text and wording), `sortRows` / `sortItems`, `rowPasses`, `valueCountsOf`, the sort and filter
  steps, `parseSheet`, `timeBucket` / `TIME_ORDER`, the type-ahead (`matches`, `typeahead`, `stepHighlight`) and the
  key rules (`sheetKey`).
- `@aimhuge/sheet/client` — `SheetTable`, `SheetHeader`, `SheetFilterMenu`, `SheetPopover` / `PopSearch`,
  `useSheetState` (saved per storage key), `useSheetKeys` (type to search, Space leaders, `blocked`), `useNow`.
- `@aimhuge/sheet/sheet.css` — imported in `app/globals.css`, with its `--sheet-*` colours mapped to Weft's tokens on
  `:root, [data-theme]`, so every theme and scene follows.

To change the kit: edit `packages/sheet` in `~/dev/components`, test and build there, release a tag, and bump the tag
here. A `link:` to the working copy doesn't work for Weft: the package's files resolve `react` from components' own
`node_modules`, a second React, and every hook breaks.

## What Weft keeps

- **The board's list view** (docs/architecture/board.md): `lib/list-sheet.ts` is its spec (`BOARD_SHEET`) plus the
  board's names for the kit's functions; `lib/list-tree.ts` adds bands and the card tree, `lib/list-keys.ts` the
  Space leaders (B Backlog, R Running) and the kept keys (j, k, ?, /), `components/use-list-keys.ts` what counts as
  open over the board (a dialog or a thread), `components/list-grid.css` the widths and the container queries that
  drop columns on a narrow board, `components/list-sheet.css` the folds, tree lines, crons and quick add.
- **Superadmin Users** (docs/architecture/admin.md): `lib/users-sheet.ts` is its spec (User search on name and
  email, Provider, Joined and Last seen filters and flips, ID); `app/(admin)/admin/users/UsersTable.tsx` loads every
  account 200 at a time (`/api/admin/users` takes up to 200) and hands them to `SheetTable`.

## Adding a sheet

Write a spec in `lib/` (columns and search, with tests), render `SheetTable` with every row, a `cells` map for the
columns that need more than their values, the widths, and a storage key of its own.
