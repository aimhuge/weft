import { api } from "@/lib/client";
import { openChangelog } from "@/lib/changelog-open";
import { isLive } from "@/lib/format";
import { stopNow } from "@/lib/optimistic-cards";
import { folderName } from "@/lib/project-bar";
import { projectMenu, type ProjectAction } from "@/lib/project-menu";
import { projectSyncLine } from "@/lib/sync-menu";
import { workerProjectMenu } from "@/lib/worker-project";
import type { CloudSyncStatus } from "@/lib/cloud-sync-view";
import type { ProjectSummary } from "@/lib/board-view";
import type { RailPanel } from "@/lib/rail-view";
import type { Card } from "@/lib/types";

// What a project's right-click menu acts through: the same functions the board's buttons and drawers use.
export interface ProjectMenuDeps {
  projects: ProjectSummary[];
  cards: Card[];
  // A card's folder to its project (worktrees count toward their main repo).
  rootOf: (cwd: string) => string;
  openNew: (cwd?: string) => void;
  chooseProject: (path: string | null) => void;
  openDrawer: (panel: RailPanel) => void;
  // Archives with an Undo toast.
  archive: (cards: Card[]) => void;
  toast: (message: string) => void;
  notify: (err: unknown) => void;
  // Cloud sync to weft.zip: the projects opted in, and how the last flush went.
  syncFolders: string[];
  syncStatus: CloudSyncStatus;
  // Reads the live state again (the board's last read may be stale) and tells the board about it.
  readSync: () => Promise<{ folders: string[]; status: CloudSyncStatus }>;
}

// Right-clicking a project chip, or a project in "More". The menu is native (lib/project-menu.ts); in a
// plain browser tab there's no shell, so the browser's own menu shows. Resolves to whether an item was picked.
// No React state of its own, so it's a plain function the board makes each render, not a hook.
export function projectMenuHandler(deps: ProjectMenuDeps) {
  return async function onProjectMenu(path: string, e: React.MouseEvent): Promise<boolean> {
    const shell = window.weft;
    if (!shell?.popupMenu) return false;
    e.preventDefault();
    e.stopPropagation();
    const project = deps.projects.find((p) => p.path === path);
    // A worker's project has no folder here, so only what a board can do from afar is on its menu.
    if (project?.worker) {
      const picked = await shell.popupMenu(workerProjectMenu(folderName(path), project.worker));
      if (picked === "new") deps.openNew(path);
      return Boolean(picked);
    }
    const mine = deps.cards.filter((c) => deps.rootOf(c.cwd) === path && !c.archived);
    const done = mine.filter((c) => c.column === "done");
    const live = mine.filter(isLive);
    const name = folderName(path);
    // Read sync fresh, so the line beside Sync says how it stands now, not when the board last looked.
    // A failed read keeps what the board already knows rather than blocking the menu.
    let folders = deps.syncFolders;
    let status = deps.syncStatus;
    try {
      const fresh = await deps.readSync();
      folders = fresh.folders;
      status = fresh.status;
    } catch {
      // Keep the last known state.
    }
    const synced = folders.includes(path);
    const onWorker = await api.workerFolders().then((r) => r.folders.includes(path), () => false);
    const menu = projectMenu(name, {
      pinned: Boolean(project?.pinned),
      hidden: Boolean(project?.hidden),
      done: done.length,
      live: live.length,
      openIn: "openIn" in shell,
      synced,
      syncable: !status.signedOut && !status.noWorkspace,
      syncStatus: projectSyncLine(path, status, folders, Date.now()).text,
      onWorker,
    });
    const picked = (await shell.popupMenu(menu)) as ProjectAction | null;
    if (!picked) return false;
    const actions = projectActions(path, name, { ...deps, shell, done, live, syncFolders: folders, syncStatus: status });
    Promise.resolve(actions[picked]()).catch(deps.notify);
    return true;
  };
}

type ActionContext = ProjectMenuDeps & { shell: NonNullable<typeof window.weft>; done: Card[]; live: Card[] };

// Each item's action, by id. A table rather than a switch, so no one function grows past the complexity cap.
function projectActions(path: string, name: string, c: ActionContext): Record<ProjectAction, () => unknown> {
  const openIn = async (target: "editor" | "terminal") => {
    const app = await c.shell.openIn?.(path, target);
    c.toast(app ? `Opened ${name} in ${app}.` : `No ${target === "editor" ? "code editor" : "terminal app"} found in Applications.`);
  };
  const drawer = (panel: RailPanel) => {
    c.chooseProject(path);
    c.openDrawer(panel);
  };
  const runOn = async (worker: boolean) => {
    const r = await api.setWorkerFolder(path, worker);
    c.toast(worker ? `New threads in ${name} now run on ${r.worker ?? "your worker"}.` : `New threads in ${name} run on this machine again.`);
  };
  const mark = (marks: { pinned?: boolean; hidden?: boolean }) => api.markProject(path, marks);
  return {
    new: () => c.openNew(path),
    reveal: () => c.shell.revealFolder(path),
    editor: () => openIn("editor"),
    terminal: () => openIn("terminal"),
    github: async () => {
      const slug = (await api.repos()).repos.find((r) => r.path === path)?.github;
      if (slug) c.shell.openExternal(`https://github.com/${slug}`);
      else c.toast(`${name} has no GitHub remote.`);
    },
    "copy-path": async () => {
      await navigator.clipboard.writeText(path);
      c.toast("Copied the folder path.");
    },
    secrets: () => drawer("vault"),
    services: () => drawer("services"),
    changelog: () => openChangelog(path),
    sync: async () => {
      const on = !c.syncFolders.includes(path);
      await api.cloudSyncSetFolder(path, on);
      await c.readSync();
      c.toast(on ? `${name} now syncs to weft.zip (unencrypted for now).` : `${name} no longer syncs.`);
    },
    "run-here": () => runOn(false),
    "run-worker": () => runOn(true),
    pin: () => mark({ pinned: true }),
    unpin: () => mark({ pinned: false }),
    hide: async () => {
      await mark({ hidden: true });
      c.toast(`${name} is hidden from the bar until it's used again. "More" still lists it.`);
    },
    show: () => mark({ hidden: false }),
    "archive-done": () => c.archive(c.done),
    "stop-running": async () => {
      await Promise.all(c.live.map((card) => stopNow(card.id)));
      c.toast(`Stopped ${c.live.length === 1 ? "1 card" : `${c.live.length} cards`} in ${name}.`);
    },
  };
}
