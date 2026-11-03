// A Weft Worker's signed-widening setup (docs/architecture/project-hosts.md#signed-widening-as-built), for
// scripts/weft-worker.ts: the WorkerWiden the daemon and the line's terminal check approvals with. The Mac it trusts is
// H8's, pinned from the pairing code (lib/worker-mac-keys.ts trustPairingMac); passkeys come endorsed by that Mac.
import path from "node:path";
import { createHostSigners } from "./host-signers";
import { passkeyOrigins } from "./passkey-verify";
import { sharedNonceBook } from "./widen-nonces";
import { macKeysAt } from "./worker-mac-keys";
import type { TerminalDeps } from "./host-line-terminal";
import { spawnPty } from "./worker-pty";
import { terminalAllow, type WorkerWiden } from "./worker-widen";

export interface WorkerWidenOptions {
  home: string;
  workerId: string;
  root: string;
  listFolders: (root: string) => string[];
  repoPath: (root: string, folder: string) => string;
  nameFolder: (cardId: string, folder: string) => void;
  signHeld?: (message: string) => string;
  // The passkey heads its Mac published (lib/passkey-head.ts, the registry's passkeyHeads): with them, a passkey approves
  // only while this worker holds the Mac's latest set.
  heads?: () => Promise<unknown[]>;
  env?: { NODE_ENV?: string; WEFT_PASSKEY_DEV_ORIGIN?: string };
}

export function workerWidenFor(o: WorkerWidenOptions): WorkerWiden {
  return {
    host: o.workerId,
    signers: createHostSigners(o.home, passkeyOrigins(o.env ?? process.env), macKeysAt(o.home), o.heads ? { heads: o.heads, worker: o.workerId } : undefined),
    nonces: sharedNonceBook(path.join(o.home, "widen-nonces.json")),
    projects: () => o.listFolders(o.root),
    root: o.root,
    projectPath: (folder) => o.repoPath(o.root, folder),
    nameFolder: o.nameFolder,
    ...(o.signHeld ? { signHeld: o.signHeld } : {}),
  };
}

// The daemon's `widen` and the line's `terminal`, from one WorkerWiden: the same pins and nonces for both.
export function workerSigning(o: WorkerWidenOptions, spawn: TerminalDeps["spawn"] = spawnPty) {
  const widen = workerWidenFor(o);
  return { widen, terminal: { allow: terminalAllow(widen), spawn } satisfies TerminalDeps };
}
