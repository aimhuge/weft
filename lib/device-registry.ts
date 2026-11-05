// Settings → Devices (docs/architecture/device-registry.md): every Mac, worker, phone and browser of yours, read from
// public.device_registry, the one view over devices, cloud_workers and phone_pairings, and revoked through
// device_revoke, one function for every kind. Both run as you (the account's own client), so RLS decides what you see
// and only an owner revokes. No key leaves this module: a row says which keys a device holds, not what they are.
import type { SupabaseClient } from "@supabase/supabase-js";
import { accountClient } from "./account";
import { deviceId } from "./device-id";

export type DeviceKind = "mac" | "worker" | "phone" | "browser";

export interface DeviceView {
  id: string;
  kind: DeviceKind;
  name: string;
  platform: string;
  orgId: string | null;
  // The address its cards and commands use: a Mac's device id, `worker:<id>` for a worker, null for a phone or browser.
  host: string | null;
  // What it holds: a box key (sealed things open on it), a sign key (it signs; only a phone's approves), a passkey.
  hasBoxKey: boolean;
  hasSignKey: boolean;
  hasPasskey: boolean;
  // Approves tool runs: a phone's Face ID signature or a browser's passkey (mobile-security.md).
  approves: boolean;
  fingerprint: string | null;
  status: "online" | "busy" | "offline" | null;
  lastSeenAt: string | null;
  revokedAt: string | null;
  // A worker's standing warning from its own row (cloud_workers.update_note): an update it's holding, or its browser
  // running without its sandbox (lib/worker-chromium-sandbox.ts). Null for anything else.
  note: string | null;
  // The build it runs, "0.7.0+abc1234" (lib/device-version.ts): a worker's own, a Mac's from its daily report. Null for a
  // phone, a browser, or a Mac on a Weft older than this report.
  build: string | null;
  // The Mac you're reading the list on.
  here: boolean;
  // How many threads a worker owns (cloud_cards.owner_worker): what Move threads to… carries. 0 for anything else.
  threads: number;
}

export interface DevicesView {
  signedIn: boolean;
  devices: DeviceView[];
}

interface Row {
  id: string;
  kind: string;
  name: string;
  platform: string;
  owner_user: string;
  org_id: string | null;
  box_key: string | null;
  sign_key: string | null;
  passkey_key: string | null;
  fingerprint: string | null;
  host: string | null;
  status: DeviceView["status"];
  last_seen_at: string | null;
  revoked_at: string | null;
  build: string | null;
}

const KINDS: readonly string[] = ["mac", "worker", "phone", "browser"];
// Named, so a key's value can't slip into the list by a new column.
const COLUMNS = "id, kind, name, platform, owner_user, org_id, box_key, sign_key, passkey_key, fingerprint, host, status, last_seen_at, revoked_at, build";
// Live first, then by kind, then by name.
const ORDER: Record<DeviceKind, number> = { mac: 0, worker: 1, phone: 2, browser: 3 };

export function deviceView(r: Row, here: string, note: string | null = null, threads = 0): DeviceView {
  const kind = (KINDS.includes(r.kind) ? r.kind : "mac") as DeviceKind;
  return {
    id: r.id,
    kind,
    name: r.name,
    platform: r.platform,
    orgId: r.org_id,
    host: r.host,
    hasBoxKey: Boolean(r.box_key),
    hasSignKey: Boolean(r.sign_key),
    hasPasskey: Boolean(r.passkey_key),
    approves: !r.revoked_at && ((kind === "phone" && Boolean(r.sign_key)) || (kind === "browser" && Boolean(r.passkey_key))),
    fingerprint: r.fingerprint,
    status: r.status,
    lastSeenAt: r.last_seen_at,
    revokedAt: r.revoked_at,
    note: kind === "worker" ? note : null,
    build: r.build ?? null,
    here: kind === "mac" && r.host === here,
    threads: kind === "worker" ? threads : 0,
  };
}

export function sortDevices(devices: DeviceView[]): DeviceView[] {
  return [...devices].sort(
    (a, b) => Number(Boolean(a.revokedAt)) - Number(Boolean(b.revokedAt)) || ORDER[a.kind] - ORDER[b.kind] || a.name.localeCompare(b.name),
  );
}

async function uid(client: SupabaseClient): Promise<string | null> {
  const { data } = await client.auth.getSession();
  return data.session?.user.id ?? null;
}

// Yours only: a teammate's workers show in Settings → Sync → Workers, and you can't revoke them here.
export async function listDevices(client: SupabaseClient = accountClient(), here: string = deviceId()): Promise<DevicesView> {
  const me = await uid(client);
  if (!me) return { signedIn: false, devices: [] };
  const { data, error } = await client.from("device_registry").select(COLUMNS).eq("owner_user", me);
  if (error) throw new Error(`Couldn't read your devices: ${error.message}`);
  const rows = (data as Row[] | null) ?? [];
  const workers = rows.filter((r) => r.kind === "worker").map((r) => r.id);
  const [notes, threads] = await Promise.all([workerNotes(client, workers), threadCounts(client, workers)]);
  return { signedIn: true, devices: sortDevices(rows.map((r) => deviceView(r, here, notes.get(r.id) ?? null, threads.get(r.id) ?? 0))) };
}

// How many threads each worker owns (worker_thread_counts, as you). Only a count beside a name, so a failed read
// (a database without the function yet) leaves the counts at 0 and Move threads to… away, not the list.
async function threadCounts(client: SupabaseClient, ids: string[]): Promise<Map<string, number>> {
  if (!ids.length) return new Map();
  const { data } = (await client.rpc("worker_thread_counts")) as { data: { worker_id: string; threads: number | string }[] | null };
  return new Map((data ?? []).map((r) => [r.worker_id, Number(r.threads)]));
}

// Moves every thread one worker of yours owns onto another (worker_move_cards: both yours, one workspace, the target
// not revoked), so a re-paired box, or the box that replaced it, can publish them again. Says how many moved.
// A re-pair the server can prove moves them itself (worker_pair_confirm); this is for the rest.
export async function moveThreads(from: string, to: string, client: SupabaseClient = accountClient()): Promise<{ moved: number }> {
  if (!(await uid(client))) throw new Error("Sign in to Weft to move threads.");
  const { data, error } = (await client.rpc("worker_move_cards", { p_from: from, p_to: to })) as { data: unknown; error: { message: string } | null };
  if (error) throw new Error(`Couldn't move those threads: ${error.message}`);
  return { moved: Number(data) || 0 };
}

// Each worker's note, read from its own row (the view doesn't carry it). Only a line under a name, so a failed read
// leaves the notes off rather than the list.
async function workerNotes(client: SupabaseClient, ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const { data } = (await client.from("cloud_workers").select("id, update_note").in("id", ids)) as { data: { id: string; update_note: string | null }[] | null };
  return new Map((data ?? []).flatMap((w) => (w.update_note ? [[w.id, w.update_note] as const] : [])));
}

// Revokes one of your devices, whatever its kind, and says which kind it was. A worker's key stops working at once;
// a Mac's or a phone's grants go. A phone or browser this Mac pinned is revoked through main instead
// (components/DevicesSettings.tsx), which also unpins it and rotates the workspace key.
//
// A worker's connector grants go with it (a trigger in 20261102280000_worker_github_mint.sql), and then weft.zip ends
// the GitHub tokens it could hold (lib/connector-remote.ts). That second step is best effort: the grant is already
// gone, so nothing more is minted, and the note says when GitHub didn't confirm.
export async function revokeDevice(id: string, client: SupabaseClient = accountClient(), revokeConnectors: RevokeConnectors = defaultRevokeConnectors): Promise<{ kind: DeviceKind; note?: string }> {
  if (!(await uid(client))) throw new Error("Sign in to Weft to revoke a device.");
  const { data, error } = (await client.rpc("device_revoke", { p_id: id })) as { data: unknown; error: { message: string } | null };
  if (error) throw new Error(`Couldn't revoke that device: ${error.message}`);
  const kind = data as DeviceKind;
  if (kind !== "worker") return { kind };
  // Only a worker that was ever handed a token has any to end.
  const { data: minted } = await client.from("connector_mints").select("id").eq("worker_id", id).eq("outcome", "minted").limit(1);
  if (!minted?.length) return { kind };
  try {
    return { kind, note: await revokeConnectors(id, client) };
  } catch (err) {
    return { kind, note: `Its GitHub tokens weren't confirmed revoked (${(err as Error).message}); they end within 8 hours.` };
  }
}

export type RevokeConnectors = (workerId: string, client: SupabaseClient) => Promise<string>;

const defaultRevokeConnectors: RevokeConnectors = async (workerId, client) => {
  const { remoteRevoke, revokeNote } = await import("./connector-remote");
  const session = (await client.auth.getSession()) as Parameters<typeof remoteRevoke>[1]["session"];
  return revokeNote(await remoteRevoke(workerId, { session, fetchFn: fetch, env: process.env }));
};
