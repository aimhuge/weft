// Connector tokens on a Weft Worker (docs/architecture/project-hosts.md#the-vault-and-connectors-on-a-worker-t2-as-built).
// The owner's Mac sends a `connector` command for a connector turned on for this worker in Settings → Devices: a
// short-lived token sealed to this box and signed by the Mac it was paired with, or a forget. The daemon checks the Mac's
// signature (lib/worker-mac-keys.ts: only the key the pairing code carried), refuses anything older than what it has,
// and keeps the token sealed at rest to its own key in connectors.json, inside the worker's home, which threads can't
// read (lib/secret-guard-files.ts). A shim on the cards' PATH (connectors/bin/<cli>) runs the real CLI with the token in
// that one process's env (electron/connector-exec.cjs). A forget, or the token's expiry, and the CLI runs signed out.
import fs from "node:fs";
import path from "node:path";
import { CONNECTORS, connectorMessage, connectorPurpose, connectorStorePurpose, isConnector, type ConnectorId, type ConnectorToken } from "./connector-wire";
import { macSigned, type MacKeys } from "./worker-mac-keys";
import { open, seal, sealedOf, type Sealed, type SealKeys } from "./worker-seal";

// The longest a token may live here, whatever the Mac says: a gh token is re-sent every 6 hours and forgotten after 8.
export const MAX_TTL_MS = 24 * 60 * 60_000;
const NONCE = /^[0-9a-f]{64}$/;
const TOKEN = /^[\x21-\x7e]{8,8192}$/;

interface Entry {
  issuedAt: number;
  sealed?: Sealed;
  account?: string;
  expiresAt?: number;
  bin?: string;
  forgotten?: boolean;
}

export interface ConnectorDeps {
  home: string;
  keys: SealKeys;
  macs: MacKeys;
  // The real CLI on PATH, past the shims; null when it isn't installed here.
  which: (bin: string) => string | null;
  node: string;
  runner: string;
  now?: () => number;
}

export const connectorBin = (home: string) => path.join(home, "connectors", "bin");
const quote = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;

// The real program named bin on a PATH, skipping the shims' own folder.
export function findReal(bin: string, pathVar: string, skip: string): string | null {
  for (const dir of pathVar.split(path.delimiter)) {
    if (!dir || path.resolve(dir) === path.resolve(skip)) continue;
    const file = path.join(dir, bin);
    try {
      fs.accessSync(file, fs.constants.X_OK);
      if (fs.statSync(file).isFile()) return file;
    } catch {
      // Not here.
    }
  }
  return null;
}

type Body = { op: "token" | "forget"; connector: ConnectorId; nonce: string; issuedAt: number; sealed: Sealed | null; mac: { key: string; sig: string } };

const asObject = (v: unknown) => (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
const text = (v: unknown, re = /^[\s\S]+$/) => (typeof v === "string" && re.test(v) ? v : null);

function bodyOf(payload: unknown): Body {
  const p = asObject(payload);
  const m = asObject(p.mac);
  const op = p.op === "token" || p.op === "forget" ? p.op : null;
  const sealed = op === "token" ? sealedOf(p.sealed) : null;
  const [nonce, key, sig] = [text(p.nonce, NONCE), text(m.key), text(m.sig)];
  const issuedAt = Number.isSafeInteger(p.issuedAt) ? (p.issuedAt as number) : null;
  if (!op || !isConnector(p.connector) || !nonce || !key || !sig || issuedAt === null || (op === "token" && !sealed)) throw new Error("That connector command isn't one Weft makes.");
  return { op, connector: p.connector, nonce, issuedAt, sealed, mac: { key, sig } };
}

function tokenOf(text: string, b: Body, now: number): ConnectorToken {
  let t: Partial<ConnectorToken> = {};
  try {
    t = JSON.parse(text) as Partial<ConnectorToken>;
  } catch {
    // Checked below.
  }
  const fits = t.v === 1 && t.connector === b.connector && t.issuedAt === b.issuedAt && typeof t.token === "string" && TOKEN.test(t.token) && typeof t.account === "string" && t.account.length <= 320;
  if (!fits) throw new Error("That connector token isn't one Weft makes.");
  if (typeof t.expiresAt !== "number" || t.expiresAt <= now || t.expiresAt > now + MAX_TTL_MS) throw new Error("That connector token's expiry isn't one Weft gives.");
  return t as ConnectorToken;
}

export function createConnectors({ home, keys, macs, which, node, runner, now = Date.now }: ConnectorDeps) {
  const file = path.join(home, "connectors.json");
  const bin = connectorBin(home);
  const read = () => readStore(home);
  const write = (entries: Record<string, Entry>) => {
    fs.mkdirSync(home, { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, `${JSON.stringify(entries)}\n`, { mode: 0o600 });
  };
  const shim = (connector: ConnectorId) => path.join(bin, CONNECTORS[connector].bin);
  const writeShim = (connector: ConnectorId) => {
    fs.mkdirSync(bin, { recursive: true, mode: 0o700 });
    fs.writeFileSync(shim(connector), `#!/bin/sh\nexec ${quote(node)} ${quote(runner)} ${quote(home)} ${connector} "$@"\n`, { mode: 0o700 });
  };

  // The Mac it was paired with, and its signature over everything in the command; throws otherwise.
  function checkMac(b: Body) {
    const trusted = macs.pinned();
    if (!trusted.length) throw new Error("This worker trusts no Mac: it was enrolled by token. Pair it from Settings → Devices to use connectors on it.");
    if (!trusted.includes(b.mac.key)) throw new Error("That connector command is signed by a Mac this worker wasn't paired with.");
    if (!macSigned(b.mac.key, connectorMessage(b.op, b.connector, b.nonce, b.issuedAt, b.sealed), b.mac.sig)) throw new Error("That connector command's Mac signature doesn't check out.");
  }

  return {
    /** The daemon's `connector` kind. Returns null (it touches no card), or throws why it won't take the command. */
    deliver(payload: unknown): null {
      const b = bodyOf(payload);
      checkMac(b);
      const entries = read();
      const prev = entries[b.connector];
      if (prev && b.issuedAt <= prev.issuedAt) throw new Error("That connector command is older than the one this worker has.");
      if (b.op === "forget") {
        entries[b.connector] = { issuedAt: b.issuedAt, forgotten: true };
        write(entries);
        fs.rmSync(shim(b.connector), { force: true });
        return null;
      }
      let opened: string;
      try {
        opened = open(keys, b.sealed as Sealed, connectorPurpose(b.connector, b.nonce));
      } catch {
        throw new Error("That connector token wasn't sealed to this worker.");
      }
      const t = tokenOf(opened, b, now());
      const real = which(CONNECTORS[b.connector].bin);
      entries[b.connector] = { issuedAt: b.issuedAt, sealed: seal(keys.publicKey, JSON.stringify(t), connectorStorePurpose(b.connector)), account: t.account, expiresAt: t.expiresAt, ...(real ? { bin: real } : {}) };
      write(entries);
      if (real) writeShim(b.connector);
      return null;
    },
    /** `weft-worker status`'s lines: which connectors this box holds a token for, as whom and until when. */
    status: () => connectorStatus(home, now()),
  };
}

function readStore(home: string): Record<string, Entry> {
  try {
    return JSON.parse(fs.readFileSync(path.join(home, "connectors.json"), "utf8")) as Record<string, Entry>;
  } catch {
    return {};
  }
}

/** `weft-worker status`'s lines: which connectors this box holds a token for, as whom and until when. Reads only. */
export function connectorStatus(home: string, now = Date.now()): string[] {
  const entries = readStore(home);
  return Object.entries(CONNECTORS).map(([id, spec]) => {
    const e = entries[id];
    if (!e?.sealed) return `${spec.label}: off`;
    const until = e.expiresAt ?? 0;
    const state = until > now ? `until ${new Date(until).toISOString()}` : "expired: your Mac sends a fresh one while it's on";
    return `${spec.label}: ${e.account || "?"}, ${state}${e.bin ? "" : ` (${spec.bin} isn't installed here)`}`;
  });
}
