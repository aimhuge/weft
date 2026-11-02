// What weft.zip's connector routes run with (app/api/connectors/github/*): the service-role database, the Weft GitHub
// App's OAuth client and the key tokens are sealed with, all from the deployment's env. Null when any is missing, so a
// desktop server (or a deployment not set up yet) answers 503 instead of half-working.
import "server-only";
import { connectorKey } from "./connector-crypto";
import { supabaseConnectorDb } from "./connector-db";
import type { TokenDeps } from "./connector-tokens";
import { appConfig } from "./github-app";
import { serviceClient } from "./web-session";

export function connectorDeps(env: Record<string, string | undefined> = process.env, fetcher: typeof fetch = fetch): TokenDeps | null {
  const service = serviceClient(env);
  const cfg = appConfig(env);
  const key = connectorKey(env);
  if (!service || !cfg || !key) return null;
  return { db: supabaseConnectorDb(service), cfg, key, fetch: fetcher, now: Date.now };
}

export const NOT_SET_UP = { error: "GitHub connectors aren't set up on this server yet." };
