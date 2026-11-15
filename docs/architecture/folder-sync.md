# Synced folders over the session line

> The menu items named here now sit in a group per machine ([machines.md](machines.md)): Pull Uncommitted Work is
> **Bring Its Uncommitted Work Here**, Keep in Sync with <worker> is **Keep in Sync with This Mac**, Move to <worker> is
> **Move <project> There**.

Status: **first version built** (2026-11-14), this Mac ↔ a Weft Worker. The same project often lives on both: `weft` on
this Mac and `weft` on the worker. "Pull Uncommitted Work" ([wip-sync.md](wip-sync.md)) moves the work once, when you
ask, through the git remote. A synced folder keeps the two checkouts as one folder instead: a change on either side
reaches the other in a second or two, straight over the WebRTC session line, while Weft is open.

Turn it on from a project's right-click menu: **Keep in Sync with <worker>** (Touch ID once). Turn it off from the same
item; each side keeps its files as they are.

**Move to <worker>**, beside it, hands the project over: it turns sync on (Touch ID, if it wasn't) with this Mac leading
the first catch-up, so this Mac's version wins every clash and the worker keeps its own as `.conflict-` copies, then
ticks **Run on Worker** so new threads start there. Cards open on this Mac stay here. The lead (`lead()` in
`lib/mac-tree-sync.ts`, priority 900 against a worker's 1 or 2) ends once that catch-up is done, or after 10 minutes
without the line coming up; the folder stays in sync after (`moveToWorker` in `lib/tree-sync-menu.ts`).

## From your side of the screen

- **No direction to think about.** Edit on the Mac, a thread edits on the worker: both see both.
- **The side doing the work wins a clash.** When both changed the same file between syncs, the side with threads running
  there keeps its version; the other side's is kept beside it as `name.conflict-<machine>.ext` (and syncs too). Nothing
  is lost. With threads on both sides or neither, the higher machine id wins, so both agree without asking.
- **Pause, don't guess.** Sync runs only while both checkouts are on the same branch and the same commit. A commit, a
  pull or a checkout on one side pauses it until the other matches; the files stay as they are.
- **The side that is behind catches up by itself** ([Catching up](#catching-up)). Commit on the Mac and push: the
  worker fetches that commit and fast-forwards to it, and sync carries on. When it can't, the menu says why under
  **Keep in Sync** ("Paused: m1mini: 20 uncommitted files clash with newer commits").
- **What never syncs:** anything `.gitignore` hides (`node_modules`, build output), `.git`, secret files (`.env*`,
  `.envrc`, `.dev.vars`, not their `.example` templates: each machine keeps its own values in its vault), symlinks, and
  files over 20 MB. A change for one of those coming from the other side is refused there too.

## How it moves

```
this Mac: server                       board window                         worker
lib/mac-tree-sync.ts  ◀─ /api/tree-sync ─▶ lib/line-tree-sync.ts ─ tree channel ─▶ lib/host-line-tree.ts
  peer on the twin checkout          pipe: in batches, out by long poll     open checked (proof), then a peer
  watcher (lib/tree-sync-watch.ts)                                          on the project's checkout + watcher
```

- **One peer, both ends** (`lib/tree-sync-peer.ts`): the same code runs on the worker and on this Mac, so Mac ↔ Mac is a
  new line away, not a new protocol.
- **The wire** (`lib/tree-sync-protocol.ts`): `hello` (branch, HEAD, priority, every path not at HEAD), `change` (path,
  new state, the base it moved from, the bytes in base64), `prio`, `pause`, and `frag` for a message over 16 KB. A path's
  state is `"HEAD"`, `null` (deleted though HEAD has it), or the git blob id of what's on disk.
- **The engine** (`lib/tree-sync-engine.ts`, pure): a base per path, the state this end last knew the other to have. A
  path off its base changed here and goes out; a change coming in names its base, so a plain update (this end still on
  that base) is told from a clash. Bases persist in `.git/weft-sync/<other end>.json` with the HEAD they're relative to,
  so work done while the line was down just flows when it comes back.
- **The checkout** (`lib/tree-sync-fs.ts`): states from `git status` and `git ls-tree`, writes through a temp file
  renamed over the old (never through a symlinked folder out of the checkout), bytes checked against their blob id.
- **The board window carries it**, since it holds the session line ([project-hosts.md](project-hosts.md)): it opens the
  `tree` channel whenever the worker's line comes up (`keepSynced`, held from `useTreeSync` in the worker board hook), and
  pumps texts; the server's peer does the files. It holds the worker's line while a folder syncs.

## Catching up

Before 2026-11-16 a paused folder stayed paused: nothing moved a checkout to a new commit, a worker never pulls, and
on a repo that commits all day the two ends were level for minutes at a time. The reason sat in a log. Now, when the
hellos show different commits on the same branch, each end asks its follower (`lib/tree-sync-follow.ts`, the peer's
`follow`):

| This end | What it does |
|---|---|
| has the other's commit already (it's ahead) | waits; the other end is the one to move |
| doesn't see the commit on origin's copy of the branch | fetches the branch from `origin` (never twice within 20 s; for one commit, 20 s after a miss, then 40, up to every 5 min); still not there, "Waiting for commit abc1234 to be pushed" |
| is behind, nothing of its own in the way | fast-forwards (`merge --ff-only`, the repo's hooks off), says hello again from the new commit, and sync starts |
| is behind, a file changed here is changed by those commits to something else | moves nothing: "3 uncommitted files clash with newer commits (a.ts, …)" |
| has commits of its own too | moves nothing: "Each side has commits the other lacks" |

- **Uncommitted work stays.** A fast-forward leaves files the commits don't touch as they are.
- **A file that already holds the commit's version is not a clash.** That is the usual case: you edit on the Mac, the
  edit syncs to the worker, then you commit it. The worker's copy of that file is "modified" against its old HEAD, and
  git would refuse to fast-forward over it. The follower compares each file the commits change with what's on disk
  (its blob id against the old and the new one) and stages the ones already at the new version, which git then keeps.
- **The end that can't move tells the other** (a `pause` with its reason, once per hello), so the reason shows on the
  Mac whichever end is stuck. Both ends try again on every rescan (15 s), so a push, or a clash cleared by hand, is
  picked up without touching the menu.
- **In the menu.** `withNotes` (`lib/tree-sync-menu.ts`) reads this Mac's peer (`op: "status"`) when a project's menu
  opens, and the state rides on the item as its second line: nothing while in sync, else "Connecting…", "Not connected
  right now" or "Paused: …" (a reason's list of files stays in the log).
- **What it trusts.** The commit's name comes from the other end, which already may write any file here and must gain
  nothing more. It must be a full sha that is on `origin`'s copy of the branch this end is on (a commit merely present
  in the checkout, on another branch or in a stash, is refused), and it is only ever fast-forwarded to. The fetch and
  the merge run with the repo's hooks off and no gc.
- **What counts as this end's own work**, and stops the move: a file on disk that is neither the old version nor the
  new; the same in the index (something staged that isn't the commit's version); and a file sitting where the commit
  needs a folder, which git would otherwise remove to make room, even an ignored one.
- **The executable bit.** A file that synced over arrived without it (the wire carries bytes, not modes), so before
  staging, the follower gives each such file the bit its commit has.
- The Mac follows too: a thread on the worker that commits and pushes no longer leaves this Mac behind. To the
  threads running on the Mac it is what another card's `git pull --ff-only` already is: HEAD moves forward under them.

## Trust

Writing into a checkout from the network is as strong as a shell, so the line alone never opens a tree channel.

- **Turning sync on is yours, with Touch ID** (`POST /tree-sync/enable` in `electron/tree-sync-sign.cjs`). Main keeps the
  list sealed with safeStorage in `~/.weft/vault/tree-sync.json`, which threads can't read or edit, and only for a worker
  this Mac paired.
- **Each open is signed by this Mac's device key** (`POST /tree-sync/sign`), with no prompt, as a LAN offer is: main signs
  only for a folder on the list. The message (`weft-tree-sync-v1`, the worker id, the folder, the time, a nonce) can mean
  nothing else. The worker checks it against the Mac keys it pinned from its pairing code, within a minute of its clock,
  its nonce spent once (`lib/tree-sync-proof.ts`, `lib/worker-tree-sync.ts`), and the folder must be one of its projects.
- **This Mac's side** runs behind `elevated()` (`app/api/tree-sync`): only Weft's own window, never a thread's curl.
- **A twin found by name** (`lib/worker-twin.ts`) could be another repo with the same folder name; it can't be on the same
  commit, so the peer pauses before writing anything there.

## Not built

- **Mac ↔ Mac.** No line runs between two Macs yet; the peer is ready for one (signaling over Supabase between paired
  Macs, held by main rather than a board window).
- **Syncing with the board closed.** The line lives in the board window; close Weft and the two catch up on reopen.
- **A status chip.** The state shows in the project's menu, under Keep in Sync, and nowhere on the board itself.
- **Catching up over a clash.** A checkout with its own uncommitted changes to files the newer commits also change
  stays paused until those are committed or discarded there; nothing rebases them.
- **Filtered files.** A file under LFS, `eol=crlf` or a clean filter never matches its blob id on disk, so a range that
  touches one reads as a clash and stays paused; nothing is lost.
- **Bring Its Uncommitted Work Here** (wip-sync.md) still refuses when this Mac has commits the worker lacks; it doesn't
  use the follower yet.
- File modes beyond keeping an existing file's, staged-versus-unstaged state, submodules and LFS.
