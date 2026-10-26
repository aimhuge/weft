# Isolated cards (opt-in worktrees)

Cards share one working tree by default (SOUL.md: shared by default, isolated when it's worth it). Symbol claims
(`lib/claim-guard.ts`) and Bash claims (`lib/bash-claims.ts`) stop two cards from editing the same code at once, but
they can't stop a card from running tests, typecheck or a dev server against another card's half-done edits, or from
sharing one git index with it. An **isolated** card gets a git worktree of its own for that: its CLI, its Bash, its
dev server and its commits all live there, and on Done Weft lands its branch back on the main tree, fast-forward.

Isolation is opt-in per card. With it off, nothing here runs: no git call, no pool, nothing on the start-a-card path.

## Data

`Card.isolated` (asked for) and `Card.worktree` (`CardWorktree`, once it has one):

| Field | What |
| --- | --- |
| `path` | `~/.weft/worktrees/<repo>/<id>`: never inside the project folder, so no stray folders in it |
| `branch` | `weft/<card-slug>-<id6>`, or `Card.worktreeBranch` when you picked or named one |
| `base` | the main tree's HEAD commit the branch started from |
| `repo` | the main tree's root (the project the card lands on) |

`card.cwd` stays the project folder: the board's project chips, overlap counts, skill sets, sync folders, the
changelog and webhooks all keep reading it. Everything that runs code reads `workDir(card)` (`lib/worktrees.ts`)
instead: the worktree's path when the card has one (with the card's subfolder of the repo, if `cwd` was one), else `cwd`.

`<repo>` is the main tree's folder name plus 6 hex of its path's hash (`weft-3fa2c1`), so two repos both called
`app` don't share a folder.

## lib/worktrees.ts

Plain git over `execFile` (no shell), each call with a timeout:

- `createWorktree(repo, id, base?)`: `git worktree add --detach <path> <base>`.
- `listWorktrees(repo)`: `git worktree list --porcelain`, only the ones under `~/.weft/worktrees/<repo>/`.
- `removeWorktree(repo, path, branch?)`: `git worktree remove --force`, then `git branch -D` (only Weft's own
  `weft/*` branches), then `git worktree prune`. Called only for a pool entry, a landed card, or a card you delete.
- `branchFor(card)`, `repoKey(root)`, `workDir(card)`: names, no git.

## The warm pool (lib/worktree-pool.ts)

Making a worktree is cheap; its dependencies aren't. Measured on this repo (measured 2026-10-25: ~2,200 files,
1.5 GB hoisted `node_modules`, M-series Mac, APFS):

| Step | Time |
| --- | --- |
| `git worktree add --detach` | 0.5 s |
| `cp -c -R node_modules` (APFS clone: copy-on-write, no bytes copied) | 12.8 s |
| `pnpm install --offline --frozen-lockfile --ignore-scripts` on top of the clone | 1.2 s |
| `git worktree move` + `git switch -c weft/…` (taking one) | ~20 ms |

So the pool does the 15 seconds ahead of time and taking one is a move and a branch. Per repo it keeps
`settings.worktreePool` ready (default 1, 0 turns the pool off), named `pool-<random>`:

1. **Fill** (`fillPool(repo)`): `git worktree add --detach` at the main tree's HEAD, then the dependencies: an
   APFS clone of the main tree's `node_modules` when it has one (`cp -c`, which fails rather than copies on a
   volume without clones; then a plain install), then the lockfile's own offline install (`pnpm install --offline`,
   `npm ci --prefer-offline`, `yarn install --offline`), falling back to `--prefer-offline`. Background only.
2. **Freshen** (on the scheduler's tick, `freshenPools()`): an idle entry whose HEAD is behind the main tree's is
   checked out at the new HEAD (`git checkout --detach`, clean tree, milliseconds), and reinstalled only when the
   lockfile changed.
3. **Take** (`takeWorktree(card)`): the newest ready entry, `git worktree move` to the card's path, checked out at
   the main tree's HEAD if it moved, `git checkout -B <branch>`. With a `worktreeBranch` that already exists, the
   entry checks that branch out as it is instead (never moved or reset; reinstalled if its lockfile differs), and a
   branch checked out in another worktree (the main tree's own, say) is refused up front, naming where: git won't
   check a branch out twice. A new name is made at HEAD like `weft/*`. With no entry ready, it makes one on the spot (the
   15 s path) and says so in the log. Then it refills in the background.
4. **Return** (after landing): the worktree is clean at the landed commit; its `weft/*` branch is deleted (merged;
   a branch you named stays), it
   moves back to `pool-<random>`, unless the pool is full, when it's removed.

Which repos get a pool: the ones an isolated card used in the last 7 days (`~/.weft/worktrees/repos.json`, three at
most), plus the folder the New thread dialog has open while its Isolated switch is on (like `ensureSpare` for the
CLI). A repo nobody isolates in never gets one.

## Running in the worktree

- **The CLI**: `specFor(card)` (`lib/runner-state.ts`) starts it with `cwd = workDir(card)`, Codex (`--cd`) and
  Goose (the process cwd) too. An isolated card doesn't take the project's warm spare CLI (it was started in the
  project folder); its CLI starts cold, a second or two.
- **Folder gate** (`lib/folder-guard.ts`): reads the hook's `cwd`, which is the worktree, so the worktree is the
  card's project. `~/.weft` is free for every thread, except `~/.weft/worktrees/`: another card's worktree is outside
  your project like any other folder. So is the main tree, for an isolated card.
- **Git guard** (`lib/git-guard.ts`): a card's own worktree is its own, so `reset --hard`, `checkout -- path`,
  `restore` and `clean -f` there only throw away its own work and are allowed when the command runs inside that
  worktree. `git stash` stays refused (`refs/stash` is shared by every worktree of a repo, so a pop in one applies
  another's), and so do the pre-commit hook rules.
- **Claims** (`lib/claims.ts`, `lib/bash-claims.ts`, `lib/overlap.ts`): claims name real file paths, and a worktree's
  files have their own, so an isolated card never clashes with the shared tree. `busyInFolder` compares `workDir`s,
  so the overlap warning and claim checks only count cards in the same tree.
- **Vault**: the vault is keyed by the repo's GitHub remote (`electron/vault.cjs` `vaultIdFor`), which a worktree
  shares, so `mcp__secrets__run` and a dev server's development values work unchanged.
- **Dev servers** (`lib/devserver.ts`): start in `workDir(card)`. An isolated card's server gets `PORT` set to a
  free port of its own when the command doesn't name one, so it doesn't fight the main tree's server on 3000;
  the tool's reply names the port.
- **`!` shell** (`lib/shell.ts`): runs in `workDir(card)`.

## Landing (lib/worktree-land.ts)

On a Done move the card's `/weft:done` turn runs in the worktree as usual and commits there (`ISOLATED_PROMPT` in
`lib/weft-prompts.ts` tells the thread it is isolated: commit on the branch, skip `push.sh` and `deploy.mjs`; Weft
lands it). When that turn ends well (`settleWrapUp` in `lib/runner-turn.ts`; a wrap-up ending in Review or failing
doesn't land), or at once when there's no wrap-up turn (`archiveWhenIdle`), `hooks.land` runs `landCard`
(`lib/worktree-done.ts`) over `landWorktree` (`lib/worktree-land.ts`):

1. Commits whatever is left uncommitted in the worktree (`git add -A`, the card's title as the message), with the
   pre-commit hook.
2. Rebases the branch on the main tree's current branch (`git rebase <branch>` in the worktree). A conflict:
   `git rebase --abort`, and the card goes back to the thread: Running, with a message naming the files and the
   steps (`git rebase <branch>`, resolve, `git rebase --continue`, then move to Done again).
3. Fast-forwards the main tree: `git -C <repo> merge --ff-only weft/<slug>`. Git updates only the files the commits
   changed and refuses, touching nothing, when one of them has uncommitted changes in the main tree (another
   card's work). Weft never stashes, resets or checks out paths in the main tree (`lib/git-guard.ts`). That refusal
   goes back to the card too, naming the files and whose they are, and the card waits in Review.
4. Pushes the main tree's branch with a plain `git push` when it has an upstream and Settings' Push on Done is on.
5. Returns the worktree to the pool (or removes it), clears `card.worktree` and its claims, and files the card away
   ("Landed on main (abc1234), pushed"). The card stays `isolated`: a reply after Done takes a fresh worktree from a
   HEAD that now holds its work.

Landing a branch you picked rebases it like a `weft/*` one, so a picked branch that was pushed diverges from its
remote; Weft doesn't push it (only the main tree's branch).

A card you delete takes its worktree with it; its branch stays when it has commits that never landed (`git branch -d`).

The main tree's HEAD can move between steps 2 and 3 (another card landed); the merge then isn't a fast-forward,
so it rebases once more and retries.

## UI

- **New thread** (`components/IsolateMenu.tsx` in `components/NewCardDialogControls.tsx`): one chip beside the folder
  picker, not a new row, reading Shared, the branch, or "Worktree". It reads "Isolate?" with an amber dot when
  `busyInFolder` finds busy cards in the folder or the prompt is over 1,500 characters (`suggestIsolate`,
  `lib/use-isolate.ts`); the "Also running here" line hides while it's on. It opens a menu: a Shared / Worktree
  switch, and with Worktree a branch picker (`lib/use-branches.ts` over `GET /api/worktrees?cwd=`, the repo's local
  branches newest first via `git for-each-ref`, `listBranches` in `lib/worktrees.ts`). Search filters them; one checked
  out in another worktree is greyed "in use"; a search that's a valid new name (`validBranch`, `lib/branch-name.ts`,
  also checked server-side in `lib/new-card.ts`) offers "Create". Enter takes the exact match, else the new name.
  Picking a branch turns Worktree on; another folder resets it to the card's own. The card's input sends `branch`,
  stored as `Card.worktreeBranch`. Switching to Worktree warms the pool for that repo (`POST /api/worktrees`).
- **The first send** (`lib/worktree-start.ts`): `sendMessage` holds an isolated card's message until `takeWorktree`
  gives it one, whichever way the turn starts (New thread, Backlog → Running, the scheduler). If none can be had (not a
  git repo), the card goes to Needs you, stops being isolated and says so; it never falls back to the shared tree on
  its own.
- **The card** (`components/CardMarks.tsx`): a `⑃` chip with the branch in its tip.

## Not built yet

- A Settings row for the pool size (it's `worktreePool` in `~/.weft/settings.json`, 0 to 3).
- `/weft:done`'s own isolated-card step: the thread prompt tells it to skip `push.sh` and `deploy.mjs`, but the skill
  and `push.sh` don't check yet. Proposed: a note at the top of Phase 4 and a `weft/*` skip in `push.sh` for a branch
  checked out under `~/.weft/worktrees/` (without it, a thread that runs `push.sh` anyway publishes its `weft/*` branch).
- A test for the fast-forward retry when another card lands between the rebase and the merge.

- A spare CLI kept warm inside a pool entry (the path changes on take, so the spare would have to move too).
- Isolation for picked-up Claude Code sessions (they keep their own cwd).
