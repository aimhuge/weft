"use client";

// The Services drawer's buttons on a worker's dev server (docs/architecture/dev-servers.md#on-a-worker): Open sends
// `dev.open` to the worker and waits for its private address, which takes the owner's Touch ID on this Mac and
// cloudflared starting on the box, so it waits minutes, not seconds; Stop sends `dev.stop`, Restart `dev.restart`, and
// Log asks `dev.log` for the run's last lines.
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

export async function restartWorkerDev(cardId: string, act: typeof actOnWorker = actOnWorker): Promise<void> {
  await act("dev.restart", { id: cardId });
}

// The run's last lines as the worker answered them, or a line saying there were none.
export async function workerDevLog(cardId: string, ask: typeof askWorker = askWorker): Promise<string> {
  const result = (await ask("dev.log", { id: cardId })) as { log?: unknown } | null;
  return typeof result?.log === "string" && result.log.trim() ? result.log : "Nothing logged yet.";
}
