import fs from "node:fs";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { globalSingleton } from "./global-singleton";
import { SITE } from "./site";
import { DATA_DIR } from "./store";
import { ensureCloudflared, startQuickTunnel, type QuickTunnel } from "./tunnel-cloudflared";
import { cleanGateTarget, startGate } from "./tunnel-gate";
import { macTunnels } from "./tunnel-mac";
import { workerTunnels } from "./tunnel-worker";
import type { TunnelHost, TunnelRecord } from "./tunnel-host";

// Tunnels (docs/architecture/tunnels.md): a public address for a local port, private to you. Each open tunnel is a
// gate (lib/tunnel-gate.ts) with cloudflared in front of it. The URL changes on every start, so it goes on a Supabase
// row behind the stable /t/<id>. The record in tunnels.json keeps that id for the same target, so an address you saved
// still works next time. Opening asks for Touch ID, a thread's call included. Tunnels close on their expiry, and nothing
// reopens one after a restart. Who approves and who writes the row is the host's (lib/tunnel-host.ts): the Mac does
// both itself (lib/tunnel-mac.ts); a worker asks its owner's Mac and writes through its key (lib/tunnel-worker.ts).

export type { TunnelRecord } from "./tunnel-host";

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
const opening = () => globalSingleton("__weftTunnelsOpening", () => new Map<string, Promise<OpenTunnel>>());
const file = () => path.join(DATA_DIR, "tunnels.json");
export const tunnelAddress = (id: string) => `${SITE}/t/${id}`;
// A worker runs with WEFT_WORKER=1 (scripts/weft-worker.ts), read here rather than from lib/worker-pane.ts, which imports this.
const host = (): TunnelHost => (process.env.WEFT_WORKER === "1" ? workerTunnels : macTunnels);

export function readRecords(): TunnelRecord[] {
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

// The same project and target keep their id, and so their address.
function recordFor(folder: string, target: string, name: string): TunnelRecord {
  const known = readRecords().find((r) => r.folder === folder && r.target === target);
  const record = { id: known?.id ?? randomUUID(), folder, name, target };
  saveRecord(record);
  return record;
}

const view = (t: Live): OpenTunnel => ({ ...t.record, address: tunnelAddress(t.record.id), expiresAt: t.expiresAt });

export function listTunnels(folders?: readonly string[]): OpenTunnel[] {
  const keep = folders && new Set(folders);
  return [...live().values()].filter((t) => !keep || keep.has(t.record.folder)).map(view);
}

// The open tunnel to a localhost URL's server, from any folder: what a worker's pane trades the URL for.
export function tunnelFor(url: string): OpenTunnel | undefined {
  if (!URL.canParse(url)) return undefined;
  const origin = new URL(url).origin;
  return listTunnels().find((t) => new URL(t.target).origin === origin);
}

async function startQuick(t: Live) {
  const bin = await ensureCloudflared();
  t.quick = await startQuickTunnel(bin, t.gate.port, () => void restart(t));
  await host().publish(t.record.id, { url: t.quick.url, secret: t.secret, expiresAt: t.expiresAt });
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

export async function openTunnel(input: { folder: string; target: string; hours?: number; cardId?: string }, now = Date.now()): Promise<OpenTunnel> {
  const h = host();
  await h.ready();
  const target = cleanGateTarget(input.target, h.weftPort()).toString();
  const running = [...live().values()].find((t) => t.record.folder === input.folder && t.record.target === target);
  if (running) return view(running);
  // One open per server at a time: a worker's approval waits minutes on the Mac, and a second open meanwhile (the
  // drawer's Open beside a thread's call) would start a second gate and cloudflared and orphan the first.
  const key = `${input.folder}\n${target}`;
  const pending = opening().get(key);
  if (pending) return pending;
  const started = startTunnel(h, input, target, now).finally(() => opening().delete(key));
  opening().set(key, started);
  return started;
}

async function startTunnel(h: TunnelHost, input: { folder: string; hours?: number; cardId?: string }, target: string, now: number): Promise<OpenTunnel> {
  const hours = Math.min(Math.max(input.hours ?? DEFAULT_HOURS, 0.25), MAX_HOURS);
  const record = recordFor(input.folder, target, new URL(target).host);
  const { until } = await h.approve(record, hours, input.cardId);

  const secret = randomBytes(32).toString("hex");
  const gate = await startGate({ tunnelId: record.id, secret, target, weftPort: h.weftPort() });
  const expiresAt = Math.min(now + hours * 60 * 60 * 1000, until ?? Infinity);
  const t: Live = { record, expiresAt, secret, gate, quick: null, restarts: 0, timer: setTimeout(() => void closeTunnel(record.id), expiresAt - now) };
  t.timer.unref();
  live().set(record.id, t);
  try {
    await startQuick(t);
    await h.linkRelays(target, record.id);
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
  await host().linkRelays(t.record.target, null);
  await host().unpublish(id);
}

// A worker's start: whatever the last process left published is closed, since its gate and cloudflared died with it.
export async function closeLeftovers(log: (msg: string) => void = console.warn) {
  for (const record of readRecords()) {
    if (live().has(record.id)) continue;
    await host()
      .unpublish(record.id)
      .catch((err: unknown) => log(`Tunnel ${record.name}: ${(err as Error).message}`));
  }
}
