import fs from "node:fs";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { accountClient } from "./account";
import { shell } from "./browser-tools";
import { globalSingleton } from "./global-singleton";
import { SITE } from "./site";
import { DATA_DIR } from "./store";
import { ensureCloudflared, startQuickTunnel, type QuickTunnel } from "./tunnel-cloudflared";
import { cleanGateTarget, startGate } from "./tunnel-gate";
import { listWebhooks } from "./webhooks";

// Tunnels, the Mac's half (docs/architecture/tunnels.md): a public address for a local port, private to you. Each open
// tunnel is a gate (lib/tunnel-gate.ts) with cloudflared in front of it. The URL changes on every start, so it goes on
// a Supabase row behind the stable /t/<id>. The record in ~/.weft/tunnels.json keeps that id for the same target, so
// an address you saved still works next time. Opening asks for Touch ID, a thread's call included. Tunnels close on
// their expiry, and nothing reopens one after a restart.

export interface TunnelRecord {
  id: string;
  folder: string;
  name: string;
  target: string;
}

export interface OpenTunnel extends TunnelRecord {
  address: string;
  expiresAt: number;
}

export const DEFAULT_HOURS = 4;
export const MAX_HOURS = 24;
const MAX_RESTARTS = 3;

interface Live {
  record: TunnelRecord;
  expiresAt: number;
  secret: string;
  gate: Awaited<ReturnType<typeof startGate>>;
  quick: QuickTunnel | null;
  restarts: number;
  timer: ReturnType<typeof setTimeout>;
}

const live = () => globalSingleton("__weftTunnels", () => new Map<string, Live>());
const file = () => path.join(DATA_DIR, "tunnels.json");
export const tunnelAddress = (id: string) => `${SITE}/t/${id}`;
const weftPort = () => Number(process.env.PORT) || undefined;

function readRecords(): TunnelRecord[] {
  try {
    return (JSON.parse(fs.readFileSync(file(), "utf8")) as { tunnels?: TunnelRecord[] }).tunnels ?? [];
  } catch {
    return [];
  }
}

function saveRecord(record: TunnelRecord) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(file(), JSON.stringify({ tunnels: [...readRecords().filter((r) => r.id !== record.id), record] }, null, 2));
}

const view = (t: Live): OpenTunnel => ({ ...t.record, address: tunnelAddress(t.record.id), expiresAt: t.expiresAt });

export function listTunnels(folders?: readonly string[]): OpenTunnel[] {
  const keep = folders && new Set(folders);
  return [...live().values()].filter((t) => !keep || keep.has(t.record.folder)).map(view);
}

async function publish(id: string, fields: { public_url: string | null; ticket_secret: string | null; expires_at: string | null }) {
  const { error } = await accountClient()
    .from("tunnels")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

// Points this target's webhook relays at the tunnel, or back at the stored relay, so a provider gets the route's real answer while it's open.
async function linkRelays(target: string, tunnelId: string | null) {
  const origin = new URL(target).origin;
  for (const hook of listWebhooks()) {
    if (!hook.relayId || new URL(hook.target).origin !== origin) continue;
    const tunnel_path = tunnelId ? new URL(hook.target).pathname : null;
    const { error } = await accountClient().from("webhook_relays").update({ tunnel_id: tunnelId, tunnel_path }).eq("id", hook.relayId);
    if (error) console.warn(`Tunnel: couldn't link ${hook.name}: ${error.message}`);
  }
}

async function startQuick(t: Live) {
  const bin = await ensureCloudflared();
  t.quick = await startQuickTunnel(bin, t.gate.port, () => void restart(t));
  await publish(t.record.id, { public_url: t.quick.url, ticket_secret: t.secret, expires_at: new Date(t.expiresAt).toISOString() });
}

// cloudflared ended on its own. A new start means a new URL, which the same address picks up from the row.
async function restart(t: Live) {
  if (live().get(t.record.id) !== t) return;
  t.quick = null;
  if (++t.restarts > MAX_RESTARTS) {
    console.warn(`Tunnel ${t.record.name}: closed after ${MAX_RESTARTS} restarts.`);
    await closeTunnel(t.record.id).catch(() => {});
    return;
  }
  await startQuick(t).catch((err: unknown) => {
    console.warn(`Tunnel ${t.record.name}: ${(err as Error).message}`);
    void restart(t);
  });
}

// The same project and target keep their id, and so their address.
async function recordFor(folder: string, target: string, name: string): Promise<TunnelRecord> {
  const known = readRecords().find((r) => r.folder === folder && r.target === target);
  const id = known?.id ?? randomUUID();
  // A plain insert: an upsert would also update id, which the table's grants leave out.
  const { data, error: readError } = await accountClient().from("tunnels").select("id").eq("id", id).maybeSingle();
  if (readError) throw new Error(readError.message);
  if (!data) {
    const { error } = await accountClient().from("tunnels").insert({ id, name });
    if (error) throw new Error(error.message);
  }
  const record = { id, folder, name, target };
  saveRecord(record);
  return record;
}

export async function openTunnel(input: { folder: string; target: string; hours?: number }, now = Date.now()): Promise<OpenTunnel> {
  const { data } = await accountClient().auth.getSession();
  if (!data.session) throw new Error("Sign in to your Weft account first: a tunnel's address only lets you in.");
  const target = cleanGateTarget(input.target, weftPort()).toString();
  const running = [...live().values()].find((t) => t.record.folder === input.folder && t.record.target === target);
  if (running) return view(running);
  const hours = Math.min(Math.max(input.hours ?? DEFAULT_HOURS, 0.25), MAX_HOURS);
  const name = new URL(target).host;
  const { approved } = (await shell("/tunnels/approve", { folder: input.folder, target, hours })) as { approved?: boolean };
  if (!approved) throw new Error("Weft didn't get your Touch ID, so no tunnel was opened.");

  const record = await recordFor(input.folder, target, name);
  const secret = randomBytes(32).toString("hex");
  const gate = await startGate({ tunnelId: record.id, secret, target, weftPort: weftPort() });
  const expiresAt = now + hours * 60 * 60 * 1000;
  const t: Live = { record, expiresAt, secret, gate, quick: null, restarts: 0, timer: setTimeout(() => void closeTunnel(record.id), expiresAt - now) };
  t.timer.unref();
  live().set(record.id, t);
  try {
    await startQuick(t);
    await linkRelays(target, record.id);
  } catch (err) {
    await closeTunnel(record.id).catch(() => {});
    throw err;
  }
  return view(t);
}

// The kill switch: the gate and cloudflared stop, and the row forgets the URL and the secret, so the address says closed.
export async function closeTunnel(id: string) {
  const t = live().get(id);
  if (!t) return;
  live().delete(id);
  clearTimeout(t.timer);
  t.quick?.stop();
  await t.gate.close();
  await linkRelays(t.record.target, null);
  await publish(id, { public_url: null, ticket_secret: null, expires_at: null });
}
