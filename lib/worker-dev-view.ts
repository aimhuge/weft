// Which of your workers' dev servers the Services drawer shows (components/WorkerDevServers.tsx): every one with All
// projects, a worker project's own (that worker, that checkout), or for a project on this Mac the servers in a worker's
// checkout of the same name, since that is the same repo running elsewhere.
import type { WorkerDevGroup } from "./worker-dev-list";
import { parseWorkerProject } from "./worker-project";

const folderName = (project: string) => project.split("/").filter(Boolean).pop()?.toLowerCase() ?? "";

export function shownWorkerDev(groups: readonly WorkerDevGroup[], project: string | null): WorkerDevGroup[] {
  if (!project) return groups.filter((g) => g.servers.length);
  const worker = parseWorkerProject(project);
  const name = (worker?.folder ?? folderName(project)).toLowerCase();
  return groups
    .filter((g) => !worker || g.workerId === worker.workerId)
    .map((g) => ({ ...g, servers: g.servers.filter((s) => s.folder.toLowerCase() === name) }))
    .filter((g) => g.servers.length);
}
