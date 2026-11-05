// A worker's build on its way to its owner's Mac (docs/architecture/manual-qa.md). POST: a worker's key and the build's sha
// answer a presigned PUT to R2. GET: the Mac's signed-in session and a call id answer a presigned GET, only for the
// account that owns that call and only for the build it names. Private to the owner, unlike weft-blobs: the key is
// qa-builds/<org>/<worker>/<sha>, R2 expires that prefix after a day, and no row or member can list it. Served on weft.zip,
// not behind lib/guard.ts: the bearer is the gate.
import { createHash } from "node:crypto";
import { NO_STORE } from "@/lib/app-share-reply";
import { buildRef } from "@/lib/device-call";
import { MAX_BUILD_BYTES } from "@/lib/device-limits";
import { presignGet, presignPut, r2Config } from "@/lib/r2";
import { serviceClient } from "@/lib/web-session";

const SHA_RE = /^[0-9a-f]{64}$/;
const KEY_RE = /^Bearer (wwk_[0-9a-f]{64})$/;
const TOKEN_RE = /^Bearer (\S+)$/;
const ID_RE = /^[0-9a-f-]{36}$/;

const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: NO_STORE });
const objectKey = (org: string, worker: string, sha: string) => `qa-builds/${org}/${worker}/${sha}`;

export async function POST(req: Request) {
  const key = KEY_RE.exec(req.headers.get("authorization") ?? "")?.[1];
  if (!key) return reply({ error: "Send this worker's key." }, 401);
  const { sha, bytes } = (await req.json().catch(() => ({}))) as { sha?: unknown; bytes?: unknown };
  if (typeof sha !== "string" || !SHA_RE.test(sha)) return reply({ error: "Name the build by its sha256." }, 400);
  if (typeof bytes !== "number" || bytes <= 0 || bytes > MAX_BUILD_BYTES) return reply({ error: "That build is over the 500 MB limit." }, 413);
  const service = serviceClient();
  const r2 = r2Config();
  if (!service || !r2) return reply({ error: "This server can't take builds." }, 503);
  const hash = createHash("sha256").update(key).digest("hex");
  const { data: worker } = await service.from("cloud_workers").select("id, org_id").eq("key_hash", hash).eq("kind", "headless").maybeSingle<{ id: string; org_id: string }>();
  if (!worker) return reply({ error: "That key isn't a worker's." }, 401);
  return reply({ url: presignPut(r2, objectKey(worker.org_id, worker.id, sha)) });
}

export async function GET(req: Request) {
  const token = TOKEN_RE.exec(req.headers.get("authorization") ?? "")?.[1];
  if (!token) return reply({ error: "Sign in to Weft." }, 401);
  const call = new URL(req.url).searchParams.get("call") ?? "";
  if (!ID_RE.test(call)) return reply({ error: "Name the call." }, 400);
  const service = serviceClient();
  const r2 = r2Config();
  if (!service || !r2) return reply({ error: "This server can't serve builds." }, 503);
  const { data: who, error } = await service.auth.getUser(token);
  if (error) return reply({ error: "Sign in to Weft." }, 401);
  const { data: row } = await service.from("device_calls").select("org_id, worker_id, owner_user, tool, args").eq("id", call).maybeSingle<{ org_id: string; worker_id: string; owner_user: string; tool: string; args: { build?: unknown } }>();
  const build = row?.tool === "install" ? buildRef(row.args.build) : null;
  if (!row || row.owner_user !== who.user.id || !build) return reply({ error: "That build isn't yours to read." }, 404);
  return reply({ url: presignGet(r2, objectKey(row.org_id, row.worker_id, build.sha)) });
}
