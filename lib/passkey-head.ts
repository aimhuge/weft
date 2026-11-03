// The Mac's latest passkey generation for a worker, which the worker can't be kept from seeing
// (docs/architecture/project-hosts.md#signed-widening-as-built, "passkey heads"). Main signs `weft-endorse-head-v1` over
// {worker, generation, issuedAt} with its approval key whenever it signs that worker's passkey set, and once a day
// (electron/widen-endorse.cjs headMessage, held to this by electron/widen-endorse.test.ts), and inserts it in the
// insert-only worker_passkey_heads log (supabase/migrations/*_worker_passkey_heads.sql). Before a passkey approval
// counts, the worker reads every head for itself, keeps those its trusted Mac key signed for it, and refuses while the
// set it holds is older than the newest: a revoke whose `pin` row was deleted or held back still stops the passkey.
import { canonical } from "./widen";
import { macSigned } from "./worker-mac-keys";

export const HEAD_V = "weft-endorse-head-v1";
// worker_passkey_heads returns at most this many plus one; a full read is more than the worker could check.
export const HEADS_MAX = 500;

export interface PasskeyHead {
  worker: string;
  generation: number;
  issuedAt: number;
}

export const headMessage = (h: PasskeyHead) => canonical({ v: HEAD_V, worker: h.worker, generation: h.generation, issuedAt: h.issuedAt });

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function readHead(raw: unknown): (PasskeyHead & { sig: string }) | null {
  if (!raw || typeof raw !== "object") return null;
  const h = raw as Record<string, unknown>;
  if (typeof h.worker !== "string" || typeof h.sig !== "string" || !finite(h.generation) || !finite(h.issuedAt)) return null;
  return { worker: h.worker, generation: h.generation, issuedAt: h.issuedAt, sig: h.sig };
}

// The highest generation among the heads a trusted key signed for this worker; 0 when none did. Anything else in the
// log (junk, another worker's, a revoked Mac's) is skipped: it can't raise the bar, and it can't lower it either.
export function newestHead(rows: unknown[], worker: string, keys: string[]): number {
  let best = 0;
  for (const raw of rows) {
    const h = readHead(raw);
    if (!h || h.worker !== worker || h.generation <= best) continue;
    if (keys.some((key) => macSigned(key, headMessage(h), h.sig))) best = h.generation;
  }
  return best;
}

export interface HeadCheck {
  // Every head the log holds for this worker (worker_passkey_heads).
  heads: () => Promise<unknown[]>;
  worker: string;
}

export const HEADS_UNREAD = "This worker couldn't check that its passkeys are your Mac's latest, so it won't take a passkey approval now. Try again in a moment, or approve on your Mac.";
export const HEADS_FLOODED = "This worker's passkey log holds more than it can check, so it won't take a passkey approval. Approve on your Mac.";
export const behind = (held: number, latest: number) =>
  `This worker's passkeys are older than your Mac's (it holds set ${held}, your Mac signed ${latest}), so it won't take a passkey approval until your Mac's latest set lands. Open Weft on your Mac, then try again.`;

// The newest generation the trusted Mac has signed for this worker, or why it couldn't be read: for lib/host-signers.ts,
// which keeps the highest seen and refuses a passkey while the set it holds is older.
export async function latestHead(check: HeadCheck, keys: string[]): Promise<{ latest: number } | { refused: string }> {
  let rows: unknown[];
  try {
    rows = await check.heads();
  } catch {
    return { refused: HEADS_UNREAD };
  }
  if (!Array.isArray(rows)) return { refused: HEADS_UNREAD };
  if (rows.length > HEADS_MAX) return { refused: HEADS_FLOODED };
  return { latest: newestHead(rows, check.worker, keys) };
}
