// The desktop's side of weft.zip's GitHub connector routes (docs/architecture/connectors.md#connectors-on-a-worker-github-p1-as-built):
// whether you've connected GitHub, turning it off for a worker (which ends its tokens at GitHub) and disconnecting it.
// Each call carries your own Supabase access token as a bearer, as lib/team-remote.ts does; weft.zip is the only place
// with the service key and the app's secrets. Server-only: the token and the fetch live here.
import "server-only";
import { SITE } from "./site";

export type SessionShape = { data: { session: { access_token: string } | null } };

export interface RemoteDeps {
  session: SessionShape;
  fetchFn: typeof fetch;
  env: Record<string, string | undefined>;
}

export const connectorSite = (env: Record<string, string | undefined>) => (env.WEFT_CONNECTOR_URL || SITE).replace(/\/+$/, "");

// The page Settings → Devices opens in the browser pane to connect GitHub.
export const connectUrl = (env: Record<string, string | undefined> = process.env) => `${connectorSite(env)}/api/connectors/github/start`;

async function call<T>(method: "GET" | "POST" | "DELETE", path: string, body: unknown, deps: RemoteDeps): Promise<T> {
  const token = deps.session.data.session?.access_token;
  if (!token) throw new Error("Sign in to Weft first.");
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  let res: Response;
  try {
    res = await deps.fetchFn(`${connectorSite(deps.env)}/api/connectors/github${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  } catch {
    throw new Error("Couldn't reach weft.zip.");
  }
  const json = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || !json) throw new Error(json?.error || `weft.zip answered HTTP ${res.status}.`);
  return json;
}

export interface ConnectStatus {
  connected: boolean;
  login?: string;
  refreshExpiresAt?: string;
}

export const remoteStatus = (deps: RemoteDeps) => call<ConnectStatus>("GET", "", undefined, deps);

export interface RevokeResult {
  grants: number;
  tokensRevoked: number;
  unconfirmed: { expiresAt: string | null }[];
  userToken: string;
}

export const remoteRevoke = (workerId: string, deps: RemoteDeps) => call<RevokeResult>("POST", "/revoke", { workerId }, deps);

export const remoteDisconnect = (deps: RemoteDeps) => call<{ grants: number; authorization: string }>("DELETE", "", undefined, deps);

// What the worker's row says after a revoke: what GitHub confirmed, and when anything it didn't ends by itself.
export function revokeNote(r: RevokeResult): string {
  const parts = [`GitHub off${r.grants ? "" : " (it was off)"}`];
  if (r.tokensRevoked) parts.push(`${r.tokensRevoked} token${r.tokensRevoked === 1 ? "" : "s"} revoked ✓`);
  const last = r.unconfirmed.map((u) => u.expiresAt).filter((e): e is string => Boolean(e)).sort().pop();
  if (r.unconfirmed.length) parts.push(`${r.unconfirmed.length} not confirmed by GitHub${last ? `, ending by ${new Date(last).toLocaleTimeString()}` : ""}`);
  if (r.userToken === "unconfirmed") parts.push("your user token wasn't confirmed revoked; it ends within 8 hours");
  return parts.join(" · ");
}
