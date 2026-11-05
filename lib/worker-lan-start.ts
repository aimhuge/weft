// The worker's LAN path, started beside the daemon (scripts/weft-worker.ts; docs/architecture/weft-worker.md#the-lan-path):
// the offer port (lib/worker-lan.ts) and the signed `_weft._tcp` hint that points at it (lib/lan-mdns.ts advertise).
// It starts only where it can be used: a box paired with a Mac (a pinned Mac key to take offers from, and a sign key
// for the hint the Mac checks). WEFT_LAN=0 turns it off; WEFT_LAN_PORT fixes the port (default: any free one).
import os from "node:os";
import path from "node:path";
import makeMdns from "multicast-dns";
import { hintFingerprint, hintTxt, HINT_REFRESH_MS, signHint } from "./lan-hint";
import { advertise, type MdnsLike } from "./lan-mdns";
import type { SealedAnswer } from "./rtc-signal";
import { fileNonceStore, nonceBook } from "./widen-nonces";
import { createLanServer } from "./worker-lan";
import { macKeysAt } from "./worker-mac-keys";
import type { Sealed } from "./worker-seal";

export interface WorkerLanOptions {
  home: string;
  workerId: string;
  boxKey: string;
  // The worker's paired sign key (lib/worker-secret-wiring.ts pairedSigner); none on a token-enrolled box.
  sign?: (message: string) => string;
  macKeys: () => string[];
  open: (sealed: Sealed) => Promise<SealedAnswer>;
  env?: Record<string, string | undefined>;
  mdns?: () => MdnsLike;
  addresses?: () => string[];
  now?: () => number;
  log?: (msg: string) => void;
}

// This box's IPv4 addresses on its networks, for the hint's A records.
export function lanAddresses(nets: ReturnType<typeof os.networkInterfaces> = os.networkInterfaces()): string[] {
  return Object.values(nets).flatMap((list) => (list ?? []).filter((n) => n.family === "IPv4" && !n.internal).map((n) => n.address));
}

// For the daemon: the pinned Mac keys read from this box's home each time (so `weft-worker forget-macs` takes effect at
// once), and a LAN path that won't start (its port taken) logged rather than stopping the worker.
export function startWorkerLanSafely(o: Omit<WorkerLanOptions, "macKeys">): Promise<() => Promise<void>> {
  const macs = macKeysAt(o.home);
  return startWorkerLan({ ...o, macKeys: () => macs.pinned() }).catch((err: unknown) => {
    o.log?.(`Weft Worker: no LAN path: ${(err as Error).message}`);
    return () => Promise.resolve();
  });
}

export async function startWorkerLan(o: WorkerLanOptions): Promise<() => Promise<void>> {
  const log = o.log ?? (() => {});
  const env = o.env ?? process.env;
  const now = o.now ?? Date.now;
  const off = (why: string) => {
    log(`Weft Worker: no LAN path (${why}); boards reach it through Supabase.`);
    return () => Promise.resolve();
  };
  if (env.WEFT_LAN === "0") return off("WEFT_LAN=0");
  const sign = o.sign;
  if (!sign || !o.macKeys().length) return off("this box wasn't paired with a Mac");
  const server = createLanServer({ workerId: o.workerId, macKeys: o.macKeys, nonces: nonceBook(fileNonceStore(path.join(o.home, "lan-nonces.json")), now), open: o.open, now, log });
  const port = await server.listen(Number(env.WEFT_LAN_PORT) || 0, "0.0.0.0");
  const mdns = (o.mdns ?? (() => makeMdns() as unknown as MdnsLike))();
  const id8 = o.workerId.slice(0, 8).toLowerCase();
  const fp = hintFingerprint(o.boxKey);
  const stop = advertise(mdns, {
    instance: `weft-${id8}`,
    host: `weft-${id8}.local`,
    port,
    txt: () => hintTxt(signHint({ id: o.workerId.toLowerCase(), fp, port, at: now() }, sign)),
    addresses: o.addresses ?? (() => lanAddresses()),
    refreshMs: HINT_REFRESH_MS,
    now,
    log,
  });
  log(`Weft Worker: offering lines on the LAN, port ${port} (_weft._tcp).`);
  return async () => {
    stop();
    mdns.destroy();
    await server.close();
  };
}
