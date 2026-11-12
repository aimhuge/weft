// The board's side of "Pull Uncommitted Work from <Mac>" (docs/architecture/wip-sync.md#mac-to-mac): your other Macs
// for a synced project's menu, read from the device registry, and the ask for one's work, signed by main after Touch ID
// (lib/widen-signer.ts) over the project's name, its GitHub repo and the Mac's name, the same args the row carries.
import { apiFetch } from "./api-client";
import type { DevicesView } from "./device-registry";
import { macSource } from "./mac-host-verbs-source";
import { signWiden } from "./widen-signer";

export interface MacTwin {
  path: string;
  name: string;
  offline: boolean;
}

// Every other Mac of yours, as a menu twin for the project folder `name`. [] when signed out or the read fails: the
// menu must open regardless.
export async function otherMacs(name: string, read: () => Promise<DevicesView> = readDevices): Promise<MacTwin[]> {
  const view = await read().catch(() => null);
  return (view?.devices ?? [])
    .filter((d) => d.kind === "mac" && !d.here && !d.revokedAt && d.host)
    .map((d) => ({ path: macSource(d.host as string, name), name: d.name, offline: d.status !== "online" && d.status !== "busy" }));
}

async function readDevices(): Promise<DevicesView> {
  const res = await apiFetch("/api/devices");
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as DevicesView;
}

// The approval for one ask, after Touch ID: bound to that Mac, this project's name and repo, and the name shown.
export async function signMacAsk(device: string, folder: string, origin: string, mac: string, sign = signWiden) {
  const args = { folder, origin, mac };
  const widen = await sign({ host: device, card: "", verb: "tree.snapshot", change: { wip: args }, args });
  return { origin, mac, widen };
}
