# Pulling a worker's uncommitted work

Status: **first step built** (2026-11-12). The same project often lives twice on one board: `weft` on this Mac and
`weft` on a Weft Worker (the "weft m1mini" chip). Their commits meet on GitHub; their uncommitted work didn't meet at
all. A project's right-click menu now has **Pull Uncommitted Work from <worker>**: you sit down at this Mac, ask the
worker for what it has, and carry on from there.

## How it moves

```
this Mac                                              the worker
project menu: Pull Uncommitted Work from m1mini
POST /api/wip { folder, from: worker://<id>/weft }
lib/wip-pull.ts  ── host row, verb tree.snapshot { folder } ──▶ lib/host-api/tree-snapshot.ts
                                                       snapshotWip: throwaway index, add -A, commit-tree
                                                       pushWip: refs/weft/wip/<worker id> → origin
                 ◀── result.value: the snapshot, and how many threads were mid-turn ──
fetchWip: origin refs/weft/wip/<worker id>
applyWip: check, then make the working tree the snapshot's
```

- **Built when asked, never ahead of time.** Nothing is uploaded until the pull. The worker has to be online; an offline
  one greys the item out.
- **The carrier is the project's own git remote.** One hidden ref per machine, `refs/weft/wip/<machine id>` (a worker's
  id, or a Mac's device id). It is no branch, so nothing runs CI or deploys, and git sends only the objects the remote
  lacks. Uncommitted code does reach the remote: the same place its commits go.
- **The snapshot** (`lib/wip-snapshot.ts`) is what `git add -A` would take (the index, the working tree, the untracked
  files `.gitignore` doesn't hide) as one commit on top of HEAD, made through a copy of the index. The worker's working
  tree, index and branch are untouched, and its threads keep running. Its message carries the machine's name and branch.
- **Secrets stay put.** `.env`, `.env.*`, `.envrc` and `.dev.vars` (not their `.example` templates) are left as HEAD has
  them even when a project forgot to ignore them, and an untracked one on this Mac is never removed by a pull.
- **The verb** `tree.snapshot` is host-level (it names a project folder, not a card) and `elevated`. Only a worker
  answers it: a Mac takes no host-level verb from the network (`NO_HOST_VERBS`, `lib/host/dispatch.ts`), and the handler
  itself refuses off a worker. The folder must be one under the worker's work root.
- **The route** is `elevated()`: it rewrites this Mac's working tree, so only Weft's own window may ask.

## What a pull refuses

`applyWip` makes this Mac's tree the snapshot's: the branch fast-forwards to the commit the snapshot sits on (the
worker's HEAD, pushed or not), and the snapshot's changes land on top as uncommitted work, new files untracked. It
refuses rather than lose anything:

| this Mac | answer |
|---|---|
| a thread is running in the project | Stop it first: a pull rewrites the files under it. |
| on another branch | Switch to the worker's branch here first. |
| has commits the worker lacks | Push them and pull there first. |
| has uncommitted work it never sent | Commit it, or send it first. |

The last row is the "one owner at a time" rule, checked at the moment the work moves: this Mac's uncommitted work must
be none, or exactly the tree of its own last snapshot (`refs/weft/wip/<this Mac>`). There is no live write lock: both
sides can still edit, and the next pull refuses if they did. A changed lockfile is said in the toast; nothing installs.

## Not built

- **The other direction.** Sending this Mac's work to the worker means a row from the network rewriting the worker's
  tree, which is as strong as a shell: it needs a signed approval (project-hosts.md, Signed widening).
- **Mac to Mac.** A Mac refuses host-level verbs from the network, and no table says where the same repo lives on
  another Mac. Both are needed before one desktop can ask another.
- **A direct line.** The snapshot goes by way of the remote, not the WebRTC session line; a `tree` channel would spare
  the remote the uncommitted code.
- **Continuous mirroring**, staged-versus-unstaged state (a pull lands everything unstaged), submodules and LFS.
