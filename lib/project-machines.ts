// A project's menu, one group per other machine (lib/project-menu.ts MenuMachine): what this Mac can do with the
// project on each. The machines come from the device registry folded to one per box (lib/machines.ts), so the worker
// "m1mini" and the desktop "Weft on m1mini" are one group, with one way to pull: the worker's when it holds the project
// (no Touch ID), else the Mac's signed ask (lib/mac-twins.ts). The grouping is by name and for display only: every
// action still names the worker's project path or the Mac's own device id.
import type { DeviceView } from "./device-registry";
import { macSource } from "./mac-host-verbs-source";
import { machinesOf, type Machine } from "./machines";
import type { MenuMachine } from "./project-menu";
import type { SyncTwin } from "./tree-sync-menu";
import { parseWorkerProject } from "./worker-project";

export interface WorkerTwin {
  path: string;
  name: string;
  offline: boolean;
}

export interface MachinesInput {
  // The project folder's name, which is how another machine knows it.
  name: string;
  // The project syncs to weft.zip: another Mac answers only for one that does.
  synced: boolean;
  devices: DeviceView[];
  // The worker projects that are this project on a worker, and which of them this Mac keeps in sync.
  workerTwins: WorkerTwin[];
  syncTwins: SyncTwin[];
  // New threads in this project go to your worker (Run on Worker).
  onWorker: boolean;
}

// A headless worker installed on this same Mac: a second checkout of the project, beside this one.
export const HERE = "Worker on This Mac";

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

// A worker row's id as a worker project names it: the registry's id, or its `worker:<id>` address.
const isWorker = (d: DeviceView | undefined, workerId: string) => d !== undefined && (same(d.id, workerId) || same(d.host ?? "", `worker:${workerId}`));

const twinOf = (m: Machine, twins: WorkerTwin[]) => twins.find((t) => isWorker(m.worker, parseWorkerProject(t.path)?.workerId ?? ""));

// Where a pull from this machine comes from: its worker's project when that's up, else its Mac, else the worker anyway
// (the item then shows greyed, saying it's offline).
function pullFrom(m: Machine, twin: WorkerTwin | undefined, input: MachinesInput): string | undefined {
  if (twin && !twin.offline) return twin.path;
  // This Mac never asks itself: here, only the worker on the same box has a checkout of its own.
  if (!m.here && input.synced && m.mac?.host) return macSource(m.mac.host, input.name);
  return twin?.path;
}

const syncOf = (s: SyncTwin) => ({ path: s.path, on: s.on, ...(s.note ? { note: s.note } : {}) });

function entry(m: Machine, input: MachinesInput, takesThreads: boolean): MenuMachine | null {
  const twin = twinOf(m, input.workerTwins);
  const pull = pullFrom(m, twin, input);
  const synced = twin ? input.syncTwins.find((s) => s.path === twin.path) : undefined;
  if (!pull && !synced && !takesThreads) return null;
  return {
    name: m.here ? HERE : m.name,
    offline: m.here ? Boolean(twin?.offline) : !m.online,
    ...(pull ? { pull } : {}),
    ...(synced ? { sync: syncOf(synced) } : {}),
    ...(takesThreads ? { runThere: input.onWorker } : {}),
  };
}

// A worker twin the registry didn't list (signed out, or its read failed): its own group, so the menu loses nothing.
function unlisted(twin: WorkerTwin, input: MachinesInput): MenuMachine {
  const synced = input.syncTwins.find((s) => s.path === twin.path);
  return { name: twin.name, offline: twin.offline, pull: twin.path, ...(synced ? { sync: syncOf(synced) } : {}) };
}

export function menuMachines(input: MachinesInput): MenuMachine[] {
  const all = machinesOf(input.devices);
  const others = all.filter((m) => (m.here ? m.worker : m.mac || m.worker));
  // Run on Worker picks your worker by itself (lib/worker-handoff.ts pickWorker), so the tick sits on a machine only
  // when there is exactly one it could mean.
  const workers = all.filter((m) => m.worker);
  const only = workers.length === 1 ? workers[0] : undefined;
  const listed = others.flatMap((m) => entry(m, input, m.key === only?.key) ?? []);
  const found = new Set(others.flatMap((m) => twinOf(m, input.workerTwins)?.path ?? []));
  return [...listed, ...input.workerTwins.filter((t) => !found.has(t.path)).map((t) => unlisted(t, input))];
}
