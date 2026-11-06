// A Weft Worker's calls to Supabase (supabase/migrations/*_weft_workers.sql). The worker holds no session: it calls
// the worker_* functions with the publishable key and passes its own key as the first argument, and each function
// checks sha256(key) before it acts. Enrolment trades a one-time token for that key.
import type { CloudCommandRow } from "./cloud-commands";
import type { HostResult } from "./host-command";
import type { PackedLimits } from "./limits-wire";
import type { WorkerConfig } from "./worker-config";
import type { GithubState } from "./worker-github";
import type { MacRow } from "./worker-board-macs";
import type { SyncedRow } from "./worker-settings-sync";

// supabase-js's rpc, narrowed to what the worker needs, so tests hand in a fake.
export type Rpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;

// One of the owner's synced cards, as worker_board_cards returns it: this worker's, another's, or a Mac's.
export interface BoardRow {
  card_id: string;
  folder: string;
  owner_device: string;
  owner_worker: string | null;
  card: unknown;
  updated_at: string;
}

// One of the owner's Macs' published crons, as worker_mac_crons returns it (lib/mac-crons.ts writes it).
export interface MacCronsRow {
  device: string;
  label: string;
  crons: unknown[];
  updated_at: string;
}

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

export interface DeviceAnswer {
  status: "pending" | "claimed" | "done" | "failed";
  result: unknown;
  error: string | null;
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
    setBuild: (build: string, note: string | null) => call<unknown>(rpc, "worker_set_build", { p_key: key, p_build: build, p_note: note }),
    // The owner's synced settings (lib/worker-settings-sync.ts), and this box's plan-limit history (lib/worker-limits.ts).
    accountSettings: () => call<SyncedRow | null>(rpc, "worker_account_settings", { p_key: key }),
    setLimits: (limits: PackedLimits) => call<unknown>(rpc, "worker_set_limits", { p_key: key, p_limits: limits }),
    deviceCall: (device: string, cardId: string, tool: string, args: unknown) => call<string | null>(rpc, "worker_device_call", { p_key: key, p_device: device, p_card: cardId, p_tool: tool, p_args: args }),
    // A card's mcp__secrets__run asking the Mac this worker is paired with (lib/worker-secret-run.ts); null when it's away.
    secretAsk: (cardId: string, args: unknown) => call<string | null>(rpc, "worker_secret_ask", { p_key: key, p_card: cardId, p_args: args }),
    deviceResult: (id: string) => call<DeviceAnswer | null>(rpc, "worker_device_result", { p_key: key, p_call: id }),
    deviceCancel: (id: string) => call<boolean>(rpc, "worker_device_cancel", { p_key: key, p_call: id }),
    // A tunnel's Touch ID or a relay's sealed secret, asked of the owner's Mac (lib/worker-mac-ask.ts).
    macAsk: (cardId: string, tool: string, args: unknown) => call<string | null>(rpc, "worker_mac_ask", { p_key: key, p_card: cardId, p_tool: tool, p_args: args }),
    tunnelOpen: (id: string, url: string, secret: string) => call<string | null>(rpc, "worker_tunnel_open", { p_key: key, p_tunnel: id, p_url: url, p_secret: secret }),
    tunnelClose: (id: string) => call<unknown>(rpc, "worker_tunnel_close", { p_key: key, p_tunnel: id }).then(() => undefined),
    setDevServers: (servers: unknown[]) => call<unknown>(rpc, "worker_set_dev_servers", { p_key: key, p_servers: servers }),
    pending: async () => (await call<CloudCommandRow[] | null>(rpc, "worker_pending", { p_key: key })) ?? [],
    claim: (id: string) => call<boolean>(rpc, "worker_claim", { p_key: key, p_command: id }),
    // Leases (supabase/migrations/*_command_leases.sql, lib/host/lease.ts): renew what it runs, requeue its own expired reads.
    renew: async (ids: string[]): Promise<void> => {
      await call<unknown>(rpc, "worker_renew", { p_key: key, p_commands: ids });
    },
    reclaim: async (verbs: string[]) => (await call<number | null>(rpc, "worker_reclaim", { p_key: key, p_verbs: verbs })) ?? 0,
    // A host command's result goes as p_result; the other kinds leave it off, so they still report to a database
    // whose worker_report predates it (supabase/migrations/*_host_command.sql).
    report: (id: string, status: "done" | "failed", cardId: string | null, error: string | null, result?: HostResult) =>
      call<unknown>(rpc, "worker_report", { p_key: key, p_command: id, p_status: status, p_card: cardId, p_error: error, ...(result ? { p_result: result } : {}) }),
    putCard: (cardId: string, folder: string, card: unknown, deleted = false) =>
      call<unknown>(rpc, "worker_put_card", { p_key: key, p_card_id: cardId, p_folder: folder, p_card: card, p_deleted: deleted }),
    // A folder's header reads, for the desktop board's badges (lib/worker-projects.ts).
    putProject: (folder: string, snapshot: unknown) => call<unknown>(rpc, "worker_put_project", { p_key: key, p_folder: folder, p_snapshot: snapshot }),
    putItems: (cardId: string, items: ItemRow[], outputs: OutputRow[], fromSeq: number | null) =>
      call<unknown>(rpc, "worker_put_items", { p_key: key, p_card_id: cardId, p_items: items, p_outputs: outputs, p_from_seq: fromSeq }),
    // The board tools on a worker (lib/worker-board-link.ts, supabase/migrations/*_worker_board_tools.sql).
    boardCards: async (limit: number) => (await call<BoardRow[] | null>(rpc, "worker_board_cards", { p_key: key, p_limit: limit })) ?? [],
    newCard: (target: string, folder: string, payload: Record<string, unknown>) =>
      call<string>(rpc, "worker_new_card", { p_key: key, p_target: target, p_folder: folder, p_payload: payload }),
    setLists: (crons: unknown[], webhooks: unknown[]) => call<unknown>(rpc, "worker_set_lists", { p_key: key, p_crons: crons, p_webhooks: webhooks }),
    // The owner's Macs' crons, read-only, for list_crons (lib/worker-mac-crons.ts, supabase/migrations/*_mac_crons_for_workers.sql).
    macCrons: async () => (await call<MacCronsRow[] | null>(rpc, "worker_mac_crons", { p_key: key })) ?? [],
    // The owner's Macs by device id and name, for create_card's mac:// paths (lib/worker-board-macs.ts,
    // supabase/migrations/*_worker_board_macs.sql).
    macs: async () => (await call<MacRow[] | null>(rpc, "worker_board_macs", { p_key: key })) ?? [],
    // Whether the Mac this worker was paired with has been revoked (lib/worker-mac-revocation.ts), and every passkey head
    // its Mac published (lib/passkey-head.ts): supabase/migrations/*_worker_pairing_mac.sql, *_worker_passkey_heads.sql.
    macState: () => call<unknown>(rpc, "worker_mac_state", { p_key: key }),
    passkeyHeads: async () => (await call<unknown[] | null>(rpc, "worker_passkey_heads", { p_key: key })) ?? [],
  };
}

export type Registry = ReturnType<typeof registry>;
