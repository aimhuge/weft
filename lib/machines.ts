// Settings → Devices shows one row per physical machine. The registry has one row per key or heartbeat, so a Weft
// desktop appears twice (a heartbeat row named by hostname, and a vault-key `devices` row "Weft on <host>.local" whose
// host is null until linked) and a headless worker plus the desktop on the same box share no id.
//
// NAME MATCHING IS DISPLAY ONLY. It folds rows into one line on screen and must never decide trust, a revoke target,
// a key grant or a pairing: every action still goes to the underlying row's own id.
//
// Shape: Mac rows group by `host` when set; host-less Mac rows and worker rows attach by machineName(name). Only mac
// and worker kinds group. A phone or browser is one Machine each (key = its id, the row in `others`). Within a group,
// `mac` is the live Mac row (one with a host preferred), `worker` the live worker row, any further live rows are
// `others`, and revoked rows go to `revoked` and never make the machine online or here.
import type { DeviceView } from "./device-registry";

export interface Machine {
  key: string;
  name: string;
  here: boolean;
  online: boolean;
  mac?: DeviceView;
  worker?: DeviceView;
  others: DeviceView[];
  revoked: DeviceView[];
}

const stripName = (raw: string) => raw.trim().replace(/^weft on\s+/i, "").replace(/\.local$/i, "");

// The name two rows of one machine share: "Weft on MacBook-Air-3.local" and "macbook-air-3" both give "macbook-air-3".
export function machineName(raw: string): string {
  return stripName(raw).toLowerCase();
}

const live = (d: DeviceView) => !d.revokedAt;
const isOnline = (d: DeviceView) => d.status === "online" || d.status === "busy";

function build(key: string, rows: DeviceView[]): Machine {
  const liveRows = rows.filter(live);
  const mac = liveRows.find((d) => d.kind === "mac" && d.host) ?? liveRows.find((d) => d.kind === "mac");
  const worker = liveRows.find((d) => d.kind === "worker");
  const named = liveRows.length ? liveRows : rows;
  // `named` is never empty: a group is made from at least one row.
  const name = named.map((d) => stripName(d.name)).sort((a, b) => a.length - b.length)[0] as string;
  return {
    key,
    name,
    here: liveRows.some((d) => d.here),
    online: liveRows.some(isOnline),
    mac,
    worker,
    others: liveRows.filter((d) => d !== mac && d !== worker),
    revoked: rows.filter((d) => !live(d)),
  };
}

export function machinesOf(devices: DeviceView[]): Machine[] {
  const groups = new Map<string, DeviceView[]>();
  const byName = new Map<string, string>();
  const add = (key: string, d: DeviceView) => {
    groups.set(key, [...(groups.get(key) ?? []), d]);
    if (!byName.has(machineName(d.name))) byName.set(machineName(d.name), key);
  };
  const single: DeviceView[] = [];
  for (const d of devices) {
    if (d.kind === "mac" && d.host) add(`host:${d.host}`, d);
    else if (d.kind !== "mac" && d.kind !== "worker") single.push(d);
  }
  for (const d of devices) {
    if ((d.kind === "mac" && !d.host) || d.kind === "worker") add(byName.get(machineName(d.name)) ?? `${d.kind}:${d.id}`, d);
  }
  const out = [...groups].map(([key, rows]) => build(key, rows));
  for (const d of single) out.push(build(d.id, [d]));
  return out.sort((a, b) => Number(b.here) - Number(a.here) || Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
}
