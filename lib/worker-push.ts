// A push to main reaches Weft Workers in seconds (docs/architecture/weft-worker.md#auto-updates). GitHub posts it to
// /api/github/push on the deployed Weft, signed with one shared secret; a delivery that checks out sends the empty
// ping every worker hears (lib/worker-wake.ts listenForPushes). The ping names no commit: a worker fetches origin
// itself, so nothing here decides what a worker runs.
import { sameSignature, signature } from "./github-relay";

const REPO = "aimhuge/weft";
const REF = "refs/heads/main";

const text = (body: string, status: number) => new Response(body, { status, headers: { "content-type": "text/plain" } });

// The newest commit changed on main of this repo. A deleted branch has nothing to fetch.
function isMainPush(raw: string) {
  try {
    const push = JSON.parse(raw) as { ref?: unknown; deleted?: unknown; repository?: { full_name?: unknown } };
    return push.ref === REF && push.deleted !== true && push.repository?.full_name === REPO;
  } catch {
    return false;
  }
}

export async function handlePush(req: Request, secret: string, ping: () => Promise<void>): Promise<Response> {
  const raw = await req.text();
  if (!sameSignature(req.headers.get("x-hub-signature-256") ?? "", await signature(secret, raw))) return text("Bad signature", 401);
  // GitHub's own test delivery, and any other event a hook was set to send, are answered and dropped.
  if (req.headers.get("x-github-event") !== "push" || !isMainPush(raw)) return text("Ignored", 200);
  await ping();
  return text("Pinged", 200);
}

// Through PostgREST with the secret key, as lib/github-relay.ts's restStore. The function is callable by nobody else.
export function restPing(url: string, key: string): () => Promise<void> {
  return async () => {
    const res = await fetch(`${url}/rest/v1/rpc/worker_update_ping`, { method: "POST", headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" }, body: "{}" });
    if (!res.ok) throw new Error(`worker_update_ping: HTTP ${res.status}`);
  };
}
