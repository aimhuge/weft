# One project, many machines

Built 2026-11-16. A project can live on this Mac, on another Mac of yours and on a Weft Worker. The board used to show
that as separate things: a chip per checkout (`weft`, `weft · m1mini`), a pile of menu items per machine, and a device
row per key. Now a project is one chip, each other machine is one group in its menu, and each machine is one row in
Settings → Devices. This is a view-layer change: leases, transport, storage and every trust check are as they were.

## One chip per project

`lib/worker-twin.ts` `twinMap(local, workers)` maps a worker's project path (`worker://<id>/weft`) to the one local
folder with the same name (case-insensitive, scratch ignored; two local folders sharing a name merge nothing).
`projectKeyOf(map, rootOf)` is the grouping key built on it. `lib/use-project-twins.ts` owns the board's grouping,
counts and the selected project, and maps a saved `worker://` selection to its local twin.

- **`projectOf` places a card in a project; `rootOf` acts on a folder.** Grouping, counts, the menu's bulk items and the
  palette use `projectOf`. Anything that touches a folder (drawers, badges, the terminal, Import Issues) keeps the local
  path, so a merged chip behaves as the local project did.
- A worker-only project (no local folder of that name) keeps its own chip and its worker menu.
- Pin, hide and order follow the local project. The chip's tooltip says "Also on m1mini".
- Stop All on a merged chip goes through each card's own host.

## One group per machine in the menu

`lib/machines.ts` `machinesOf(devices)` folds the device registry to one entry per box. Two things made a box show twice:

| Rows | Why | Joined by |
|---|---|---|
| "MacBook-Air-3" and "Weft on MacBook-Air-3.local" | one desktop app: its heartbeat row and its vault-key row, unlinked | `host` (the Mac's device id), else the name |
| "m1mini" (worker) and "Weft on m1mini" (Mac) | two programs on one box, sharing no id | the name |

**The name match is for display only.** It never decides trust, a revoke target, a key grant or a pairing: every action
goes to the underlying row's own id or the worker's project path.

`lib/project-machines.ts` `menuMachines` turns that into the menu's groups (`lib/project-menu.ts` `MenuMachine`):

```
m1mini ▸
  Bring Its Uncommitted Work Here      pull-wip:<from>      (wip-sync.md)
  Keep in Sync with This Mac   ✓       sync-tree:<path>     (folder-sync.md)
    Paused: m1mini: 20 uncommitted…      its state as a second line, when it isn't simply in sync
  Move weft There                      move-tree:<path>
  ─
  Start New Threads There      ✓       run-worker / run-here
MacBook-Air-3 ▸
  Bring Its Uncommitted Work Here
```

- **One way to pull per machine.** The worker's when it holds the project and is up (no Touch ID); otherwise that box's
  Mac, by the signed ask; never both.
- **Start New Threads There** carries the Run on Worker tick, and unticking it brings new threads back. It sits on a
  machine only when you have exactly one worker, because Run on Worker picks the worker by itself
  (`lib/worker-handoff.ts` `pickWorker`). With none or several, the plain Run on This Machine / Run on Worker items stay.
- A worker installed on this same Mac shows as **Worker on This Mac**: a second checkout beside this one.
- A worker twin the registry didn't list (signed out, a failed read) keeps a group of its own, so the menu loses nothing.
- Submenus are drawn by `electron/main-menu-popup.cjs` (`MenuItem.submenu`, one level). The preload says so with
  `menuSubmenus`; on an older shell each machine is a greyed heading over the same items, each naming the machine.

| Before | Now |
|---|---|
| Pull Uncommitted Work from m1mini / from Weft on m1mini | m1mini ▸ Bring Its Uncommitted Work Here |
| Keep in Sync with m1mini | m1mini ▸ Keep in Sync with This Mac |
| Move to m1mini | m1mini ▸ Move weft There |
| Run on This Machine / Run on Worker | m1mini ▸ Start New Threads There |

## One row per machine in Settings → Devices

`components/DevicesSettings.tsx` draws `machinesOf(list)` through `components/MachineRow.tsx`: a name, what it is and how
it stands, then what it holds in plain words. A box with both the app and a worker keeps both rows' actions ("Revoke app
key", "Forget worker"). Revoked rows fold under **Revoked (n)**. "Sealed" reads "encrypted" throughout.

Pairing two Macs (wip-sync.md, Mac to Mac) moved onto the other Mac's row, under **Share work…**:

- **Copy code for X**: paste it in Weft on X so this Mac can pull X's uncommitted work.
- **Paste X's code, Allow** (Touch ID): X can then pull this Mac's uncommitted work. **Stop** forgets it.

## Not built

- **A real machine id.** `cloud_workers.machine` = `sha256(uid ‖ IOPlatformUUID)`, written by the desktop's heartbeat
  and the worker, would join a box's rows without the name. It can't reuse `device` (its unique index would clash).
- **A worker per project.** `workerFolders` stores no worker id, so the tick can't sit on one of several workers.
- **Pairing without the copy and paste.** Safe only as a commit-reveal exchange with a code both screens show, computed
  in each main process from keys held locally, and Touch ID on both ends; it needs a `mac_pair_offers` table.
- The web board groups with its own key and lists no workers' checkouts, so it is unchanged.
