// The shape of weft.zip's connector routes the desktop calls with your Supabase session as a bearer
// (app/api/connectors/*; docs/architecture/connectors.md#who-may-say-yes-the-chain-of-trust): 503 when the server isn't
// set up, 401 without a session, the handler's answer otherwise, a MintError as its own status and anything else 502.
// Never cached.
import "server-only";
import { NO_STORE } from "./app-share-reply";
import { connectorDeps, NOT_SET_UP } from "./connector-deps";
import { MintError, type TokenDeps } from "./connector-tokens";
import { bearerUser, type WebUser } from "./web-session";

export const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: NO_STORE });

export async function connectorRoute(req: Request, fn: (deps: TokenDeps, user: WebUser) => Promise<unknown>, o: { deps?: () => TokenDeps | null; user?: (req: Request) => Promise<WebUser | null> } = {}): Promise<Response> {
  const deps = (o.deps ?? connectorDeps)();
  if (!deps) return reply(NOT_SET_UP, 503);
  const user = await (o.user ?? bearerUser)(req);
  if (!user) return reply({ error: "Sign in to Weft first." }, 401);
  try {
    return reply(await fn(deps, user));
  } catch (err) {
    return reply({ error: (err as Error).message }, err instanceof MintError ? err.status : 502);
  }
}

export const jsonBody = (req: Request): Promise<unknown> => req.json().catch(() => null);
