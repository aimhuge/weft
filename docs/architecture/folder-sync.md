# Synced folders over the session line

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
  pull or a checkout on one side pauses it until the other matches (push and pull); the files stay as they are.
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
- **A status chip.** The menu item's check is the only on-screen sign; a paused sync says why only in the log.
- File modes beyond keeping an existing file's, staged-versus-unstaged state, submodules and LFS.
