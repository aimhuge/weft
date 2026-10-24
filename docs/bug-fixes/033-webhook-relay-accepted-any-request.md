# 033: the webhook relay accepted any request that reached it, and forwarded it to the owner's localhost

**Date:** 2026-10-20 · **Severity:** Medium (anyone holding a relay id could write any method, headers and body into a route on the owner's own machine)

## Symptom

A webhook's public relay URL lives at `/api/hooks/<relay id>` on the deployed Weft. A provider posts there; the
relay saves a `webhook_deliveries` row on Supabase; the owner's Mac hears about it over Realtime and forwards the
request verbatim to the webhook's target, which is always on localhost (`cleanTarget` in `lib/webhooks.ts` refuses
any other host).

The relay's only check was the relay id. Anyone who got hold of it — a log, a screenshot, a referrer, a shared
issue — could `POST` to that URL with any method, any headers and any body, and the owner's Weft would carry it to
the local route as if a provider had sent it. The blast radius was request injection into the owner's own machine,
not outbound exfiltration: the target was already pinned to localhost. Found in the 2026-10-20 pentest as F-12.

## Cause

`handle()` in `lib/webhook-relay.ts` checked the id, the method, the body size — and then saved everything:

```ts
// before
export async function handle(req: Request, relayId: string, extra: string, store: RelayStore): Promise<Response> {
  if (!METHODS.has(req.method)) return text("Method not allowed", 405);
  if (!UUID.test(relayId)) return text("Unknown webhook", 404);
  const relay = await store.relay(relayId);
  ...
  await store.save({ relay_id: relay.id, user_id: relay.user_id, method: req.method, path: extra, headers: keptHeaders(req.headers), body: base64(body) });
}
```

The id was treated as the secret, and the provider's own signature was never checked at the relay. It was checked
further along, in the app at the target, over the body, which the relay had kept byte-exact for exactly that
reason — but by then the request was already a delivery on the owner's Mac.

The awkward constraint: the relay runs on Vercel and cannot read the user's 🔐 vault, where the signing secret
lives, sealed with `safeStorage`. The proof material could not simply be handed to the forwarder.

## Fix

The side that owns the proof material seals it; the forwarder carries only ciphertext.

**Sealing on the way in.** `electron/relay-secret.cjs` and `lib/relay-secret.ts` seal the signing secret with
AES-256-GCM: a fresh 12-byte nonce, the GCM tag on the end of the ciphertext, and a key id beside it so the key
can rotate.

```ts
// after — lib/relay-secret.ts
export function relayKeyFromEnv(env: Record<string, string | undefined> = process.env): RelayKey | null {
  const hex = env.WEFT_RELAY_SECRET_KEY ?? "";
  if (!/^[0-9a-f]{64}$/i.test(hex)) return null;
  return { id: env.WEFT_RELAY_SECRET_KEY_ID?.trim() || "v1", key: Buffer.from(hex, "hex") };
}

export function sealSecret(plain: string, key: RelayKey): SealedSecret {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGO, key.key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return { ciphertext, nonce, keyId: key.id };
}
```

`openSecret` returns `null` — never throws — on a missing key, an unknown key id, or a ciphertext that doesn't
authenticate: a `null` is the "refuse" signal, so a tampered row or a rotated-away key fails closed.

**Sealing behind a Touch ID.** `lib/webhook-forward.ts` `createRelay` asks for the provider and the vault name of
its signing secret, then calls the shell route `POST /webhooks/relay-seal` (`electron/pane-routes.cjs`), which
hands the value to `vault.sendValue(folder, name, environment, reason, send)` inside Electron main. The value goes
to `send()` there, behind one Touch ID approval; what comes back is only the hex trio.

```ts
// after — electron/pane-routes.cjs
"POST /webhooks/relay-seal": ({ folder, name, environment, provider }) => {
  const env = String(environment || "development");
  if (!["stripe", "github", "vercel", "svix"].includes(String(provider || ""))) throw new Error("Unknown provider.");
  const key = relayKeyFromEnv();
  if (!key) throw new Error("Relay signing key is not configured on this Mac; set WEFT_RELAY_SECRET_KEY.");
  return vault().sendValue(String(folder), String(name), env,
    (label) => `seal the ${provider} signing secret ${name} (${label}, ${env}) and store it on the relay`,
    (value) => sealedToHex(sealSecret(value, key)));
},
```

The plaintext never crosses IPC, never reaches the Next server and never reaches the thread that asked for the
relay. `createRelay` then writes the sealed ciphertext into the `webhook_relays` row beside the provider, and
refuses to create a relay at all when the webhook names no known provider, has no vault secret, or the Touch ID
was declined.

**Verifying at the relay.** `lib/webhook-signatures.ts` holds one verifier per provider in a `PROVIDERS` map:
`stripe` (a `t=…,v1=…` header over `${t}.${body}`, taking the last `v1` so a rotated key still checks — Stripe
sends two signatures during a rotation), `github` (`x-hub-signature-256`, a `sha256=<hex>` HMAC), `vercel`
(`x-vercel-signature`, HMAC-SHA1 hex) and `svix` (a `svix-signature` header over `${id}.${ts}.${body}`, with a
5-minute replay window and a space-separated list of signatures accepted). Comparisons go through
`timingSafeEqual` on hex buffers, inside a `try`/`catch` so malformed hex is a refusal, not a crash.

`lib/webhook-relay.ts` `handle()` now refuses before it saves anything:

```ts
// after
const provider = relay.provider?.trim();
if (!provider) return text("Relay has no provider; create a fresh relay through Weft.", 403);
const verifier = PROVIDERS.get(provider);
if (!verifier) return text("Unknown provider", 403);
const key = opts.key ?? relayKeyFromEnv();
if (!key) return text("Relay signing key is not configured on this deployment", 503);
const secret = openSecret(sealedFromHex(relay as unknown as Record<string, unknown>), key);
if (!secret) return text("Relay signing key mismatch", 403);
const headers = providerHeaders(keptHeaders(req.headers));
const bodyText = new TextDecoder("utf-8", { fatal: false }).decode(body);
if (!verifier.verify(secret, bodyText, headers, (opts.now ?? Date.now)())) return text("Bad signature", 401);

await store.save({ relay_id: relay.id, user_id: relay.user_id, method: req.method, path: extra, headers, body: base64(body) });
```


The bytes, headers and method the provider sent are unchanged on the way to the target, so the target's own
signature check still passes. A missing provider is a 403, an unknown provider a 403, a deployment with no key a
503, a bad signature a 401 — never an open relay.

**Keeping the ciphertext private.** `supabase/migrations/20261024121524_webhook_relay_provider.sql` adds
`provider text not null default ''`, `secret_ciphertext bytea`, `secret_nonce bytea` and `secret_key_id text`,
then revokes the table from `anon` and `authenticated` and grants only
`select (id, user_id, name, provider, created_at)`. The secret columns are never selectable by a client role.
`lib/webhooks.ts` gains `providerFor(hook)` (the hook's own `provider` field, else its lowercased name when that
matches a known provider) and `cleanProvider` (which refuses anything else); `lib/webhook-tools.ts`'s `relay` tool
now says the webhook must name a known provider and the vault name of its signing secret.

**Key rule:** a relay that forwards into a private network must prove the delivery's origin at the point of
forwarding, and when the proof material can't reach the forwarder, seal it on the side that owns it and carry only
ciphertext.

Two operational notes. `WEFT_RELAY_SECRET_KEY` must be the **same value** on the Mac and on the deployment: a Mac
that seals with one key and a deployment that opens with another refuses every delivery (403).
`WEFT_RELAY_SECRET_KEY_ID` (default `v1`) lets the key rotate without losing rows — an unknown key id refuses
rather than failing open.

**Files:** `lib/webhook-signatures.ts` (new — the provider registry), `lib/webhook-signatures-hmac.ts` (new — the
shared HMAC helpers), `lib/relay-secret.ts` (new — the AES-256-GCM sealing, `server-only`),
`electron/relay-secret.cjs` (new — the CommonJS mirror for Electron main), `electron/pane-routes.cjs` (the
`POST /webhooks/relay-seal` route), `lib/webhook-forward.ts` (`createRelay` seals and inserts),
`lib/webhook-relay.ts` (`handle` verifies), `lib/webhooks.ts` (`providerFor`, `cleanProvider`),
`lib/webhook-tools.ts` (the `relay` tool's description),
`supabase/migrations/20261024121524_webhook_relay_provider.sql`, and the tests beside them:
`lib/webhook-signatures.test.ts`, `lib/relay-secret.test.ts`, `electron/relay-secret.test.ts`,
`lib/webhook-relay.test.ts`, `lib/webhook-forward.test.ts`, `lib/webhooks.test.ts`,
`electron/pane-routes.test.ts`.
