// The workspace keys a Weft Worker holds (docs/architecture/mobile-security.md#sealing-on-a-weft-worker): the grants its
// Mac made it, read through worker_key_grants(p_key) and each checked (lib/worker-key-grant.ts). In memory only: never
// written to disk, read again at start, on a key_grant ping (lib/worker-wake.ts listenForKeyGrants) and every ten
// minutes. A refresh replaces the ring, so a grant the Mac dropped (Re-pin, Revoke) is gone from the box on the next one.
//
// The seal floor. Once the worker has sealed, it never falls back to plain by itself: a server that hid its grants (or a
// restart with the network down) would otherwise get the next rows in the clear. seal-floor.json in the worker's home
// says "this box seals"; while it's there and the ring is empty, `state()` is "hold" and the publisher keeps rows back
// until a grant arrives. It names no key. Deleting it on the box (out of reach of the server) goes back to plain.
import fs from "node:fs";
import path from "node:path";
import type { SyncKey, SyncKeyring } from "./sync-seal";
import { acceptGrant, type GrantContext } from "./worker-key-grant";

const EVERY_MS = 10 * 60_000;

export interface SealFloor {
  held(): boolean;
  set(): void;
}

export function sealFloorAt(home: string): SealFloor {
  const file = path.join(home, "seal-floor.json");
  return {
    held: () => fs.existsSync(file),
    set() {
      if (fs.existsSync(file)) return;
      fs.mkdirSync(home, { recursive: true, mode: 0o700 });
      fs.writeFileSync(file, `${JSON.stringify({ seals: true, since: new Date().toISOString() })}\n`, { mode: 0o600 });
    },
  };
}

export interface KeyringDeps {
  // The worker_key_grants(p_key) rows.
  read: () => Promise<unknown[]>;
  // Built fresh each time: the Mac keys this box trusts can change (a revoked Mac, lib/worker-mac-revocation.ts).
  context: () => GrantContext;
  floor: SealFloor;
  log: (msg: string) => void;
}

const versionOf = (row: unknown): string => {
  const v = (row as { version?: unknown } | null)?.version;
  return typeof v === "number" || typeof v === "string" ? String(v) : "?";
};

export type SealState = { key: SyncKey } | "plain" | "hold";

export function createWorkerKeyring(deps: KeyringDeps) {
  let ring = new Map<number, string>();
  const told = new Set<string>();
  const tell = (msg: string) => {
    if (told.has(msg)) return;
    told.add(msg);
    deps.log(msg);
  };

  // Reads the grants again; a read that fails keeps the ring it had.
  async function refresh(): Promise<void> {
    let rows: unknown[];
    try {
      rows = await deps.read();
    } catch (err) {
      tell(`Weft Worker: reading its key grants: ${(err as Error).message}`);
      return;
    }
    const ctx = deps.context();
    const next = new Map<number, string>();
    for (const row of rows) {
      const got = acceptGrant(row, ctx);
      if ("key" in got) next.set(got.key.version, got.key.key);
      else tell(`Weft Worker: refused a key grant (v${versionOf(row)}): ${got.refused}`);
    }
    const before = Math.max(0, ...ring.keys());
    ring = next;
    const now = Math.max(0, ...ring.keys());
    if (now) deps.floor.set();
    if (now !== before) deps.log(now ? `Weft Worker: sealing its threads with workspace key v${now}` : "Weft Worker: holds no workspace key now");
  }

  function current(): SyncKey | null {
    const version = Math.max(0, ...ring.keys());
    const key = ring.get(version);
    return key ? { version, key } : null;
  }

  return {
    refresh,
    ring: (): SyncKeyring => ring,
    current,
    // Seal with this key, publish plain (never sealed), or hold rows back (sealed before, no key now).
    state(): SealState {
      const key = current();
      if (key) return { key };
      return deps.floor.held() ? "hold" : "plain";
    },
    // Reads now and every `everyMs`; the returned function stops.
    start(everyMs = EVERY_MS): () => void {
      const timer = setInterval(() => void refresh(), everyMs);
      timer.unref();
      return () => clearInterval(timer);
    },
  };
}

export type WorkerKeyring = ReturnType<typeof createWorkerKeyring>;
