// The values a paired Mac keeps on this Weft Worker (docs/architecture/secrets.md#kept-on-a-worker): "Keep on this
// worker" in Settings → Devices. Each value arrives in a Mac-signed `vault_keep` command (lib/worker-keep-wire.ts),
// sealed to this box's key for its own slot and version, and is stored exactly as it came, in kept-vault.json (mode
// 600) in the worker's home, which threads' tools can't reach (lib/secret-guard-files.ts). Nothing here opens a value
// on its own: open() runs only for a secret_use the Mac signed after the user's Touch ID, for the names and versions it
// names (lib/worker-secret-asks.ts). The file belongs to the Mac that wrote it: one written for another Mac reads as
// empty, and pairing elsewhere, forget-macs and a revoke (wipeWhenRevoked) delete it.
//
// What sealing at rest buys, honestly: a copy of the file alone (a backup, a synced folder) opens nothing. It doesn't
// keep a card's code out: every card runs as the same OS user as the daemon, and seal-key.json sits beside it.
import fs from "node:fs";
import path from "node:path";
import { KEEP_MAX_AGE_MS, keepMessage, keptPurpose, readKeep, type Keep } from "./worker-keep-wire";
import { KEPT_FILE, macSigned, wipeKept, type MacKeys } from "./worker-mac-keys";
import { sealedOf, type Sealed } from "./worker-seal";

interface Slot {
  version: number;
  sealed: Sealed;
}

type Vaults = Record<string, Record<string, Record<string, Slot>>>;

interface Store {
  v: 1;
  mac: string;
  seq: number;
  vaults: Vaults;
}

const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const empty = (mac: string): Store => ({ v: 1, mac, seq: 0, vaults: {} });

// Only the slots that are what they must be; anything else in the file is dropped.
function slotsOf(raw: unknown): Record<string, Slot> {
  const out: Record<string, Slot> = {};
  for (const [name, s] of Object.entries(isObject(raw) ? raw : {})) {
    const sealed = isObject(s) ? sealedOf(s.sealed) : null;
    if (sealed && isObject(s) && typeof s.version === "number") out[name] = { version: s.version, sealed };
  }
  return out;
}

function storeOf(text: string): Store | null {
  try {
    const raw: unknown = JSON.parse(text);
    if (!isObject(raw) || raw.v !== 1 || typeof raw.mac !== "string" || typeof raw.seq !== "number" || !isObject(raw.vaults)) return null;
    const vaults: Vaults = {};
    for (const [repo, envs] of Object.entries(raw.vaults)) vaults[repo] = Object.fromEntries(Object.entries(isObject(envs) ? envs : {}).map(([env, slots]) => [env, slotsOf(slots)]));
    return { v: 1, mac: raw.mac, seq: raw.seq, vaults };
  } catch {
    return null;
  }
}

// What the store holds after one command; returns how many values that environment keeps now. Rebuilt, never deleted
// in place, so an emptied environment or vault leaves no key behind.
function applyOp(store: Store, k: Keep): number {
  if (k.op === "wipe") {
    store.vaults = {};
    return 0;
  }
  const envs = store.vaults[k.repo] ?? {};
  const was = envs[k.environment] ?? {};
  // A put is the environment's whole set, so a name gone from the Mac's vault goes from here too.
  const slots = k.op === "put" ? Object.fromEntries(k.entries.map((e) => [e.name, { version: e.version, sealed: e.sealed }])) : k.op === "delete" ? Object.fromEntries(Object.entries(was).filter(([name]) => !k.names.includes(name))) : {};
  const kept = Object.keys(slots).length;
  const nextEnvs = { ...without(envs, k.environment), ...(kept ? { [k.environment]: slots } : {}) };
  store.vaults = { ...without(store.vaults, k.repo), ...(Object.keys(nextEnvs).length ? { [k.repo]: nextEnvs } : {}) };
  return kept;
}

const without = <T>(o: Record<string, T>, key: string): Record<string, T> => Object.fromEntries(Object.entries(o).filter(([k]) => k !== key));

export type KeptVault = ReturnType<typeof keptVaultAt>;

/** @param worker this box's own worker id: a keep signed for another worker is refused. */
export function keptVaultAt(home: string, worker: string, macs: MacKeys, now: () => number = Date.now) {
  const file = path.join(home, KEPT_FILE);

  // What this box keeps for the Mac it trusts now; nothing when the file is gone, garbled or another Mac's.
  function read(): Store | null {
    const trusted = macs.pinned()[0];
    if (!trusted) return null;
    let text: string;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      return null;
    }
    const store = storeOf(text);
    return store && store.mac === trusted ? store : null;
  }

  function write(store: Store) {
    fs.mkdirSync(home, { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(store)}\n`, { mode: 0o600 });
    fs.renameSync(tmp, file);
  }

  // Throws unless the command is the trusted Mac's, for this worker, newer than what's held, and (a put) fresh.
  function check(payload: unknown): { keep: Keep; mac: string } {
    const got = readKeep(payload);
    if (!got) throw new Error("That keep isn't one Weft makes.");
    const { keep, mac } = got;
    const trusted = macs.pinned();
    if (!trusted.length) throw new Error("This worker trusts no Mac: it was enrolled by token, so it keeps no secrets. Pair it from Settings → Devices.");
    if (!trusted.includes(mac.key)) throw new Error("That keep is signed by a Mac this worker wasn't paired with.");
    if (!macSigned(mac.key, keepMessage(keep), mac.sig)) throw new Error("That keep's Mac signature doesn't check out.");
    if (keep.worker !== worker) throw new Error("That keep is for another worker.");
    if (keep.op === "put" && Math.abs(now() - keep.issuedAt) > KEEP_MAX_AGE_MS) throw new Error("That keep is too old to add values. Send it again from your Mac.");
    return { keep, mac: mac.key };
  }

  return {
    /** The daemon's vault_keep: stores, deletes or wipes, and says what it holds now. */
    apply(payload: unknown): { seq: number; kept: number } {
      const { keep, mac } = check(payload);
      const store = read() ?? empty(mac);
      if (keep.seq <= store.seq) throw new Error("That keep is older than one this worker already took. Send it again from your Mac.");
      const kept = applyOp(store, keep);
      store.seq = keep.seq;
      write(store);
      return { seq: keep.seq, kept };
    },

    /** The versions this box holds of the names asked for, for the ask's claim (only ever narrows what the Mac sends). */
    index(repo: string, environment: string, names?: string[]): Record<string, number> {
      const slots = read()?.vaults[repo]?.[environment] ?? {};
      return Object.fromEntries(Object.entries(slots).filter(([name]) => !names || names.includes(name)).map(([name, s]) => [name, s.version]));
    },

    /** The values a Mac-signed secret_use said to take from here, each at exactly that version; throws otherwise. */
    open(repo: string, environment: string, want: Record<string, number>, unseal: (sealed: Sealed, purpose: string) => string): Record<string, string> {
      const slots = read()?.vaults[repo]?.[environment] ?? {};
      const out: Record<string, string> = {};
      for (const [name, version] of Object.entries(want)) {
        const slot = slots[name];
        if (!slot || slot.version !== version) throw new Error(`This worker's kept copy of ${name} isn't the one your Mac approved. Ask again: your Mac will send it.`);
        try {
          out[name] = unseal(slot.sealed, keptPurpose(worker, repo, environment, name, version));
        } catch {
          throw new Error(`This worker's kept copy of ${name} won't open. Ask again: your Mac will send it.`);
        }
      }
      return out;
    },

    /** How many values it keeps, for `weft-worker status`. */
    count(): number {
      const store = read();
      return store ? Object.values(store.vaults).reduce((n, envs) => n + Object.values(envs).reduce((m, slots) => m + Object.keys(slots).length, 0), 0) : 0;
    },

    wipe: () => wipeKept(home),
  };
}

// The worker's registry with a heartbeat that wipes the kept values once the worker's own key stops working: a revoke
// replaces its key_hash (device_registry.sql), so "unknown worker key" means this box was revoked (or its key replaced),
// and values kept for it go, even if the Mac's signed wipe never reached it.
export function wipeWhenRevoked<R extends { heartbeat: (...args: never[]) => Promise<unknown> }>(reg: R, wipe: () => void, log: (msg: string) => void): R {
  let told = false;
  const heartbeat = (...args: Parameters<R["heartbeat"]>) =>
    reg.heartbeat(...args).catch((err: unknown) => {
      if (err instanceof Error && /unknown worker key/i.test(err.message)) {
        wipe();
        if (!told) log("Weft Worker: this worker's key no longer works (revoked?), so it deleted the secrets your Mac kept here.");
        told = true;
      }
      throw err;
    });
  return { ...reg, heartbeat };
}
