// A worker project's twin among this Mac's own folders (lib/worker-twin.ts twinOf): its projects and the folders it runs
// on a worker, from ~/.weft/settings.json, as main looks a worker card's vault up by the same name
// (electron/worker-projects.cjs). The board asks it for an in-thread ask_add on a worker card (lib/use-ask-folder.ts), so
// the value goes into the vault of this Mac's checkout of that repo. Server only: it reads settings.
import { listProjects, workerFolders } from "./settings";
import { twinOf } from "./worker-twin";

export function macTwin(project: string): string | null {
  return twinOf(project, [...listProjects().map((p) => p.path), ...workerFolders()]);
}
