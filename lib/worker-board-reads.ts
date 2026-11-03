// What the desktop board reads from a Weft Worker beyond its cards (docs/architecture/project-hosts.md, H4), through
// this Mac's server, where the account's session lives: a project's snapshot for the header badges (the row the
// worker publishes, with its age and the worker's status, so a stale one says so; heard live after the first read), and
// a host verb's value (the editor's files.*) that went to the blob store because it was too big for its command's row.
import type { SupabaseClient } from "@supabase/supabase-js";
import { accountClient } from "./account";
import { readBlob } from "./blob-read";
import { resultValue } from "./host-result";
import type { ProjectSnapshot } from "./project-reads";
import type { SnapshotView } from "./project-snapshot-view";
import { requireSession } from "./worker-board";
import { watchWorkerProjects } from "./worker-project-live";
import { liveStatus } from "./worker-presence";
import { parseWorkerProject, type WorkerProjectStatus } from "./worker-project";

interface WorkerRow {
  id: string;
  name: string;
  status: WorkerProjectStatus;
  last_seen_at: string | null;
}

// A worker project's snapshot. A database without the table yet reads as no snapshot, so the badges stay away.
export async function workerProjectSnapshot(project: string, client: SupabaseClient = accountClient(), now = Date.now()): Promise<SnapshotView> {
  const where = parseWorkerProject(project);
  if (!where) throw new Error("That isn't a worker project.");
  const who = await requireSession(client);
  // From now on a new snapshot of any of the workspace's projects reaches the board at once (lib/worker-project-live.ts).
  try {
    watchWorkerProjects(client, who.org);
  } catch {
    // No Realtime on this client: the badges read on their own, as before.
  }
  const [worker, row] = await Promise.all([
    client.from("cloud_workers").select("id, name, status, last_seen_at").eq("org_id", who.org).eq("id", where.workerId).maybeSingle<WorkerRow>(),
    client
      .from("cloud_worker_projects")
      .select("snapshot, updated_at")
      .eq("org_id", who.org)
      .eq("worker_id", where.workerId)
      .eq("folder", where.folder)
      .maybeSingle<{ snapshot: ProjectSnapshot; updated_at: string }>(),
  ]);
  if (!worker.data) throw new Error("That worker isn't in your workspace.");
  const found = row.error ? null : row.data;
  return { snapshot: found?.snapshot ?? null, updatedAt: found?.updated_at ?? null, worker: worker.data.name, status: liveStatus(worker.data, null, now) };
}

// A host verb's value that was too big for its command's row (lib/host-result.ts): the JSON the worker put in the
// workspace's blob store, read with the account's own session, so RLS keeps it to the workspace.
export async function workerResultBlob(sha: string, client: SupabaseClient = accountClient()): Promise<{ value: unknown }> {
  const who = await requireSession(client);
  const readJson = async (blob: string) => {
    // Under results/ (app/api/worker-blob), which the R2 mirror never copies.
    const got = await readBlob(client, who.org, `results/${blob}`, { r2: null });
    return got ? new TextDecoder().decode(got.bytes) : null;
  };
  const value = await resultValue({ blob: sha }, readJson);
  if (value === undefined) throw new Error("That isn't a result.");
  return { value };
}
