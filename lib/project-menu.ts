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
  | "sync"
  | "run-here"
  | "run-worker"
  | "pin"
  | "unpin"
  | "hide"
  | "show"
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
  sync: "Y",
  "run-here": "M",
  "run-worker": "W",
  pin: "P",
  unpin: "P",
};

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
    SEPARATOR,
    { id: "secrets", label: "Secrets…" },
    { id: "services", label: "Dev Servers…" },
    { id: "changelog", label: "Changelog…" },
    SEPARATOR,
    { id: "sync", label: s.synced ? `Don't Sync ${name}` : `Sync ${name}`, enabled: s.syncable || s.synced, detail: s.syncStatus },
    { id: "run-here", label: "Run on This Machine", checked: !s.onWorker },
    { id: "run-worker", label: "Run on Worker", checked: s.onWorker, enabled: s.syncable || s.onWorker },
    SEPARATOR,
    s.pinned ? { id: "unpin", label: "Unpin from Bar" } : { id: "pin", label: "Pin to Bar" },
    s.hidden ? { id: "show", label: "Show in Bar" } : { id: "hide", label: "Hide from Bar" },
    SEPARATOR,
    { id: "archive-done", label: s.done === 1 ? "Archive 1 Card in Done" : s.done ? `Archive All ${s.done} in Done` : "Archive Done Cards", enabled: s.done > 0 },
    { id: "stop-running", label: s.live === 1 ? "Stop 1 Running Card" : s.live ? `Stop All ${s.live} Running` : "Stop Running Cards", enabled: s.live > 0 },
  );
  return withAccelerators(items, KEYS);
}
