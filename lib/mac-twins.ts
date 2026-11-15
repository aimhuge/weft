// The board's side of "Pull Uncommitted Work from <Mac>" (docs/architecture/wip-sync.md#mac-to-mac): your other Macs
// for a synced project's menu, read from the device registry, and the ask for one's work, signed by main after Touch ID
// (lib/widen-signer.ts) over the project's name, its GitHub repo and the Mac's name, the same args the row carries.
import { apiFetch } from "./api-client";
import type { DevicesView } from "./device-registry";
import { signWiden } from "./widen-signer";

// Every device of yours, for a project menu's machine groups (lib/project-machines.ts). [] when signed out or the read
// fails: the menu must open regardless.
export async function myDevices(read: () => Promise<DevicesView> = readDevices): Promise<DevicesView["devices"]> {
  return (await read().catch(() => null))?.devices ?? [];
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
