import path from "node:path";
import { NO_TOUCH_ID, type TunnelHost } from "./tunnel-host";
import { askMac, macLink } from "./worker-mac-ask";

// A worker's tunnel host (docs/architecture/tunnels.md#on-a-worker). It has no session and no Touch ID, so its owner's
// Mac approves: a `tunnel_open` call, Touch ID there, and the Mac makes the row (as the owner, so /t/<id> lets only them
// in) and stamps it approved for this worker, this target and these hours. The worker's key can then put a quick
// tunnel's URL on that row until the approval runs out (worker_tunnel_open), and the worker's relays to this server
// follow it in the same call. Nothing here can approve itself: the row's approval is only writable by the owner.

export const TUNNEL_OPEN_TOOL = "tunnel_open";

export const workerTunnels: TunnelHost = {
  // A throw inside the executor rejects, as an async function's would.
  ready: () =>
    new Promise<void>((resolve) => {
      macLink();
      resolve();
    }),
  // A worker has no board server for a tunnel to reach by mistake.
  weftPort: () => undefined,
  async approve(record, hours, cardId) {
    const answer = await askMac(cardId, TUNNEL_OPEN_TOOL, { tunnel: record.id, target: new URL(record.target).origin, hours, folder: path.basename(record.folder) });
    if (answer.approved !== true) throw new Error(NO_TOUCH_ID);
    return typeof answer.until === "number" ? { until: answer.until } : {};
  },
  async publish(id, open) {
    await macLink().tunnelOpen(id, open.url, open.secret);
  },
  unpublish: (id) => macLink().tunnelClose(id),
  // worker_tunnel_open and worker_tunnel_close link and unlink the worker's relays themselves.
  linkRelays: () => Promise.resolve(),
};
