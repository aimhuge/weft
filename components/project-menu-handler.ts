import { api } from "@/lib/client";
import { openChangelog } from "@/lib/changelog-open";
import { isLive } from "@/lib/format";
import { stopNow } from "@/lib/optimistic-cards";
import { folderName } from "@/lib/project-bar";
import { projectMenu, type ProjectAction } from "@/lib/project-menu";
import { projectSyncLine } from "@/lib/sync-menu";
import { hostOf } from "@/lib/project-host";
import { parseMacSource } from "@/lib/mac-host-verbs-source";
import { otherMacs, signMacAsk, type MacTwin } from "@/lib/mac-twins";
import { parseWorkerProject, workerProjectMenu } from "@/lib/worker-project";
import { setWorkerMarks } from "@/lib/worker-project-marks";
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
  // Opens Share the board (components/ShareBoardDialog.tsx): the web board's link and invites.
  shareBoard: () => void;
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
    const mine = deps.cards.filter((c) => deps.rootOf(c.cwd) === path && !c.archived);
    const done = mine.filter((c) => c.column === "done");
    const live = mine.filter(isLive);
    const name = folderName(path);
    // A worker's project has no folder here, so only what a board can do from afar is on its menu.
    if (project?.worker) return workerMenu(shell, path, name, project, { ...deps, done, live });
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
    const [onWorker, macs] = await Promise.all([
      api.workerFolders().then((r) => r.folders.includes(path), () => false),
      // Your other Macs answer only for a project they sync too, so a project this Mac doesn't sync lists none.
      synced ? otherMacs(name) : Promise.resolve([] as MacTwin[]),
    ]);
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
      folders: project?.folders,
      twins: [...twinsOf(name, deps.projects), ...macs],
    });
    const picked = (await shell.popupMenu(menu)) as ProjectAction | null;
    if (!picked) return false;
    const actions = projectActions(path, name, { ...deps, shell, done, live, syncFolders: folders, syncStatus: status });
    const run = isRemoveFolder(picked)
      ? () => removeFolder(path, name, picked.slice("remove-folder:".length), deps)
      : isPullWip(picked)
        ? () => pullWip(path, picked.slice("pull-wip:".length), deps, macs)
        : actions[picked];
    Promise.resolve(run()).catch(deps.notify);
    return true;
  };
}

// A worker project's menu (lib/worker-project.ts workerProjectMenu): a new thread, this board's pin and hide, and its
// Done and running cards archived or stopped through each card's host (the archive's own hostOf, stopNow's host call).
async function workerMenu(shell: NonNullable<typeof window.weft>, path: string, name: string, project: ProjectSummary, c: ProjectMenuDeps & { done: Card[]; live: Card[] }) {
  const worker = project.worker as NonNullable<ProjectSummary["worker"]>;
  const picked = await shell.popupMenu(workerProjectMenu(name, worker, { pinned: project.pinned, hidden: project.hidden, done: c.done.length, live: c.live.length }));
  const stop = async () => {
    await Promise.all(c.live.map((card) => stopNow(card.id, () => hostOf(card).act("card.stop", { id: card.id }))));
    c.toast(`Stopped ${c.live.length === 1 ? "1 card" : `${c.live.length} cards`} in ${name}.`);
  };
  const actions: Record<string, () => unknown> = {
    new: () => c.openNew(path),
    pin: () => setWorkerMarks(path, { pinned: true }),
    unpin: () => setWorkerMarks(path, { pinned: false }),
    hide: () => setWorkerMarks(path, { hidden: true }),
    show: () => setWorkerMarks(path, { hidden: false }),
    "archive-done": () => c.archive(c.done),
    "stop-running": stop,
  };
  const run = picked ? actions[picked] : undefined;
  if (run) Promise.resolve(run()).catch(c.notify);
  return Boolean(picked);
}

// "Add Folder…": picks a folder in the shell's dialog and adds it to the project, so its threads work there too.
async function addFolder(path: string, name: string, c: ActionContext) {
  const folder = await c.shell.dialog.openFolder();
  if (!folder) return;
  await api.setProjectFolder(path, folder, true);
  c.toast(`Threads in ${name} can now work in ${folderName(folder)} too. Running threads get it on their next start.`);
}

const isRemoveFolder = (id: ProjectAction): id is `remove-folder:${string}` => id.startsWith("remove-folder:");

async function removeFolder(path: string, name: string, folder: string, deps: ProjectMenuDeps) {
  await api.setProjectFolder(path, folder, false);
  deps.toast(`${folderName(folder)} is no longer part of ${name}.`);
}

// The Weft Workers' projects with this one's folder name: the same repo on another machine (lib/worker-handoff.ts sends
// a project there under its folder's name).
function twinsOf(name: string, projects: ProjectSummary[]) {
  return projects.flatMap((p) => (p.worker && parseWorkerProject(p.path)?.folder === name ? [{ path: p.path, name: p.worker.name, offline: p.worker.status === "offline" }] : []));
}

const isPullWip = (id: ProjectAction): id is `pull-wip:${string}` => id.startsWith("pull-wip:");

// "Pull Uncommitted Work from <worker>": the worker snapshots and pushes on request, this Mac checks it out (lib/wip-pull.ts).
// Another Mac's needs your Touch ID first, over its name and this project's GitHub repo (lib/mac-twins.ts).
async function pullWip(path: string, from: string, deps: ProjectMenuDeps, macs: MacTwin[]) {
  const mac = parseMacSource(from);
  let ask: Awaited<ReturnType<typeof signMacAsk>> | undefined;
  if (mac) {
    const origin = (await api.repos()).repos.find((r) => r.path === path)?.github;
    if (!origin) {
      deps.toast(`${folderName(path)} has no GitHub remote to meet your other Mac on.`);
      return;
    }
    ask = await signMacAsk(mac.device, mac.folder, origin, macs.find((m) => m.path === from)?.name ?? "your other Mac");
  }
  deps.toast("Asking for its uncommitted work…");
  deps.toast((await api.pullWip(path, from, ask)).note);
}

type ActionContext = ProjectMenuDeps & { shell: NonNullable<typeof window.weft>; done: Card[]; live: Card[] };

// Each item's action, by id. A table rather than a switch, so no one function grows past the complexity cap.
function projectActions(path: string, name: string, c: ActionContext): Record<Exclude<ProjectAction, `remove-folder:${string}` | `pull-wip:${string}`>, () => unknown> {
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
    share: async () => {
      // The web board only shows synced projects, so sharing one turns its sync on first.
      if (!c.syncFolders.includes(path)) {
        await api.cloudSyncSetFolder(path, true);
        await c.readSync();
        c.toast(`${name} now syncs to weft.zip, so it shows on the shared board.`);
      }
      c.shareBoard();
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
    "add-folder": () => addFolder(path, name, c),
    "archive-done": () => c.archive(c.done),
    "stop-running": async () => {
      await Promise.all(c.live.map((card) => stopNow(card.id)));
      c.toast(`Stopped ${c.live.length === 1 ? "1 card" : `${c.live.length} cards`} in ${name}.`);
    },
  };
}
