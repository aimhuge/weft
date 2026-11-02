// The GitHub repo a worker project is, as this Mac knows it, and main's signature over a card's start in it
// (docs/architecture/connectors.md#connectors-on-a-worker-github-p1-as-built):
// a worker names its project by folder, and a folder name is the worker's word, so the desktop board looks the name
// up among this Mac's own projects and worker folders (~/.weft/settings.json) and reads each one's origin. The answer
// rides on the card.create it sends (lib/worker-new-thread.ts) as `repo`, and weft.zip's mint holds the card to it,
// so a worker can't pick which same-named repo a narrowed token reaches. Null when this Mac has no such project, or
// two with different origins.
import path from "node:path";
import { shell } from "./browser-shell";
import { githubRepoOf } from "./repos";
import { listProjects, workerFolders } from "./settings";

export interface FolderRepoDeps {
  folders: () => string[];
  repoOf: (folder: string) => string | undefined;
}

// Looked up when called, not at import, so a test that mocks lib/repos without githubRepoOf can still load this file.
const defaults: FolderRepoDeps = { folders: () => [...listProjects().map((p) => p.path), ...workerFolders()], repoOf: (folder) => githubRepoOf(folder) };

export function repoForWorkerFolder(folder: string, deps: FolderRepoDeps = defaults): string | null {
  const name = folder.toLowerCase();
  const repos = new Map<string, string>();
  for (const f of deps.folders()) {
    if (path.basename(f).toLowerCase() !== name) continue;
    const repo = deps.repoOf(f);
    if (repo) repos.set(repo.toLowerCase(), repo);
  }
  const [only, ...more] = repos.values();
  return only && !more.length ? only : null;
}

export interface SignedStart {
  key: string;
  sig: string;
  issuedAt: number;
}

export interface StartConnectorDeps {
  repoOf: (folder: string) => string | null;
  // Main's signature over the start (POST /connectors/sign-start, electron/connector-start.cjs).
  sign: (body: { workerId: string; cardId: string; folder: string; repo: string }) => Promise<SignedStart>;
}

export const START_CONNECTOR: StartConnectorDeps = {
  repoOf: (folder) => repoForWorkerFolder(folder),
  sign: async (body) => (await shell("/connectors/sign-start", body)) as unknown as SignedStart,
};

// What a card.create carries for the connector: the repo, and the start signed by this Mac. Nothing when this Mac
// doesn't know the folder; the repo alone when main won't or can't sign (no desktop app, signed out): such a card
// gets no GitHub token, and starts anyway.
export async function connectorStart(o: { workerId: string; cardId: string; folder: string }, deps: StartConnectorDeps = START_CONNECTOR): Promise<{ repo?: string; start?: SignedStart }> {
  const repo = deps.repoOf(o.folder);
  if (!repo) return {};
  const start = await deps.sign({ ...o, repo }).catch(() => null);
  return start ? { repo, start } : { repo };
}
