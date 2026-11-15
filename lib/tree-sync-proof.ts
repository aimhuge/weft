// What opens a synced folder's `tree` channel (docs/architecture/folder-sync.md#trust): writing into a worker's checkout
// from the network is as strong as a shell, so the line alone (a Supabase session is all a row proves) never opens one.
// The first message on the channel names the folder and carries this Mac's signature over it, made by main with the
// device key the worker pinned from its pairing code (electron/tree-sync-sign.cjs), the way a LAN offer is signed
// (lib/worker-lan.ts). Main signs only for folders you turned sync on for with Touch ID, so the signature means "the
// user's own Mac, which they told to sync this folder, asks now". Fresh within OPEN_MAX_SKEW_MS, its nonce spent once.
import { macSigned } from "./worker-mac-keys";
import type { NonceBook } from "./widen-nonces";

export const OPEN_PREFIX = "weft-tree-sync-v1";
export const OPEN_MAX_SKEW_MS = 60_000;

export interface SyncOpen {
  t: "open";
  folder: string;
  mac: { key: string; sig: string; issuedAt: number; nonce: string };
}

export const openMessage = (workerId: string, folder: string, issuedAt: number, nonce: string) =>
  [OPEN_PREFIX, workerId.toLowerCase(), folder, String(issuedAt), nonce].join("\n");

const FOLDER = /^[A-Za-z0-9._-]{1,200}$/;
const NONCE = /^[0-9a-f]{32}$/;

export function readSyncOpen(raw: string): SyncOpen | null {
  let p: unknown;
  try {
    p = JSON.parse(raw);
  } catch {
    return null;
  }
  const o = p as Partial<SyncOpen> | null;
  const mac = o?.mac;
  if (!o || o.t !== "open" || typeof o.folder !== "string" || !FOLDER.test(o.folder) || o.folder.startsWith(".")) return null;
  if (!mac || typeof mac.key !== "string" || typeof mac.sig !== "string" || typeof mac.nonce !== "string" || !NONCE.test(mac.nonce)) return null;
  if (typeof mac.issuedAt !== "number" || !Number.isFinite(mac.issuedAt)) return null;
  return { t: "open", folder: o.folder, mac: { key: mac.key, sig: mac.sig, issuedAt: mac.issuedAt, nonce: mac.nonce } };
}

export interface ProofDeps {
  workerId: string;
  // The Mac keys this box trusts now (lib/worker-mac-keys.ts pinned()).
  macKeys: () => string[];
  nonces: NonceBook;
  now?: () => number;
  verify?: typeof macSigned;
}

// Null when the open is good (and its nonce is now spent), else why not.
export async function openRefusal(open: SyncOpen, deps: ProofDeps): Promise<string | null> {
  const now = (deps.now ?? Date.now)();
  const { mac } = open;
  if (!deps.macKeys().includes(mac.key)) return "Only the Mac this worker was paired with can sync a folder with it.";
  if (Math.abs(now - mac.issuedAt) > OPEN_MAX_SKEW_MS) return "That sync request is too old, or a clock is off.";
  if (!(deps.verify ?? macSigned)(mac.key, openMessage(deps.workerId, open.folder, mac.issuedAt, mac.nonce), mac.sig)) return "That sync request isn't signed by your Mac.";
  if (!(await deps.nonces.take(mac.nonce, mac.issuedAt + 2 * OPEN_MAX_SKEW_MS, mac.issuedAt))) return "That sync request was used already.";
  return null;
}
