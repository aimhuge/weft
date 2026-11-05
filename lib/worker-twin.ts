// A worker project's twin on this Mac: the folder here that is a checkout of the same repo, found by its name, the way
// main finds a worker card's vault (electron/worker-projects.cjs). A worker names its project by its folder under the
// work root, which is the repo's name for a project cloned there (lib/worker-handoff.ts sends a Mac folder's basename),
// so the twin is the Mac folder of that name. What is per repo rather than per machine (the vault, the Vercel and
// Supabase links, the GitHub repo) reads the twin for a worker project. Pure, so the board and the server share it.
import { parseWorkerProject } from "./worker-project";

const baseName = (folder: string) => folder.split("/").filter(Boolean).pop()?.toLowerCase() ?? "";

// Every candidate on this Mac with the worker project's folder name, in order (none for a project not a worker's).
export function twinsOf(project: string | null | undefined, candidates: readonly string[]): string[] {
  const worker = project ? parseWorkerProject(project) : null;
  if (!worker) return [];
  const name = worker.folder.toLowerCase();
  return [...new Set(candidates.filter((c) => !parseWorkerProject(c) && baseName(c) === name))];
}

// The first of them, or null. A name is a guess: two checkouts of different repos may share one, so what acts on the
// repo (the issue sync, lib/issue-worker.ts) checks every twin names the same one.
export function twinOf(project: string | null | undefined, candidates: readonly string[]): string | null {
  return twinsOf(project, candidates)[0] ?? null;
}

// The same, through a vault's label when no folder matched: "owner/name" names the repo the vault is for.
export function twinByRepo(project: string | null | undefined, vaults: readonly { label: string; folder: string }[]): string | null {
  const worker = project ? parseWorkerProject(project) : null;
  if (!worker) return null;
  const name = worker.folder.toLowerCase();
  return vaults.find((v) => baseName(v.label) === name)?.folder ?? null;
}
