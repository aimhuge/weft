// Adding a worker by pairing it, wired (docs/architecture/device-registry.md): Settings → Devices starts, polls and
// cancels a worker's code over IPC, from the board window only (the `handle` electron/pairing-ipc.cjs passes in), never
// a thread or the control server: a thread that could pair would enrol its own box. It shares phone pairing's view of
// this Mac (its registered key and device id) and its Touch ID; the code's secret and the claim check stay in main.
const { createHostPairing } = require("./host-pairing.cjs");
const { createWorkerRepair } = require("./worker-repair.cjs");

/**
 * @param {(channel: string, fn: (...args: any[]) => unknown) => void} handle the board-only IPC handler
 * @param {Parameters<typeof createHostPairing>[0] & { macSign?: (message: string) => Promise<string> }} deps
 * @param {{ pin: (id: string, keys: { name: string, publicKey: string, signKey: string }) => void, forget: (id: string) => boolean }} [pins]
 */
function registerHostPairing(handle, deps, pins = undefined) {
  const hosts = createHostPairing({ ...deps, ...(pins ? { pinWorker: (id, keys) => pins.pin(id, keys) } : {}) });
  handle("host-pairing:start", (orgId) => hosts.start(String(orgId ?? "")));
  handle("host-pairing:check", (id) => hosts.check(String(id)));
  handle("host-pairing:cancel", (id) => hosts.cancel(String(id)));
  // Re-pin (Settings → Devices): forget a worker's pinned keys after Touch ID, so its next secret ask pins afresh
  // (electron/worker-pins.cjs). For a worker reset on purpose; the board window only, like the rest of this file.
  handle("worker-pins:forget", async (id, name) => {
    if (!pins) return { forgotten: false };
    if (!(await deps.confirm(`forget the keys this Mac pinned for the worker ${String(name ?? id)}, so its next secret ask pins new ones`))) return { denied: true };
    return { forgotten: pins.forget(String(id)) };
  });
  // Approve re-pair (Settings → Devices): Touch ID, then this Mac signs the swap to the Mac in the pasted code
  // (electron/worker-repair.cjs). Without the signer (no approval key wired) there's nothing to sign with.
  handle("worker-repair:approve", async (id, name, code) => {
    if (!deps.macSignKey || !deps.macSign) throw new Error("This Mac has no approval key to sign a re-pair with.");
    const repair = createWorkerRepair({ confirm: deps.confirm, sign: deps.macSign, publicKey: deps.macSignKey });
    return repair.approve(String(id ?? ""), String(name ?? ""), String(code ?? ""));
  });
  return hosts;
}

module.exports = { registerHostPairing };
