// Who's asking weft.zip for a connector token (lib/connector-mint.ts): a Weft Worker, by its `wwk_` key (sha256 checked
// against cloud_workers.key_hash, as app/api/worker-blob does) and a signature over the whole request by the Ed25519
// sign key it was paired with (H10; cloud_workers.sign_key is set only by worker_pair_confirm, under your Touch ID, and
// no worker function changes it). The key alone mints nothing, and a request can't be changed, replayed (its nonce is
// logged once, lib/connector-db.ts) or kept for later (its time must be within FRESH_MS).
import "server-only";
import { createHash, createPublicKey, verify } from "node:crypto";
import { CONNECTORS, mintMessage, REPO_RE, type Connector, type MintRequest } from "./connector-grant";
import type { ConnectorDb, WorkerRow } from "./connector-db";
import { MintError } from "./connector-tokens";

export const FRESH_MS = 2 * 60_000;
const KEY_RE = /^Bearer (wwk_[0-9a-f]{64})$/;
const NONCE_RE = /^[0-9a-f]{32,64}$/;
const CARD_RE = /^[A-Za-z0-9_-]{1,200}$/;

export interface SignedMint extends Omit<MintRequest, "workerId"> {
  sig: string;
}

// The request body, or a 400 naming what's wrong.
function parseConnector(b: Record<string, unknown>): Connector {
  if (!CONNECTORS.includes(b.connector as Connector)) throw new MintError(400, "Name a connector: github.");
  return b.connector as Connector;
}

export function parseMint(raw: unknown): SignedMint {
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const connector = parseConnector(b);
  if (typeof b.cardId !== "string" || !CARD_RE.test(b.cardId)) throw new MintError(400, "Name the card.");
  if (typeof b.repo !== "string" || !REPO_RE.test(b.repo)) throw new MintError(400, "Name the repo as owner/name.");
  if (typeof b.ts !== "number" || !Number.isFinite(b.ts)) throw new MintError(400, "Say when the request was made.");
  if (typeof b.nonce !== "string" || !NONCE_RE.test(b.nonce)) throw new MintError(400, "Send a nonce.");
  if (typeof b.sig !== "string" || !b.sig || b.sig.length > 200) throw new MintError(400, "Sign the request.");
  return { connector, cardId: b.cardId, repo: b.repo, ts: b.ts, nonce: b.nonce, sig: b.sig };
}

export function checkSignature(signKey: string, request: MintRequest, sig: string): boolean {
  try {
    const key = createPublicKey({ key: Buffer.from(signKey, "base64"), format: "der", type: "spki" });
    return verify(null, Buffer.from(mintMessage(request)), key, Buffer.from(sig, "base64"));
  } catch {
    return false;
  }
}

// The worker the key and signature say, or a refusal: no key, an unknown or revoked one, a token-enrolled worker (no
// sign key), a bad signature, or a stale request.
export async function signedWorker(db: ConnectorDb, authorization: string | null, body: SignedMint, now: number): Promise<WorkerRow> {
  const key = KEY_RE.exec(authorization ?? "")?.[1];
  if (!key) throw new MintError(401, "Send this worker's key.");
  const worker = await db.workerByKeyHash(createHash("sha256").update(key).digest("hex"));
  if (!worker || worker.revoked_at) throw new MintError(401, "That key isn't a live worker's.");
  if (!worker.sign_key) throw new MintError(403, "This worker was enrolled by token, so it can't use connectors. Pair it from Settings → Devices → Add a worker.");
  if (!checkSignature(worker.sign_key, { ...body, workerId: worker.id }, body.sig)) throw new MintError(401, "That request isn't signed by the worker's paired key.");
  if (Math.abs(now - body.ts) > FRESH_MS) throw new MintError(401, "That request is too old (or the worker's clock is off).");
  return worker;
}
