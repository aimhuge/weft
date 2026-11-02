// Adding a worker by pairing it, wired (docs/architecture/device-registry.md): Settings → Devices starts, polls and
// cancels a worker's code over IPC, from the board window only (the `handle` electron/pairing-ipc.cjs passes in), never
// a thread or the control server: a thread that could pair would enrol its own box. It shares phone pairing's view of
// this Mac (its registered key and device id) and its Touch ID; the code's secret and the claim check stay in main.
const { createHostPairing } = require("./host-pairing.cjs");

/**
 * @param {(channel: string, fn: (...args: any[]) => unknown) => void} handle the board-only IPC handler
 * @param {Parameters<typeof createHostPairing>[0]} deps
 */
function registerHostPairing(handle, deps) {
  const hosts = createHostPairing(deps);
  handle("host-pairing:start", (orgId) => hosts.start(String(orgId ?? "")));
  handle("host-pairing:check", (id) => hosts.check(String(id)));
  handle("host-pairing:cancel", (id) => hosts.cancel(String(id)));
  return hosts;
}

module.exports = { registerHostPairing };
