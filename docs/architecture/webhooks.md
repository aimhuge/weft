# Webhooks

Status: built 2026-10-13. The relay's migration (`supabase/migrations/20261013155726_webhook_relays.sql`) and the
deployed receiver go live with the next migration push and Vercel deploy. The relay's signature gate landed
2026-10-20 (pentest F-12): `supabase/migrations/20261024121524_webhook_relay_provider.sql`, applied.

🪝 sits on the rail right under 🔐 and works like it: a list per project of the webhooks its code receives, kept by
the threads that write that code, with a count of the ones not set up yet. A webhook here is a provider (Stripe,
GitHub, Resend…) posting to a local route (`/api/stripe/webhook`). Two halves, used apart or together:

- **A to-do list.** A thread that writes a webhook route records it (`mcp__webhooks__add_blank`): its name, the local
  route it reaches (`target`), the provider's events, a hint for where to register it and its signing secret's vault
  name. Until the provider sends to it, it's a **blank**: 🪝's count, like 🔐's missing values.
- **A public URL that reaches your dev server.** A dev server on localhost can't be reached from outside, so a webhook
  can get a relay URL on the deployed Weft, `https://weft-topaz.vercel.app/api/hooks/<id>`. Register that URL with
  the provider and its deliveries arrive at `target`, byte for byte, while Weft runs: like `stripe listen` or a
  tunnel, for any provider. It needs a Weft account (the relay rows are yours).

## The registry

`lib/webhooks.ts`, `~/.weft/webhooks.json`. A `Webhook` is `{ id, folder, name, target, events?, hint?, secret?,
provider?, registered?, url?, relayId?, deliveries? }`, one per name in a folder. `target` is only ever on this Mac
(`localhost`, `127.0.0.1`, `[::1]`); a bare path goes to `http://localhost:3000`. Adding a name that's there
already fills in what's given and keeps the rest, like the vault's `add_blank`. `deliveries` keeps the latest 10
forwarded (method, the local route's status or 0 for unreachable, time taken), and a webhook that gets one is
registered from then on. Names and URLs only: the signing secret is a 🔐 vault name, and its value stays there.

`provider` says whose signature the relay will check: `stripe`, `github`, `vercel` or `svix` (the wire shape
Resend and Clerk use). It defaults to the lowercased name when that matches (`stripe` → `stripe`), so a "resend"
webhook declares `svix` explicitly. `providerFor` resolves it; a webhook with neither gets no relay URL.

## Threads: `mcp__webhooks__*`

`lib/webhook-tools.ts`, in every card thread beside `mcp__secrets__*` (`lib/runner-session.ts`), auto-allowed
(`isTrustedTool`). The tools run in the Next server and call the registry directly.

| Tool | What it does |
| --- | --- |
| `list` | The project's webhooks: target, events, blank or registered, relay URL, secret name, last delivery. |
| `add_blank` | Records a webhook the code needs; a `secret` name also goes into the 🔐 vault as a blank. Nothing opens. |
| `ask_add` | The same, then opens 🪝 on it (`POST /webhooks/ask-add` on the control server → the board's `add-webhook` message), for when the thread is blocked on it. |
| `relay` | Gives it a public relay URL, to register at the provider (its dashboard in the pane, or a CLI). Needs the provider (`stripe`, `github`, `vercel`, `svix`) and the vault name of its signing secret: the secret is sealed into the relay row after one Touch ID. |
| `mark_registered` | The thread registered it at the provider itself. |

`WEBHOOKS_PROMPT` tells threads to record each webhook as soon as they know its route, use `relay` rather than a
tunnel, register it themselves when they can and `ask_add` only when blocked.

## The relay

```
provider ─▶ /api/hooks/<id>[/…] on Vercel ─▶ webhook_deliveries row ─▶ Realtime ─▶ your Weft ─▶ target
```

1. **Create.** `lib/webhook-forward.ts` `createRelay` seals the provider's signing secret and inserts a
   `webhook_relays` row on your account (RLS: yours only) with its id, URL, provider and the sealed secret.
   It keeps the id and URL on the webhook.
2. **Receive.** `app/api/hooks/[id]/…` on the deployment (no localhost guard: the unguessable id is the address)
   runs `lib/webhook-relay.ts`: any method, at most 1 MB, headers minus hop-by-hop, Vercel's own and `x-weft-token` (the local API's write header, which a stranger must never supply), the body as
   base64 so a provider's signature still checks, saved with the Supabase secret key. Rows older than a day go.
3. **Forward.** Your Weft listens for its `webhook_deliveries` inserts (Realtime, like the GitHub relay), reads each
   row, sends it to `target` with the same method, headers and body, records the delivery, and deletes the row, so
   payloads don't wait on Weft's Supabase. Deliveries that came while Weft was closed (under a day old) are
   forwarded when it starts. The provider gets 200 from the relay either way: your route's own answer shows in the
   drawer, not to the provider. The path after the relay id is appended to the target (`targetUrl`) unless it holds a
   `.` or `..` segment (even `%2e%2e`), which would climb to another local route; then the delivery goes to the target as is.

### The signature gate (pentest 2026-10-20, F-12)

The relay used to save **every** request it received. Anyone holding a relay id could then write any method, any
headers and any body to the owner's localhost target. It now refuses anything that doesn't carry the provider's
own signature.

- **What Weft can verify.** `lib/webhook-signatures.ts` holds one verifier per provider: Stripe
  (`stripe-signature: t=…,v1=…`, HMAC over `t.body`), GitHub (`x-hub-signature-256: sha256=…`), Vercel
  (`x-vercel-signature`, HMAC-SHA1) and Svix (`svix-signature` over `id.timestamp.body`, with a 5-minute
  replay window). Comparisons are constant-time. An unknown provider is refused.
- **Where the secret lives.** The signing secret is in the user's 🔐 vault and can't be read on Vercel. The local
  Weft seals it on the way in: `electron/relay-secret.cjs` AES-256-GCM under `WEFT_RELAY_SECRET_KEY` (64 hex
  chars), after one Touch ID (`vault.sendValue`, `POST /webhooks/relay-seal` on the control server). The plaintext
  never crosses IPC, never reaches the Next server and never reaches the thread. The deployed relay opens it with
  the same key (`lib/relay-secret.ts`); `secret_key_id` lets the key rotate without losing rows, and an unknown
  key id refuses the delivery.
- **What the relay answers.** A wrong or missing signature: `401 Bad signature`, nothing saved. A row with no
  provider (one created before this change): `403`, nothing saved — recreate it through `mcp__webhooks__relay`.
  A deployment with no `WEFT_RELAY_SECRET_KEY`: `503`. Never an open relay.
- **What the user's route sees.** Unchanged: the bytes, headers and method the provider sent, so the route's own
  signature check still passes.

Existing relay rows keep their deliveries in `webhook_deliveries` flowing, but stop accepting new ones until the
local Weft recreates them with a known provider and a sealed secret.

## The drawer

`components/WebhooksDrawer.tsx`, `lib/use-webhooks.ts` (loads through `/api/webhooks`, polls while open so
deliveries show), `lib/webhooks-view.ts` (pure). A project filter like the vault's; a row per webhook with a
**blank** pill until it's registered; open a row for its relay URL (Copy, or **Get a public URL**), hint, secret
name, the latest deliveries, **Mark registered** and Remove. `+ Add` takes the same fields a thread gives.

## Gaps

- The relay answers the provider before your route runs, so a provider that reads the reply (a URL verification
  challenge) doesn't see your route's answer.
- One Weft per account forwards: two Macs signed in to the same account race for each delivery.
- Only the four providers above can be relayed. A provider with its own signature scheme needs a verifier added
  to `lib/webhook-signatures.ts` before it gets a relay URL.
- `WEFT_RELAY_SECRET_KEY` has to be on both the Mac and the deployment, and must be the same value: a Mac that
  seals with a different key than the deployment opens with refuses every delivery (403).
