// POST /api/worker-blob — how a Weft Worker gets a page or image into weft-blobs (lib/worker-blobs.ts). It has a
// wwk_ key and no Supabase session, so it can't write to the bucket as a member. It sends its key as a bearer and the
// sha it's about to upload; this checks sha256(key) against cloud_workers.key_hash and answers a signed upload URL
// for <the worker's own org>/<sha>, which the worker PUTs to directly: a Vercel function can't take a 50 MB body.
// The bucket is written with no overwrite, so a blob that's there stays as it is. Served on weft.zip, not behind
// lib/guard.ts: the key is the gate, and with no service key on a desktop server this answers 503.
//
// `result: true` signs an upload under <org>/results/<sha> instead, for a host verb's answer too big for its command's
// row (lib/host-result.ts); `sweep: true` removes the workspace's results over a day old (the worker asks hourly).
//
// `read: true` goes the other way, for a file you pasted on your Mac into a worker card's reply (lib/attachment-transfer.ts):
// a signed download URL, but only for a sha that a command still open for this worker lists in its attachments. The
// key alone reads nothing else in the workspace's blobs.
import { createHash } from "node:crypto";
import { NO_STORE } from "@/lib/app-share-reply";
import { BLOB_BUCKET } from "@/lib/cloud-sync-types";
import { serviceClient } from "@/lib/web-session";
import { workerDevice } from "@/lib/worker-commands";

// Long enough to fetch 25 MB on a slow line, short enough that a URL in a log is soon dead.
const READ_SECONDS = 120;
const SHA_RE = /^[0-9a-f]{64}$/;
const KEY_RE = /^Bearer (wwk_[0-9a-f]{64})$/;

const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: NO_STORE });

export async function POST(req: Request) {
  const key = KEY_RE.exec(req.headers.get("authorization") ?? "")?.[1];
  if (!key) return reply({ error: "Send this worker's key." }, 401);
  const { sha, read, result, sweep } = (await req.json().catch(() => ({}))) as { sha?: unknown; read?: unknown; result?: unknown; sweep?: unknown };
  if (sweep !== true && (typeof sha !== "string" || !SHA_RE.test(sha))) return reply({ error: "Name the blob by its sha256." }, 400);
  const service = serviceClient();
  if (!service) return reply({ error: "This server can't take uploads." }, 503);
  const hash = createHash("sha256").update(key).digest("hex");
  const { data: worker } = await service.from("cloud_workers").select("id, org_id").eq("key_hash", hash).eq("kind", "headless").maybeSingle<{ id: string; org_id: string }>();
  if (!worker) return reply({ error: "That key isn't a worker's." }, 401);
  if (sweep === true) return sweepResults(service, worker.org_id);
  // A host verb's result (lib/host-result.ts) goes under results/, which the R2 mirror skips and the sweep empties.
  const objectPath = result === true ? `${worker.org_id}/${RESULTS}/${String(sha)}` : `${worker.org_id}/${String(sha)}`;
  if (read === true) return signRead(service, worker, objectPath, String(sha));
  const { data, error } = await service.storage.from(BLOB_BUCKET).createSignedUploadUrl(objectPath);
  if (error && /exists|duplicate/i.test(error.message)) return reply({ exists: true });
  if (error) return reply({ error: error.message }, 502);
  return reply({ path: data.path, token: data.token });
}

type Service = NonNullable<ReturnType<typeof serviceClient>>;

// The folder a worker's verb results go in, and how long one lives: long enough for the board that asked to read it.
const RESULTS = "results";
const RESULT_TTL_MS = 24 * 60 * 60_000;

// `sweep: true`: removes this workspace's results over a day old, oldest first, up to 1,000 a call. Any worker of the
// workspace may ask; it removes only what the TTL says is dead.
async function sweepResults(service: Service, orgId: string, now = Date.now()) {
  const folder = `${orgId}/${RESULTS}`;
  const { data, error } = await service.storage.from(BLOB_BUCKET).list(folder, { limit: 1000, sortBy: { column: "created_at", order: "asc" } });
  if (error) return reply({ error: error.message }, 502);
  const dead = data.filter((o) => o.created_at && now - Date.parse(o.created_at) > RESULT_TTL_MS).map((o) => `${folder}/${o.name}`);
  if (dead.length) {
    const { error: removeError } = await service.storage.from(BLOB_BUCKET).remove(dead);
    if (removeError) return reply({ error: removeError.message }, 502);
  }
  return reply({ removed: dead.length });
}

// A download only for a blob an open command to this worker carries, so a key can't read the workspace's other blobs.
async function signRead(service: Service, worker: { id: string; org_id: string }, objectPath: string, sha: string) {
  const { data: named } = await service
    .from("cloud_commands")
    .select("id")
    .eq("org_id", worker.org_id)
    .eq("target_device", workerDevice(worker.id))
    .in("status", ["pending", "claimed"])
    .contains("payload", { attachments: [{ sha }] })
    .limit(1);
  if (!named?.length) return reply({ error: "No request to this worker carries that file." }, 403);
  const { data, error } = await service.storage.from(BLOB_BUCKET).createSignedUrl(objectPath, READ_SECONDS);
  if (error) return reply({ error: error.message }, 404);
  return reply({ url: data.signedUrl });
}
