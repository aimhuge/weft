# Commit walk-through and the uncommitted pile

Review cards stack up while a project still has uncommitted work: several threads' edits end up mixed in
one working tree, with no obvious commit boundary between them. The "commit walk-through" is the card
that asks the agent to commit that pile one Review card at a time, using only each card's own files.

## Where it shows up

- **Pile counter (`components/PileBadge.tsx`).** The header's "+N/-N" button beside the code quality badge
  — lines added and removed in the project in view's repo. Clicking it starts the walk-through card for
  that repo.
- **"Review all" (`components/ColumnHeader.tsx`).** A button on the Review column's header, shown when
  the column has cards. Starts the same walk-through card for the project's repo and opens it right away
  (`startPileReview` in `lib/pile-review.ts`, which `Board.tsx` hands `improveQuality` and `select`), so the
  tour doesn't land unseen among the other Review cards. The badges' `onStart` resolves to the new card's id,
  so the pile counter and the Backlog planner can open theirs the same way later.

Both call `fetchPileReview(cwd)` from `lib/pile-review.ts` — a small shared helper that GETs `/api/pile`
with `prompt=1`, returns `{ prompt, title }`, falls back to a default title when the server omits one, and
rejects with the server's `error` (or "Nothing uncommitted to walk through." when the response has no
prompt).

## Server side

`/api/pile` (`app/api/pile/route.ts`) is the endpoint both badge and column hit. Without `prompt=1` it
returns the pile's `root`, `files`, `added`/`removed` counts and the number of Review cards in that repo
(the counter uses this to show numbers). With `prompt=1` it returns the walk-through's first message.

That first message comes from `lib/commit-pile.ts`:

- `readPile(cwd)` runs `git status --porcelain -z` and `git diff HEAD --numstat` on the repo root
  (or returns `null` if cwd isn't in a git repo or the tree is clean).
- `parseStatus` and `parseNumstat` turn the porcelain output into a `Pile` (files, added, removed).
- `mapPile` pairs each uncommitted file with the cards that touched it: a file only one Review card
  touched goes to that card; a file several Review cards touched is "shared"; one only a still-running
  card touched is "busy"; one nobody touched is "unclaimed".
- `pilePrompt(...)` builds the walk-through's first message: the safety rules (no `git stash`, no
  `git add -A`, commit only by path with `/weft:done`'s commit.sh), the per-card file list, the shared
  / busy / unclaimed buckets, and the checklist page the thread is asked to write.

## Page-level commits (the buttons)

The walk-through card writes a checklist page with one review bar per change. The buttons ("Commit",
"Commit and push", "Commit and run /done") are `weft://commit?...` links; the page itself doesn't run
them. `lib/pile-commit.ts` is the other half: `commitFromPage` runs `/weft:done`'s commit.sh on the
exact paths the page gave, pushes if asked, moves the change's card to Done if asked, and returns the
result to the page as a `weft-commit` window event. A failure becomes a thread message, so a turn only
runs when something went wrong. A shared doc commits only the change's own lines: see "Markdown blocks and
own-line commits" in `thread-guards.md`.

## Key files

- `app/api/pile/route.ts` — the endpoint (pile summary with no `prompt`, walk-through prompt with
  `prompt=1`).
- `lib/commit-pile.ts` — pile parsing, the card-to-file map, the walk-through prompt.
- `lib/pile-review.ts` — the shared `fetchPileReview(cwd)` helper used by both entry points.
- `lib/pile-commit.ts` — the page button handler (`commitFromPage`), the path-safety check, the move to
  Done.
- `components/PileBadge.tsx` — the header counter.
- `components/ColumnHeader.tsx` — the per-column header; Review gets the "Review all" button.
- `components/Board.tsx` — the `reviewAll` handler wired into the Review column.

## Tests

- `lib/commit-pile.test.ts` — `parseStatus` (renames, copies, clean tree), `parseNumstat` (binary files),
  `inRepo` (sibling look-alikes), `mapPile` (shared, busy, unclaimed buckets), `pilePrompt` shape, and
  `readPile` end-to-end against a tmp repo.
- `lib/pile-review.test.ts` — the happy path (with the URL-encoded `cwd`), the title fallback, and the
  two error shapes (server's `error`, missing `prompt`).
- `lib/pile-commit.test.ts` — `parseCommitRequest` (bad paths, empty), `safePath` (no `..`, no leading
  `-`), and the chain.
- `components/PileBadge.test.tsx`, `components/ColumnHeader.test.tsx` — the badge hides when the pile
  is empty, the counter and "Review all" both call the helper, the button disables while a turn starts
  and hides on an empty column.
