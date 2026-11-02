// Connectors lent to paired Weft Workers, wired (electron/worker-connectors.cjs): Settings → Devices lists, turns on and
// turns off over IPC from the board window only (the `handle` electron/pairing-ipc.cjs passes in), never a thread or the
// control server, and a timer sends each one that's on a fresh token before the last runs out.
const { createWorkerConnectors } = require("./worker-connectors.cjs");

const EVERY_MS = 5 * 60_000;

/**
 * @param {(channel: string, fn: (...args: any[]) => unknown) => void} handle the board-only IPC handler
 * @param {Parameters<typeof createWorkerConnectors>[0]} deps
 * @param {{ everyMs?: number, every?: (fn: () => void, ms: number) => { unref?: () => void } }} [timer]
 */
function registerWorkerConnectors(handle, deps, { everyMs = EVERY_MS, every = setInterval } = {}) {
  const connectors = createWorkerConnectors(deps);
  handle("worker-connectors:list", () => connectors.list());
  handle("worker-connectors:enable", (id, connector, account) => connectors.enable(String(id ?? ""), String(connector ?? ""), account ? String(account) : undefined));
  handle("worker-connectors:disable", (id, connector) => connectors.disable(String(id ?? ""), String(connector ?? "")));
  every(() => void connectors.refresh().catch((err) => console.warn(`Worker connectors: ${err.message}`)), everyMs).unref?.();
  return connectors;
}

module.exports = { registerWorkerConnectors, EVERY_MS };
