// A Weft Worker's sealing, wired for scripts/weft-worker.ts (docs/architecture/mobile-security.md#sealing-on-a-weft-worker):
// the keyring its Mac's grants fill (lib/worker-keyring.ts), read once before the daemon starts, again on every key_grant
// ping and every ten minutes; the sealer its publisher and page uploads use; and its attachment reader, opening.
import { macKeysAt } from "./worker-mac-keys";
import { sodium } from "./sodium";
import { createWorkerKeyring, sealFloorAt } from "./worker-keyring";
import { openingReader, workerSealing } from "./worker-sealing";
import type { SealKeys } from "./worker-seal";
import type { Rpc } from "./worker-registry";
import type { WakeHooks } from "./worker-wake";

export interface SealingWireDeps {
  home: string;
  config: { workerId: string; orgId: string; key: string };
  rpc: Rpc;
  keys: SealKeys;
  // A card with a share link stays plain.
  isShared: (cardId: string) => boolean;
  readBlob: (sha: string) => Promise<Buffer | null>;
  // Joins the key_grant topic (lib/worker-wake.ts listenForKeyGrants); the returned function leaves it.
  listen?: (hooks: WakeHooks) => () => void;
  log: (msg: string) => void;
  everyMs?: number;
}

export async function startWorkerSealing(deps: SealingWireDeps) {
  const { config } = deps;
  const ring = createWorkerKeyring({
    read: async () => {
      const { data, error } = await deps.rpc("worker_key_grants", { p_key: config.key });
      if (error) throw new Error(error.message);
      return Array.isArray(data) ? (data as unknown[]) : [];
    },
    // Read each time: the Macs this box trusts can change while it runs (a revoked pairing Mac drops out of pinned()).
    context: () => ({ orgId: config.orgId, workerId: config.workerId, keys: deps.keys, macs: macKeysAt(deps.home).pinned() }),
    floor: sealFloorAt(deps.home),
    log: deps.log,
  });
  await ring.refresh();
  const stopTimer = ring.start(deps.everyMs);
  const leave = deps.listen?.({ ping: () => void ring.refresh(), up: () => void ring.refresh(), down: () => undefined });
  const sealing = workerSealing(ring, await sodium(), deps.isShared);
  return {
    ring,
    sealer: sealing.sealer,
    blobSeal: sealing.blobSeal,
    reader: openingReader(deps.readBlob, ring, config.orgId, sodium, deps.log),
    stop() {
      stopTimer();
      leave?.();
    },
  };
}
