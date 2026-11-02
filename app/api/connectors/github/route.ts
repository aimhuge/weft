// /api/connectors/github, on weft.zip, for the desktop (your Supabase session as a bearer, lib/connector-remote.ts):
// GET says whether you've connected GitHub and as whom; DELETE disconnects it: every worker's grant, the whole
// authorization at GitHub and the stored refresh token (lib/connector-revoke.ts disconnect).
// (docs/architecture/connectors.md#connectors-on-a-worker-github-p1-as-built)
import { NO_STORE } from "@/lib/app-share-reply";
import { connectStatus } from "@/lib/connector-connect";
import { connectorDeps, NOT_SET_UP } from "@/lib/connector-deps";
import { disconnect } from "@/lib/connector-revoke";
import { bearerUser } from "@/lib/web-session";

const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: NO_STORE });

async function caller(req: Request) {
  const deps = connectorDeps();
  if (!deps) return { error: reply(NOT_SET_UP, 503) };
  const user = await bearerUser(req);
  if (!user) return { error: reply({ error: "Sign in to Weft first." }, 401) };
  return { deps, user };
}

export async function GET(req: Request) {
  const c = await caller(req);
  if (c.error) return c.error;
  try {
    return reply(await connectStatus(c.deps, c.user.id));
  } catch (err) {
    return reply({ error: (err as Error).message }, 502);
  }
}

export async function DELETE(req: Request) {
  const c = await caller(req);
  if (c.error) return c.error;
  try {
    return reply({ ok: true, ...(await disconnect(c.deps, c.user.id)) });
  } catch (err) {
    return reply({ error: (err as Error).message }, 502);
  }
}
