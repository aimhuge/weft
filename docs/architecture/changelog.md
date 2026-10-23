# Changelog

Every project on the board gets a changelog that Weft keeps, not a `CHANGELOG.md` every card edits. Weft's own
`CHANGELOG.md` used to take a line from almost every card (68 commits in one week), and a markdown file has no
symbols, so a card's claim on it was the whole file (`lib/claims.ts`): the second busy card always got asked or
waited, and `/weft:done` committed other cards' lines with its own. Now a thread records an entry through a tool,
each entry links to the card that wrote it, the card's commit stamps it, and Weft writes and commits the file itself.

## The store

`lib/changelog.ts`: `~/.weft/changelog.jsonl`, one JSON event per line, append-only (like `activity.jsonl`).

| event     | what it does                                                                 |
| --------- | ---------------------------------------------------------------------------- |
| `add`     | a new entry: project (git root), kind, text, card id and title, time           |
| `edit`    | rewords or recategorises an unreleased entry                                  |
| `remove`  | drops an unreleased entry                                                     |
| `stamp`   | the card's commit landed: entries get the sha (`committedAt`)                 |
| `release` | a version went out: entries get the version (`releasedAt`)                    |

`fold()` turns the events into entries. A stamp or release never overwrites an earlier one, so a later commit of
the same card can't move an entry that already shipped, and a released entry can't be edited or removed. An entry
is **draft** (no sha), **committed** (sha) or **released** (version) — `statusOf()`. A project is its git root
(`projectRoot` in `lib/quality-files.ts`), so a card in a subfolder writes to its repo's changelog.

## Writing: the tools

`lib/changelog-tool.ts` adds three tools to every thread's board server (`weftMcpServer` in `lib/board-tools.ts`,
so Claude Code, puku-cli and Codex all get them); they skip the permission prompt (`SAFE_BOARD_TOOLS`), since they
only write the user's own log:

- `mcp__board__changelog_add { kind, text, folder? }` — kind is Keep a Changelog's (added, changed, fixed,
  removed, security); the calling card's id and title go on the entry.
- `mcp__board__changelog_list { all?, folder? }` — `id | kind | status | card | text`, unreleased unless `all`.
- `mcp__board__changelog_edit { id, text?, kind?, remove? }`.

SOUL.md's convention and `/weft:done`'s Phase 2 tell threads to call these instead of typing under Unreleased.

## The git stamp

`lib/changelog-stamp.ts`. A Bash PreToolUse/PostToolUse pair in `guardedCli()` (`lib/env.ts`): before a line that
looks like a commit (`git … commit`, `commit.sh`) it reads HEAD; after it succeeds it reads HEAD again, and if it
moved, the card's draft entries in that project get the new sha and the thread is told. Comparing HEAD means a
commit the pre-commit hook refused, or a line that only mentions committing, stamps nothing. The commit
walk-through's buttons commit without a turn, so `lib/pile-commit.ts` calls `stampAfterCommit` for the change's
card itself.

A commit that takes another card's lines ("shared files go whole") stamps only the committing card's entries; the
other card's stay draft until its own commit.

## The Supabase mirror

`lib/changelog-sync.ts` + `supabase/migrations/20261023153730_changelog_entries.sql`. While you're signed in, the
log is its own outbox: `~/.weft/changelog-sync.json` holds how many events went up and for which account, and a
sync upserts every entry the newer events touched into `public.changelog_entries` (a removed one goes up with
`deleted = true`). Rows are keyed `(user_id, id)`, `user_id` defaults to `auth.uid()`, and RLS lets an account read
and write only its own. It runs 3 s after a change (`watchChangelog`, debounced) and on the league timer
(`startLeagueSync`). Every project is mirrored, not just `syncFolders`: an entry is a line a thread wrote to be
published, and the rows are private to the account. A missing table (an older Supabase) waits quietly.

## Reading: the Changelog dialog

`components/ChangelogDialog.tsx`, opened from the project menu (**Changelog of <project>**) and the palette
(**Changelog of …**, the open card's project or the most recent one). Its open flag lives in
`lib/changelog-open.ts` (a `useSyncExternalStore` store) rather than in Board; `lib/use-board-dialogs.ts` counts it
as an overlay so the native browser pane hides under it. It lists Unreleased, then each version newest first
(`lib/changelog-view.ts`), each entry with its state (draft, committed `abc1234`, `abc1234 · 1.2.0`) and **↗ card
title**, which closes the dialog and opens the card (`selectCard`).

## Writing CHANGELOG.md: in the background

Nobody runs a release step. `lib/changelog-write.ts` `writeChangelog(root, label)` runs right after a card's commit
lands: from the stamp hook (before the thread's next call, so a push or tag that follows carries it) and from the
commit walk-through (before its push). It renders the project's `CHANGELOG.md` (`lib/changelog-render.ts`) and, if the
file is dirty, commits it alone (`git add` + `git commit -- CHANGELOG.md`, as `docs(changelog): <card title>`), so it
never takes anyone else's files. Writes queue one at a time across cards and wait out a moment of git's `index.lock`.

- **Unreleased** holds the committed, unreleased entries; drafts appear once their card commits. Lines typed there by
  hand stay, ahead of Weft's: Weft knows its own bullets by text (`textsFor`, every text an entry ever had), so rewriting
  the section never duplicates or drops one, and the switch needs no migration.
- **A version bump** — HEAD's commit changed package.json's `version` and the file has no heading for it — moves
  Unreleased under `## [version] - date` in the same background commit (`docs(changelog): X.Y.Z`) and marks the committed
  entries released. Tag after it: `scripts/release-feed.mjs` reads that section for the update notes
  (docs/architecture/updates.md).
- A project with no CHANGELOG.md and no committed entries never gets one.
- A refused commit (a pre-commit hook) leaves the file written; the thread is told, and the next write commits it.
  `scripts/check-staged.sh` stops after its secret scan when nothing staged is code, so this commit doesn't wait on a
  whole-tree typecheck.

`pnpm changelog:release <version>` (`lib/changelog-release.ts`, `scripts/changelog-release.ts`) is only the fallback for
a bump Weft didn't see: a Codex thread (no per-tool hooks) or a commit made outside Weft. It takes drafts too.

## Not built yet

- weft.zip doesn't show `changelog_entries` anywhere yet (a project's public changelog, a "shipped" feed on the
  profile).
- A reverted commit doesn't unstamp its entries.
- Entries on another Mac aren't pulled down; the mirror is one way.
- Codex threads don't stamp or write: they get no per-tool hooks.
