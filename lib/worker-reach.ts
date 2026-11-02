// What a Weft Worker runs so its dev servers can be reached (docs/architecture/tunnels.md#on-a-worker): the line to its
// owner's Mac for tunnels and relays, its dev servers published for the Services drawer, and its tunnels tidied. The
// daemon owns them: a start closes what a dead process left published, and a stop closes what this one opened, since
// cloudflared and the gate die with the process anyway. Wired by scripts/weft-worker.ts.
import { closeLeftovers, closeTunnel, listTunnels } from "./tunnels";
import { createDevPublisher, type WorkerDevServer } from "./worker-dev-servers";
import { setMacLink, type MacLink } from "./worker-mac-ask";

export const DEV_PUBLISH_MS = 10_000;

export interface ReachCalls {
  macAsk: MacLink["ask"];
  deviceResult: MacLink["result"];
  deviceCancel: MacLink["cancel"];
  tunnelOpen: MacLink["tunnelOpen"];
  tunnelClose: MacLink["tunnelClose"];
  setDevServers: (servers: WorkerDevServer[]) => Promise<unknown>;
}

export function startWorkerReach(reg: ReachCalls, log: (msg: string) => void = console.log, everyMs = DEV_PUBLISH_MS): () => Promise<void> {
  setMacLink({ ask: reg.macAsk, result: reg.deviceResult, cancel: reg.deviceCancel, tunnelOpen: reg.tunnelOpen, tunnelClose: reg.tunnelClose });
  void closeLeftovers(log);
  const publish = createDevPublisher(reg.setDevServers, undefined, log);
  void publish();
  const timer = setInterval(() => void publish(), everyMs);
  timer.unref();
  return async () => {
    clearInterval(timer);
    for (const t of listTunnels()) await closeTunnel(t.id).catch((err: unknown) => log(`Tunnel ${t.name}: ${(err as Error).message}`));
  };
}
