// The manual QA switch on a worker's card (docs/architecture/manual-qa.md). Reached only from Weft's own window (the route
// is `elevated`). Switching on asks for Touch ID in Electron main, keeps the grant on this Mac and tells the worker where
// to send the card's device tools. Nothing here runs without the yes.
import { shell } from "./browser-shell";
import type { NewCommand } from "./cloud-commands";
import { deviceId } from "./device-id";
import { activeGrant, grantQa, revokeQa } from "./qa-grants";
import { stableId } from "./qa-id";
import { listDevices } from "./simulator-devices";
import { qaCommand } from "./worker-commands";

interface Target {
  workerName: string;
  orgId: string;
  device: string;
  folder: string;
  cardId: string;
  workerId: string;
}

// What the switch reads: this Mac's devices, its id, and the device a card has an approval for here.
export async function qaState(cardId: string | null) {
  return { devices: await listDevices(), mac: deviceId(), approved: cardId ? (activeGrant(cardId)?.name ?? null) : null };
}

export async function switchQa(cardId: string, device: string | null, target: Target): Promise<NewCommand> {
  if (!device) {
    revokeQa(cardId);
    return qaCommand(target, null);
  }
  const picked = (await listDevices()).find((d) => stableId(d) === device);
  if (!picked) throw new Error(`${device} isn't on this Mac.`);
  const { approved } = (await shell("/qa/approve", { worker: target.workerName, folder: target.folder, device: picked.name })) as { approved?: boolean };
  if (approved !== true) throw new Error("Manual QA stays off: you didn't approve it.");
  grantQa({ cardId, workerId: target.workerId, device, name: picked.name });
  // With no folder synced, the inbox isn't listening, and the worker wouldn't see this Mac as there.
  await (await import("./cloud-inbox")).refreshCloudInbox();
  return qaCommand(target, deviceId());
}
