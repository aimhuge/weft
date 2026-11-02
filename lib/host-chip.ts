// What the host chip in a worker card's pane header says (components/web-board/HostChip.tsx): the machine the card
// runs on, and "+ simulator" while a simulator runs for it, on that machine or (Local Simulator mode) on this Mac.

export interface HostChipState {
  // The worker's name; the web board, which doesn't know it, leaves it out.
  worker?: string;
  // The worker's live screen is in the pane.
  streaming: boolean;
  // Local Simulator mode is on: the card's app runs on a simulator on this Mac.
  localOn: boolean;
}

export const THIS_MAC = "this Mac";
export const SOME_WORKER = "Worker";

export function hostName(worker: string | undefined): string {
  return worker?.trim() || SOME_WORKER;
}

export function hostChipLabel({ worker, streaming, localOn }: HostChipState): string {
  if (localOn) return `${THIS_MAC} + simulator`;
  const host = hostName(worker);
  return streaming ? `${host} + simulator` : host;
}

// Whether the chip has anything to say: on the desktop board a worker card always does (it offers Local Simulator);
// on weft.zip only once there's a simulator streaming or one the board could start. A local card never draws it:
// its pane is this Mac's own and has nothing host-specific in it.
export function hostChipShown({ local, streaming, canStart }: { local: boolean; streaming: boolean; canStart: boolean }): boolean {
  return local || streaming || canStart;
}
