// tree.snapshot: a Weft Worker builds a snapshot of one project's uncommitted work and pushes it to its hidden ref
// (lib/wip-snapshot.ts, docs/architecture/wip-sync.md), so the board that asked can fetch it and carry on from there.
// The worker's working tree isn't touched, and threads running in it keep running.
//
// Only a worker answers. A Mac's own tree leaves it from its own window, never because a row from the network asked.
import path from "node:path";
import { busyCards } from "../runner-state";
import { getCard } from "../store";
import { readWorkerConfig, workerHome, workRoot } from "../worker-config";
import { listProjectFolders } from "../worker-folders";
import { repoPath } from "../worker-paths";
import { pushWip, snapshotWip, type Snapshot } from "../wip-snapshot";

export const NOT_A_WORKER = "Only a Weft Worker sends its uncommitted work when asked.";

// The snapshot, and how many threads were mid-turn in the project when it was taken (their edits may be half done).
export type TreeSnapshotReply = Snapshot & { running: number };

export interface TreeSnapshotDeps {
  env: NodeJS.ProcessEnv;
  snapshot: typeof snapshotWip;
  push: typeof pushWip;
}

const DEFAULTS: TreeSnapshotDeps = { env: process.env, snapshot: snapshotWip, push: pushWip };

export async function treeSnapshotVerb({ folder }: { folder?: unknown }, _ctx?: unknown, deps: TreeSnapshotDeps = DEFAULTS): Promise<TreeSnapshotReply> {
  const home = workerHome(deps.env);
  const config = deps.env.WEFT_WORKER === "1" ? readWorkerConfig(home) : null;
  if (!config) throw new Error(NOT_A_WORKER);
  const root = workRoot(home, deps.env);
  if (typeof folder !== "string" || !listProjectFolders(root).includes(folder)) throw new Error("That project isn't on this worker.");
  const dir = repoPath(root, folder);
  const snap = await deps.snapshot(dir, { device: config.workerId, mac: config.name });
  await deps.push(dir, config.workerId);
  const inside = (cwd: string) => cwd === dir || cwd.startsWith(dir + path.sep);
  return { ...snap, running: busyCards().filter((id) => inside(getCard(id)?.cwd ?? "")).length };
}
