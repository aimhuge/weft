// A key grant to a Weft Worker (docs/architecture/mobile-security.md#sealing-on-a-weft-worker): one version of the
// workspace sync key, sealed by the owner's Mac to the box key it pinned for this worker (lib/worker-seal.ts's X25519 +
// HKDF + AES-256-GCM, under a purpose naming the org, worker and version) and signed by that Mac's approval key
// (electron/desktop-signer.cjs) over grantMessage. electron/worker-key-grants.cjs makes them; this is the worker's check.
//
// The worker takes a grant only when every check holds: it is for this worker in this workspace, the box key it names
// is this box's own, the signature is by a Mac this box pinned at pairing (lib/worker-mac-keys.ts, never a key off the
// network), and it opens under its purpose to 32 bytes. So neither weft.zip's server nor a stolen session can plant a
// key of its choosing, which would let it read everything the worker seals after.
import { createHash } from "node:crypto";
import type { SyncKey } from "./sync-seal";
import { macSigned } from "./worker-mac-keys";
import { open, sealedOf, type SealKeys } from "./worker-seal";

export const GRANT_DOMAIN = "weft-worker-key-v1";

export interface GrantRow {
  org_id: string;
  worker_id: string;
  version: number;
  box_key: string;
  sealed: string;
  mac_device: string;
  sig: string;
}

export interface GrantFields {
  orgId: string;
  workerId: string;
  version: number;
  boxKey: string;
  sealed: string;
}

// What a sealed key is for: a box sealed for anything else won't open as one, nor for another version or worker.
export const grantPurpose = (orgId: string, workerId: string, version: number) => `workspace-key:${orgId}:${workerId}:${version}`;

// What the Mac signs. electron/worker-key-grants.cjs grantMessage is the same, held to it by a test.
export function grantMessage(g: GrantFields): string {
  const digest = createHash("sha256").update(g.sealed, "utf8").digest("hex");
  return [GRANT_DOMAIN, g.orgId, g.workerId, String(g.version), g.boxKey, digest].join("\n");
}

export interface GrantContext {
  orgId: string;
  workerId: string;
  keys: SealKeys;
  // The Mac keys this box trusts now (macKeysAt(home).pinned()): a revoked pairing Mac's key isn't among them.
  macs: string[];
}

export type Accepted = { key: SyncKey } | { refused: string };

const str = (v: unknown): v is string => typeof v === "string" && v.length > 0;

export function readGrantRow(raw: unknown): GrantRow | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const fields = [r.org_id, r.worker_id, r.box_key, r.sealed, r.mac_device, r.sig];
  if (!fields.every(str) || typeof r.version !== "number" || !Number.isInteger(r.version) || r.version < 1) return null;
  return r as unknown as GrantRow;
}

function openKey(row: GrantRow, keys: SealKeys): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.sealed);
  } catch {
    return null;
  }
  const sealed = sealedOf(parsed);
  if (!sealed) return null;
  try {
    const key = open(keys, sealed, grantPurpose(row.org_id, row.worker_id, row.version));
    return Buffer.from(key, "base64").length === 32 && /^[A-Za-z0-9+/]+=*$/.test(key) ? key : null;
  } catch {
    return null;
  }
}

// The key a grant row carries, or why this box won't take it.
export function acceptGrant(raw: unknown, ctx: GrantContext): Accepted {
  const row = readGrantRow(raw);
  if (!row) return { refused: "it isn't a key grant" };
  if (row.org_id !== ctx.orgId || row.worker_id !== ctx.workerId) return { refused: "it's for another worker or workspace" };
  if (row.box_key !== ctx.keys.publicKey) return { refused: "it was sealed to another box key (re-pinned or reset?)" };
  if (!ctx.macs.length) return { refused: "this box trusts no Mac (enrolled by token, or its Mac was revoked)" };
  const message = grantMessage({ orgId: row.org_id, workerId: row.worker_id, version: row.version, boxKey: row.box_key, sealed: row.sealed });
  if (!ctx.macs.some((mac) => macSigned(mac, message, row.sig))) return { refused: "no Mac this box trusts signed it" };
  const key = openKey(row, ctx.keys);
  return key ? { key: { version: row.version, key } } : { refused: "it doesn't open on this box" };
}
