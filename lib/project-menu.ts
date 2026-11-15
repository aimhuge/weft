import { withAccelerators, type MenuItem } from "./card-menu";

// The right-click menu on a project chip, and on each project in "More", as plain data: the desktop
// shell shows it natively and hands back the id picked (components/use-project-menu.ts runs it).

export type ProjectAction =
  | "new"
  | "reveal"
  | "editor"
  | "terminal"
  | "github"
  | "copy-path"
  | "secrets"
  | "services"
  | "changelog"
  | "share"
  | "sync"
  | "run-here"
  | "run-worker"
  | `pull-wip:${string}`
  | `sync-tree:${string}`
  | `move-tree:${string}`
  // A machine's name as a heading, on a shell that can't draw submenus. Never enabled, so never picked.
  | `machine:${string}`
  | "pin"
  | "unpin"
  | "hide"
  | "show"
  | "add-folder"
  | `remove-folder:${string}`
  | "archive-done"
  | "stop-running";

// What the menu needs to know about the project: its marks and how many of its cards each bulk item would touch.
export interface ProjectMenuState {
  pinned: boolean;
  hidden: boolean;
  done: number; // unarchived Done cards
  live: number; // running cards and cards with a queued turn
  // The shell can open a folder in an editor or terminal app (electron/open-in.cjs); an older shell can't.
  openIn: boolean;
  // Cloud sync to weft.zip: whether this project uploads its threads, and whether it may (signed in, workspace claimed).
  synced: boolean;
  syncable: boolean;
  // Where this project's sync stands ("Synced 7m ago", "Not Synced"), shown beside the Sync item.
  syncStatus: string;
  // "Run on Worker": the project's new cards go to your Weft Worker instead of this machine (lib/worker-handoff.ts).
  onWorker: boolean;
  // Folders added to the project (lib/project-folders.ts), each with a Remove item under Add Folder….
  folders?: string[];
  // Each other machine that holds this project (lib/machines.ts), one group apiece. A machine that takes new threads
  // replaces the two Run on items.
  machines?: MenuMachine[];
  // The shell draws submenus (electron/main-menu-popup.cjs); an older one gets each machine's items under a heading.
  submenus?: boolean;
}

// One other machine in a project's menu, and what this Mac can do with the project there. Each part is offered only
// when that machine can do it: one way to pull per machine, never two.
export interface MenuMachine {
  name: string;
  offline: boolean;
  // Bring its uncommitted work here: the `from` of a pull (a worker's project path, or mac:<device>/<folder>).
  pull?: string;
  // Keep both checkouts as one folder, and Move (this Mac's work goes there): the worker's project path.
  sync?: { path: string; on: boolean; note?: string };
  // New threads in this project start there (Run on Worker), ticked when they do.
  runThere?: boolean;
}

const SEPARATOR: MenuItem = { type: "separator" };

// Each item's key while the menu is open. Letters are free: the board's own keys don't run while a menu is open.
const KEYS: Record<string, string> = {
  new: "N",
  reveal: "F",
  editor: "E",
  terminal: "T",
  github: "G",
  "copy-path": "C",
  secrets: "K",
  services: "D",
  changelog: "L",
  share: "S",
  sync: "Y",
  "run-here": "M",
  "run-worker": "W",
  pin: "P",
  unpin: "P",
  "add-folder": "O",
};

const base = (folder: string) => folder.split("/").filter(Boolean).pop() ?? folder;

// One machine's items. Inside its submenu the machine goes unnamed ("There"); on a flat menu each item names it.
function machineActions(project: string, m: MenuMachine, sub: boolean): MenuItem[] {
  const items: MenuItem[] = [];
  if (m.pull) items.push({ id: `pull-wip:${m.pull}`, label: `Bring ${sub ? "Its" : `${m.name}'s`} Uncommitted Work Here`, enabled: !m.offline });
  if (m.sync) {
    items.push(
      { id: `sync-tree:${m.sync.path}`, label: `Keep in Sync with ${sub ? "This Mac" : m.name}`, checked: m.sync.on, ...(m.sync.note ? { detail: m.sync.note } : {}) },
      { id: `move-tree:${m.sync.path}`, label: `Move ${project} ${sub ? "There" : `to ${m.name}`}`, enabled: !m.offline, detail: "Sends this Mac's work, then new threads start there" },
    );
  }
  if (m.runThere !== undefined) {
    if (items.length) items.push(SEPARATOR);
    // Ticked, picking it brings new threads back to this Mac.
    items.push({ id: m.runThere ? "run-here" : "run-worker", label: `Start New Threads ${sub ? "There" : `on ${m.name}`}`, checked: m.runThere });
  }
  return items;
}

// Every other machine: a submenu each, or on an older shell its name as a heading over the same items.
function machineItems(project: string, machines: MenuMachine[], submenus: boolean): MenuItem[] {
  return machines.flatMap((m): MenuItem[] => {
    const status = m.offline ? { detail: "offline" } : {};
    if (submenus) return [{ label: m.name, submenu: machineActions(project, m, true), ...status }];
    return [{ id: `machine:${m.name}`, label: m.name, enabled: false, ...status }, ...machineActions(project, m, false)];
  });
}

// Where new threads run and the project's other machines: the machine groups.
function placeItems(name: string, s: ProjectMenuState): MenuItem[] {
  const run: MenuItem[] = [
    { id: "run-here", label: "Run on This Machine", checked: !s.onWorker },
    { id: "run-worker", label: "Run on Worker", checked: s.onWorker, enabled: s.syncable || s.onWorker },
  ];
  const machines = s.machines ?? [];
  // A machine that takes new threads carries the tick itself; with none that does, the two plain items stay.
  const covered = machines.some((m) => m.runThere !== undefined);
  return [...(covered ? [] : run), ...machineItems(name, machines, s.submenus === true)];
}

export function projectMenu(name: string, s: ProjectMenuState): MenuItem[] {
  const items: MenuItem[] = [
    { id: "new", label: `New Thread in ${name}` },
    SEPARATOR,
    { id: "reveal", label: "Reveal in Finder" },
  ];
  if (s.openIn) items.push({ id: "editor", label: "Open in Editor" }, { id: "terminal", label: "Open in Terminal" });
  items.push(
    { id: "github", label: "Open on GitHub" },
    { id: "copy-path", label: "Copy Folder Path" },
    { id: "add-folder", label: "Add Folder…" },
    ...(s.folders ?? []).map((f) => ({ id: `remove-folder:${f}`, label: `Remove ${base(f)}`, detail: f })),
    SEPARATOR,
    { id: "secrets", label: "Secrets…" },
    { id: "services", label: "Dev Servers…" },
    { id: "changelog", label: "Changelog…" },
    SEPARATOR,
    // Share…: the workspace's web board link and invites; the project starts syncing first so it's on that board.
    { id: "share", label: `Share ${name}…`, enabled: s.syncable || s.synced },
    { id: "sync", label: s.synced ? `Don't Sync ${name}` : `Sync ${name}`, enabled: s.syncable || s.synced, detail: s.syncStatus },
    ...placeItems(name, s),
    SEPARATOR,
    s.pinned ? { id: "unpin", label: "Unpin from Bar" } : { id: "pin", label: "Pin to Bar" },
    s.hidden ? { id: "show", label: "Show in Bar" } : { id: "hide", label: "Hide from Bar" },
    SEPARATOR,
    { id: "archive-done", label: s.done === 1 ? "Archive 1 Card in Done" : s.done ? `Archive All ${s.done} in Done` : "Archive Done Cards", enabled: s.done > 0 },
    { id: "stop-running", label: s.live === 1 ? "Stop 1 Running Card" : s.live ? `Stop All ${s.live} Running` : "Stop Running Cards", enabled: s.live > 0 },
  );
  return withAccelerators(items, KEYS);
}
