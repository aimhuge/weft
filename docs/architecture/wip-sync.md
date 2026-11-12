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

## Mac to Mac

Built 2026-11-12. Each Mac keeps its own checkout, threads and dev server, running at local speed; only the snapshot
moves, once, when you switch Macs. Remoting every Mac into one box would put each edit, Bash call and reload on the
network. A synced project's menu also lists your other Macs: **Pull Uncommitted Work from <Mac>**.

```
Mac B (asks)                                         Mac A (answers)
menu → signMacAsk (lib/mac-twins.ts)
  main: Touch ID, signs tree.snapshot {folder, origin, mac} with B's desktop key (electron/widen-sign.cjs)
POST /api/wip { folder, from: mac:<A>/<name>, origin, mac, widen }
sendMacSnapshot: host row to A's device id, folder = the project's name ──▶ macCheck: same account, synced folder by name
                                                     macRules.hostVerb: tree.snapshot only (else NO_HOST_VERBS)
                                                     lib/mac-snapshot.ts: widenProblem against A's Mac pins
                                                       (POST /pairing/verify-mac → electron/mac-pins.cjs), fresh, nonce spent,
                                                       origin = this folder's GitHub repo; snapshot + push refs/weft/wip/<A>
fetchWip + applyWip, as from a worker ◀──
```

- **Why a pairing.** A Mac takes no host-level verb from the network, because a Supabase session is all a row proves.
  Making A push its tree on a row alone would let a stolen session send any Mac's uncommitted work to a remote. So A
  answers only with an approval signed by a Mac you paired with it by hand: Settings → Devices → **Your other Macs**.
  Copy the asking Mac's code (`weft-mac1:`: its device id, its name, its desktop approval public key), paste it on the
  answering Mac, and approve with Touch ID (`electron/mac-pair.cjs`). The code holds no secret; carrying it by hand is
  what makes it trusted. Pair both ways to pull in both directions.
- **A Mac pin is good for one thing.** `electron/mac-pins.cjs` is its own sealed file (`~/.weft/vault/mac-pins.json`),
  apart from the phones and browsers in `paired-devices.cjs`: a paired Mac approves no tool run, gets no workspace key
  and counts as no approver. `/pairing/verify-mac` checks only these pins, and only `lib/mac-snapshot.ts` asks it.
- **Bound exactly.** The approval names A's device id, the verb, the project's name, its GitHub repo, the Mac name
  shown in Touch ID, a nonce and the time (`weft-widen-v1`, two minutes). A answers only for a folder it syncs whose
  name matches exactly one, and whose origin is that same repo, so a project that only shares a name is never pushed.
- Forget on A drops the pin at once, with no Touch ID: it only narrows trust.

## Not built

- **The other direction.** Sending this Mac's work to the worker means a row from the network rewriting the worker's
  tree, which is as strong as a shell: it needs a signed approval (project-hosts.md, Signed widening).
- **A direct line.** The snapshot goes by way of the remote, not the WebRTC session line; a `tree` channel would spare
  the remote the uncommitted code.
- **Continuous mirroring**, staged-versus-unstaged state (a pull lands everything unstaged), submodules and LFS.
