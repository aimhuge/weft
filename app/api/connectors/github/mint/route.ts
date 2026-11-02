// POST /api/connectors/github/mint, on weft.zip: a Weft Worker asks for a GitHub token for one of its cards, with its
// `wwk_` key as a bearer and a body signed by its paired sign key (lib/connector-client.ts sends it). The decision is
// lib/connector-mint.ts's, from the database alone. Not behind lib/guard.ts: the key and signature are the gate, and a
// server without the service key, the app's OAuth client and the token key answers 503
// (docs/architecture/connectors.md#connectors-on-a-worker-github-p1-as-built).
import { NO_STORE } from "@/lib/app-share-reply";
import { connectorDeps, NOT_SET_UP } from "@/lib/connector-deps";
import { mint } from "@/lib/connector-mint";

export async function POST(req: Request) {
  const deps = connectorDeps();
  if (!deps) return Response.json(NOT_SET_UP, { status: 503, headers: NO_STORE });
  const body: unknown = await req.json().catch(() => null);
  const answer = await mint(deps, req.headers.get("authorization"), body);
  return Response.json(answer.body, { status: answer.status, headers: NO_STORE });
}
