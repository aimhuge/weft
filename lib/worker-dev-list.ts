import type { SupabaseClient } from "@supabase/supabase-js";
import { accountClient } from "./account";
import { isTunnelAddress } from "./tunnel-link";
import type { WorkerDevServer } from "./worker-dev-servers";

// The Services drawer's worker section (docs/architecture/dev-servers.md#on-a-worker): the dev servers each of your
// Weft Workers last published on its row (worker_set_dev_servers). Read with your session, so RLS keeps it to your
// workspace; only workers you own are listed, since only their owner can open a tunnel on them.

export interface WorkerDevGroup {
  workerId: string;
  worker: string;
  servers: WorkerDevServer[];
}

interface Row {
  id: string;
  name: string;
  owner_user: string;
  dev_servers: unknown;
}

const isServer = (v: unknown): v is WorkerDevServer => {
  const s = v as Partial<WorkerDevServer> | null;
  return Boolean(s) && typeof s?.cardId === "string" && typeof s.command === "string" && typeof s.folder === "string" && typeof s.state === "string";
};

// The worker wrote the row, so an address the pane would open has to be a real /t/<id>; anything else is dropped.
const checked = (s: WorkerDevServer): WorkerDevServer => (s.address === undefined || isTunnelAddress(s.address) ? s : { ...s, address: undefined });

// Signed out, or a database without the column yet: no section, and nothing else in the drawer breaks.
export async function workerDevServers(client: SupabaseClient = accountClient()): Promise<WorkerDevGroup[]> {
  try {
    const { data: auth } = await client.auth.getSession();
    const uid = auth.session?.user.id;
    if (!uid) return [];
    const { data, error } = (await client.from("cloud_workers").select("id, name, owner_user, dev_servers").eq("owner_user", uid).eq("kind", "headless")) as { data: Row[] | null; error: unknown };
    if (error) return [];
    return (data ?? [])
      .map((r) => ({ workerId: r.id, worker: r.name, servers: Array.isArray(r.dev_servers) ? r.dev_servers.filter(isServer).map(checked) : [] }))
      .filter((g) => g.servers.length > 0);
  } catch {
    return [];
  }
}
