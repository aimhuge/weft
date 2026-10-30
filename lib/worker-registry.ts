// A Weft Worker's calls to Supabase (supabase/migrations/*_weft_workers.sql). The worker holds no session: it calls
// the worker_* functions with the publishable key and passes its own key as the first argument, and each function
// checks sha256(key) before it acts. Enrolment trades a one-time token for that key.
import type { CloudCommandRow } from "./cloud-commands";
import type { WorkerConfig } from "./worker-config";
import type { GithubState } from "./worker-github";

// supabase-js's rpc, narrowed to what the worker needs, so tests hand in a fake.
export type Rpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;

export type WorkerStatus = "online" | "busy" | "offline";

export interface ItemRow {
  seq: number;
  kind: string;
  item: unknown;
  at: string;
}

export interface OutputRow {
  tool_id: string;
  result: string;
  bytes: number;
}

async function call<T>(rpc: Rpc, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

interface Enrolled {
  worker_id: string;
  org_id: string;
  owner_user: string;
  device: string;
  key: string;
}

export async function enrol(rpc: Rpc, token: string, box: { name: string; platform: string; arch: string }): Promise<WorkerConfig> {
  const e = await call<Enrolled>(rpc, "worker_enrol", { p_token: token.trim(), p_name: box.name, p_platform: box.platform, p_arch: box.arch });
  return { workerId: e.worker_id, orgId: e.org_id, ownerUser: e.owner_user, device: e.device, key: e.key, name: box.name };
}

// What the daemon does with its key, bound once.
export function registry(rpc: Rpc, key: string) {
  return {
    heartbeat: (status: WorkerStatus) => call<unknown>(rpc, "worker_heartbeat", { p_key: key, p_status: status }),
    setPublicKey: (publicKey: string) => call<unknown>(rpc, "worker_set_public_key", { p_key: key, p_public_key: publicKey }),
    setGithub: (state: GithubState, account: string | null) => call<unknown>(rpc, "worker_set_github", { p_key: key, p_state: state, p_account: account }),
    pending: async () => (await call<CloudCommandRow[] | null>(rpc, "worker_pending", { p_key: key })) ?? [],
    claim: (id: string) => call<boolean>(rpc, "worker_claim", { p_key: key, p_command: id }),
    report: (id: string, status: "done" | "failed", cardId: string | null, error: string | null) =>
      call<unknown>(rpc, "worker_report", { p_key: key, p_command: id, p_status: status, p_card: cardId, p_error: error }),
    putCard: (cardId: string, folder: string, card: unknown, deleted = false) =>
      call<unknown>(rpc, "worker_put_card", { p_key: key, p_card_id: cardId, p_folder: folder, p_card: card, p_deleted: deleted }),
    putItems: (cardId: string, items: ItemRow[], outputs: OutputRow[], fromSeq: number | null) =>
      call<unknown>(rpc, "worker_put_items", { p_key: key, p_card_id: cardId, p_items: items, p_outputs: outputs, p_from_seq: fromSeq }),
  };
}

export type Registry = ReturnType<typeof registry>;
