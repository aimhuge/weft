// POST /api/connectors/github/revoke {workerId}, on weft.zip, for the desktop (your Supabase session as a bearer): turns
// GitHub off for one of your workers, or follows its revocation. The grant goes, so minting stops at once, and every
// token that worker could hold is ended at GitHub, with what GitHub confirmed in the answer (lib/connector-revoke.ts).
import { NO_STORE } from "@/lib/app-share-reply";
import { connectorDeps, NOT_SET_UP } from "@/lib/connector-deps";
import { revokeWorker } from "@/lib/connector-revoke";
import { MintError } from "@/lib/connector-tokens";
import { bearerUser } from "@/lib/web-session";

const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: NO_STORE });
const UUID_RE = /^[0-9a-f-]{36}$/i;

export async function POST(req: Request) {
  const deps = connectorDeps();
  if (!deps) return reply(NOT_SET_UP, 503);
  const user = await bearerUser(req);
  if (!user) return reply({ error: "Sign in to Weft first." }, 401);
  const { workerId } = ((await req.json().catch(() => null)) ?? {}) as { workerId?: unknown };
  if (typeof workerId !== "string" || !UUID_RE.test(workerId)) return reply({ error: "Name the worker." }, 400);
  try {
    return reply({ ok: true, ...(await revokeWorker(deps, user.id, workerId)) });
  } catch (err) {
    return reply({ error: (err as Error).message }, err instanceof MintError ? err.status : 502);
  }
}
