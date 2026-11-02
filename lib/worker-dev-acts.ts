"use client";

// The Services drawer's buttons on a worker's dev server (docs/architecture/dev-servers.md#on-a-worker): Open sends
// `dev.open` to the worker and waits for its private address, which takes the owner's Touch ID on this Mac and
// cloudflared starting on the box, so it waits minutes, not seconds; Stop sends `dev.stop`.
import { isTunnelAddress } from "./tunnel-link";
import { ACT_WAIT, actOnWorker, askWorker } from "./worker-acts";

export const DEV_OPEN_WAIT = { ...ACT_WAIT, claimed: 6 * 60_000 };

export async function openWorkerDev(cardId: string, ask: typeof askWorker = askWorker): Promise<string> {
  const result = (await ask("dev.open", { id: cardId }, DEV_OPEN_WAIT)) as { address?: unknown } | null;
  if (!isTunnelAddress(result?.address)) throw new Error("Your worker didn't give the server an address.");
  return result.address;
}

export async function stopWorkerDev(cardId: string, act: typeof actOnWorker = actOnWorker): Promise<void> {
  await act("dev.stop", { id: cardId });
}
