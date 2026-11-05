// Settings → Devices → Move threads to… (docs/architecture/device-registry.md#moving-a-workers-threads): which of your
// workers can take another's threads, and when a worker offers to hand them over. The server checks it all again
// (worker_move_cards); this only decides what the page shows.
import type { DeviceView } from "./device-registry";

// Your other live workers in the same workspace: the only ones worker_move_cards accepts.
export function moveTargets(from: DeviceView, devices: readonly DeviceView[]): DeviceView[] {
  return devices.filter((d) => d.kind === "worker" && d.id !== from.id && !d.revokedAt && d.orgId === from.orgId);
}

// A worker that owns threads but can't run them (revoked, or not online) offers Move threads to…, when there's
// somewhere to move them. A live worker's threads move from Revoke's confirm instead.
export function offersMove(d: DeviceView, devices: readonly DeviceView[]): boolean {
  const idle = Boolean(d.revokedAt) || (d.status !== "online" && d.status !== "busy");
  return d.kind === "worker" && d.threads > 0 && idle && moveTargets(d, devices).length > 0;
}

export const threadsText = (n: number): string => (n === 1 ? "1 thread" : `${n} threads`);

export function movedNote(from: string, to: string, moved: number): string {
  return moved ? `Moved ${threadsText(moved)} from ${from} to ${to}.` : `${from} had no threads to move.`;
}
