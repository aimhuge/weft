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

export function deviceView(r: Row, here: string, note: string | null = null): DeviceView {
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
  const notes = await workerNotes(client, rows.filter((r) => r.kind === "worker").map((r) => r.id));
  return { signedIn: true, devices: sortDevices(rows.map((r) => deviceView(r, here, notes.get(r.id) ?? null))) };
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
export async function revokeDevice(id: string, client: SupabaseClient = accountClient()): Promise<{ kind: DeviceKind }> {
  if (!(await uid(client))) throw new Error("Sign in to Weft to revoke a device.");
  const { data, error } = (await client.rpc("device_revoke", { p_id: id })) as { data: unknown; error: { message: string } | null };
  if (error) throw new Error(`Couldn't revoke that device: ${error.message}`);
  return { kind: data as DeviceKind };
}
