// A project that lives on a Weft Worker, as the desktop board holds it (docs/architecture/weft-worker.md#worker-projects-on-the-desktop-board).
// The board's projects are paths, so a worker's is one too: worker://<worker id>/<folder>. Nothing on this Mac is at
// that path, which is the point: a card or project carrying it reads from the cloud rows and acts through
// cloud_commands, and every path that would touch a local folder or start a local CLI checks here first.
import type { ProjectSummary, ProjectWorker, WorkerProjectStatus } from "./board-view";
import type { MenuItem } from "./card-menu";
import type { Card } from "./types";
import { formatProjectAddress, isWorkerPath, parseProjectAddress, workerAddress } from "./host/address";

export type { WorkerProjectStatus };

// One project on one of your workers.
export interface WorkerProject {
  path: string;
  workerId: string;
  worker: string;
  folder: string;
  status: WorkerProjectStatus;
  // Pin to Bar and Hide from Bar, this board's own (lib/worker-project-marks.ts).
  pinned?: boolean;
  hidden?: boolean;
}

export interface WorkerBoard {
  signedIn: boolean;
  projects: WorkerProject[];
  // Each with its cwd set to its project's path, so the board's own grouping files it there.
  cards: Card[];
  // The newest card change this read saw: the next read's `since`. `delta` marks a read of the changed cards only
  // (lib/worker-board-merge.ts lays it over the last whole read).
  asOf?: string;
  delta?: boolean;
  // On a delta: cards that were deleted, turned copilot or lost their folder since, for the merge to drop.
  removed?: string[];
}

export const EMPTY_WORKER_BOARD: WorkerBoard = { signedIn: false, projects: [], cards: [] };

// The path is the wire form of a ProjectAddress (lib/host/address.ts), the one place worker:// is built and read.
export const workerProjectPath = (workerId: string, folder: string) => formatProjectAddress(workerAddress(workerId, folder));

export const isWorkerProject = isWorkerPath;

export const isWorkerCard = (card: Pick<Card, "cwd">) => isWorkerProject(card.cwd);

// The worker id and folder a project's path names, or null for anything else.
export function parseWorkerProject(path: string): { workerId: string; folder: string } | null {
  const address = parseProjectAddress(path);
  return address?.host.kind === "worker" ? { workerId: address.host.id, folder: address.repo } : null;
}

// A folder the Mac can act on: what the terminal, the header badges and the drawers get, never a worker's path.
export const localPath = <T extends string | null | undefined>(path: T): T | null => (isWorkerProject(path) ? null : path);

// The line a project shows under its name: where it lives.
// `route` is how the board reaches it now, "relay · 600 ms" (lib/worker-route.ts).
export const workerLabel = (w: ProjectWorker, route?: string | null) => (w.status === "offline" ? `on ${w.name} · offline` : `on ${w.name}${route ? ` · ${route}` : ""}`);

export const offlineMessage = (worker: string) => `${worker} is offline, so this didn't start. Nothing ran on this Mac; try again once it's back.`;

// The local projects with the workers' beside them: a worker project with no cards yet gets a row of its own, and
// each one says which worker it's on.
export function withWorkerProjects(summaries: ProjectSummary[], projects: WorkerProject[]): ProjectSummary[] {
  const byPath = new Map(projects.map((p) => [p.path, p]));
  const known = new Set(summaries.map((s) => s.path));
  const empty = projects.filter((p) => !known.has(p.path)).map((p): ProjectSummary => ({ path: p.path, lastActivity: 0, cards: 0, running: 0, needsYou: 0 }));
  return [...summaries, ...empty].map((s) => {
    const p = byPath.get(s.path);
    if (!p) return s;
    return { ...s, worker: { name: p.worker, status: p.status }, ...(p.pinned ? { pinned: true } : {}), ...(p.hidden ? { hidden: true } : {}) };
  });
}

const SEPARATOR: MenuItem = { type: "separator" };

// What a worker project's right-click menu counts: its marks and the cards it could archive or stop.
export interface WorkerMenuState {
  pinned?: boolean;
  hidden?: boolean;
  done: number;
  live: number;
}

// A worker project's right-click menu: what a board can do from here. An offline worker can't take a thread; pins and
// hides are this board's own, and archiving and stopping go to the worker as each card's verbs.
export function workerProjectMenu(name: string, worker: ProjectWorker, s: WorkerMenuState = { done: 0, live: 0 }): MenuItem[] {
  return [
    { id: "new", label: `New Thread in ${name}`, enabled: worker.status !== "offline", detail: workerLabel(worker) },
    SEPARATOR,
    s.pinned ? { id: "unpin", label: "Unpin from Bar" } : { id: "pin", label: "Pin to Bar" },
    s.hidden ? { id: "show", label: "Show in Bar" } : { id: "hide", label: "Hide from Bar" },
    SEPARATOR,
    { id: "archive-done", label: s.done === 1 ? "Archive 1 Card in Done" : s.done ? `Archive All ${s.done} in Done` : "Archive Done Cards", enabled: s.done > 0 },
    { id: "stop-running", label: s.live === 1 ? "Stop 1 Running Card" : s.live ? `Stop All ${s.live} Running` : "Stop Running Cards", enabled: s.live > 0 },
  ];
}
