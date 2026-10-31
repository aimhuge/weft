// The webhook relay (docs/architecture/webhooks.md), served by the deployed Weft on Vercel at /api/hooks/<relay id>
// (app/api/hooks/[id]/[[...rest]]/route.ts), since a provider can't reach a dev server on localhost. Whatever the
// provider posts becomes a webhook_deliveries row on Weft's Supabase, which the owner's Weft hears through Realtime
// and forwards to the webhook's local target (lib/webhook-forward.ts).
//
// Pentest 2026-10-20, F-12: the relay used to accept any request holding the id; a stranger could inject a body
// to any local target. The relay now refuses unless the row declares a known provider (lib/webhook-signatures.ts
// PRO registry), the local Weft encrypted the signing secret on the way in (lib/relay-secret.ts), and the
// deployment has WEFT_RELAY_SECRET_KEY to decrypt it. The signature is verified in constant time over the raw
// body bytes, the same ones forwarded to the local target, so a target with the secret locally agrees with the
// relay on what counts as authentic.

import { PROVIDERS, type Headers as ProviderHeaders } from "./webhook-signatures";
import { openSecret, relayKeyFromEnv, sealedFromHex, type RelayKey } from "./relay-secret";
import { isOpen, restTunnel, type TunnelRow } from "./tunnel-address";
import { FORWARD_HEADER, forwardTicket } from "./tunnel-ticket";

export interface Relay {
  id: string;
  user_id: string;
  name: string;
  provider?: string | null;
  secret_ciphertext?: string | null;
  secret_nonce?: string | null;
  secret_key_id?: string | null;
  tunnel_id?: string | null;
  tunnel_path?: string | null;
}

export interface DeliveryRow {
  relay_id: string;
  user_id: string;
  method: string;
  // Whatever followed the relay id in the URL: "/sub", "?foo=1", "/sub?foo=1", or "".
  path: string;
  headers: Record<string, string>;
  // The request body in base64.
  body: string;
}

export interface RelayStore {
  relay: (id: string) => Promise<Relay | null>;
  save: (delivery: DeliveryRow) => Promise<void>;
  tunnel?: (id: string) => Promise<TunnelRow | null>;
}

export const MAX_BODY = 1024 * 1024;
export const TUNNEL_TIMEOUT_MS = 8_000;
// The gate refused it, or Cloudflare couldn't reach the Mac: these came from the way there, not from the route.
const NOT_THE_ROUTE = new Set([401, 502, 503, 504, 530]);
export const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (body: string, status: number) => new Response(body, { status, headers: { "content-type": "text/plain" } });

// Hop-by-hop headers, and the ones Vercel adds on the way in: none of them is the provider's.
const DROPPED = /^(host|connection|keep-alive|content-length|transfer-encoding|te|trailer|upgrade|forwarded|x-real-ip|x-forwarded-.*|x-vercel-.*|x-weft-token)$/;

export function keptHeaders(headers: Headers): Record<string, string> {
  const kept: Record<string, string> = {};
  headers.forEach((value, name) => {
    const key = name.toLowerCase();
    if (!DROPPED.test(key)) kept[key] = value;
  });
  return kept;
}

const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

// What the verifier sees. The headers are already lowercased and stripped of hop-by-hop
// (keptHeaders), so a provider like Stripe sees only what it sent.
function providerHeaders(headers: Record<string, string>): ProviderHeaders {
  const out: ProviderHeaders = {};
  for (const [k, v] of Object.entries(headers)) out[k.toLowerCase()] = v;
  return out;
}

// F-12: the relay used to save every request. It refuses unless the row declares a provider we know how to verify, the
// deployment can open its ciphertext and the signature checks out. Without a provider row the local Weft must create a
// fresh relay through createRelay() before deliveries flow again. null means the delivery is authentic.
function refusal(relay: Relay, body: Uint8Array, headers: ProviderHeaders, key: RelayKey | null, now: number): Response | null {
  const provider = relay.provider?.trim();
  if (!provider) return text("Relay has no provider; create a fresh relay through Weft.", 403);
  const verifier = PROVIDERS.get(provider);
  if (!verifier) return text("Unknown provider", 403);
  if (!key) return text("Relay signing key is not configured on this deployment", 503);
  // sealedFromHex reads the snake_case Supabase columns off the row; Relay carries the same fields, typed.
  const sealed = sealedFromHex(relay as unknown as Record<string, unknown>);
  const secret = openSecret(sealed, key);
  if (!secret) return text("Relay signing key mismatch", 403);
  const bodyText = new TextDecoder("utf-8", { fatal: false }).decode(body);
  return verifier.verify(secret, bodyText, headers, now) ? null : text("Bad signature", 401);
}

// The handler used by the route. The relay key is taken from the environment by default; pass a
// key directly so the tests can drive it without setting process.env.
export async function handle(
  req: Request,
  relayId: string,
  extra: string,
  store: RelayStore,
  opts: { key?: RelayKey | null; now?: () => number } = {},
): Promise<Response> {
  if (!METHODS.has(req.method)) return text("Method not allowed", 405);
  if (!UUID.test(relayId)) return text("Unknown webhook", 404);
  const relay = await store.relay(relayId);
  if (!relay) return text("Unknown webhook", 404);

  // Refuse by the declared size first so an oversized body is never read, then by what actually arrived.
  if (Number(req.headers.get("content-length")) > MAX_BODY) return text("Body too large", 413);
  const body = new Uint8Array(await req.arrayBuffer());
  if (body.length > MAX_BODY) return text("Body too large", 413);

  const headers = providerHeaders(keptHeaders(req.headers));
  const refused = refusal(relay, body, headers, opts.key ?? relayKeyFromEnv(), (opts.now ?? Date.now)());
  if (refused) return refused;

  const live = await sendThroughTunnel(relay, req.method, extra, headers, body, store, opts.now ?? Date.now);
  if (live) return live;
  await store.save({ relay_id: relay.id, user_id: relay.user_id, method: req.method, path: extra, headers, body: base64(body) });
  return text("Relayed", 200);
}

// While a tunnel is open, a verified delivery goes straight to the route, and the provider gets its real answer. No
// tunnel, or one that didn't reach the route, gives null, and the delivery is stored for Weft as before. A route too
// slow for TUNNEL_TIMEOUT_MS may then see it twice, which is why providers ask routes to be idempotent.
async function sendThroughTunnel(relay: Relay, method: string, extra: string, headers: Record<string, string>, body: Uint8Array, store: RelayStore, now: () => number) {
  if (!relay.tunnel_id || !store.tunnel) return null;
  try {
    const tunnel = await store.tunnel(relay.tunnel_id);
    if (!tunnel || tunnel.user_id !== relay.user_id || !isOpen(tunnel, now())) return null;
    const path = `${relay.tunnel_path ?? "/"}${extra}`;
    const res = await fetch(`${tunnel.public_url}${path}`, {
      method,
      headers: { ...headers, [FORWARD_HEADER]: forwardTicket(tunnel.ticket_secret, tunnel.id, method, path, now()) },
      body: method === "GET" ? undefined : new Uint8Array(body),
      redirect: "manual",
      signal: AbortSignal.timeout(TUNNEL_TIMEOUT_MS),
    });
    if (NOT_THE_ROUTE.has(res.status)) return null;
    return new Response(res.body, { status: res.status, headers: { "content-type": res.headers.get("content-type") ?? "text/plain" } });
  } catch {
    return null;
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Relays and deliveries through Supabase's REST API with a secret key, which skips row-level security: only this
// relay holds one. A new-style sb_secret_ key goes in apikey alone; a legacy service_role JWT also as the bearer.
// The select line picks up the new signature columns (pentest F-12, supabase/migrations/…webhook_relay_provider.sql);
// the secret columns are kept out of the owner's grant, so the service role needs the SUPABASE_SECRET_KEY.
export function restStore(url: string, key: string, now = () => Date.now()): RelayStore {
  const headers: Record<string, string> = { apikey: key, "content-type": "application/json" };
  if (!key.startsWith("sb_")) headers.authorization = `Bearer ${key}`;
  async function rest(path: string, init: RequestInit = {}) {
    const res = await fetch(`${url}/rest/v1/${path}`, { ...init, headers: { ...headers, ...(init.headers as Record<string, string> | undefined) } });
    if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
    return res;
  }
  return {
    relay: async (id) => {
      const rows = (await (
        await rest(
          `webhook_relays?id=eq.${id}&select=id,user_id,name,provider,secret_ciphertext,secret_nonce,secret_key_id,tunnel_id,tunnel_path`,
        )
      ).json()) as Relay[];
      return rows[0] ?? null;
    },
    tunnel: restTunnel(url, key),
    save: async (delivery) => {
      await rest("webhook_deliveries", { method: "POST", body: JSON.stringify(delivery), headers: { prefer: "return=minimal" } });
      // A relay's deliveries older than a day are no use to anyone: Weft forwards them within seconds, or on its next start.
      const old = new Date(now() - DAY_MS).toISOString();
      await rest(`webhook_deliveries?relay_id=eq.${delivery.relay_id}&created_at=lt.${old}`, { method: "DELETE" });
    },
  };
}
