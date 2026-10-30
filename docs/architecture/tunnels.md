# Tunnels

Status: built 2026-10-30, with `supabase/migrations/20261030141826_tunnels.sql` applied. Not live until the deployment
carries `/t`. Tested in unit tests so far, with a separate spike of quick tunnels against a throwaway server.

A tunnel gives a local dev server a private address that works from anywhere: live pages, hot reload, an OAuth
callback, a webhook that needs your route's real answer. It's the `mcp__webhooks__tunnel` tool and **Open a tunnel** in 🪝.

```
browser ─▶ weft.zip/t/<id> ─▶ sign-in, owner check ─▶ tunnels row ─▶ 302 with a ticket
        ─▶ xyz.trycloudflare.com ─▶ cloudflared on the Mac ─▶ gate ─▶ localhost:3000
```

## Why it's built this way

The webhook relay is store and forward: a provider gets 200 before your route runs, and Vercel functions can't hold a
socket. A Cloudflare quick tunnel gives the live connection for free, with no account or domain, but its URL changes on
every start and anyone holding it can reach the server. Weft adds what's missing:

- **The stable address.** A `tunnels` row keeps the current URL, and `/t/<id>` (`lib/tunnel-address.ts`) looks it up.
  The same project and target keep their id (`~/.weft/tunnels.json`), so a saved address still works next time.
- **The gate.** `lib/tunnel-gate.ts` sits between cloudflared and the dev server, because a quick tunnel has no sign-in.
  It is the only thing keeping a tunnel private.

## Security

- **Owner only.** `/t/<id>` needs a Weft session on the row's owner. Anyone else gets the same 404 as an unknown id.
- **Tickets.** `lib/tunnel-ticket.ts` signs with HMAC-SHA256 under a secret the Mac makes on each open. They last 60 s
  and work once. An **enter** ticket buys a 12 h `HttpOnly; Secure; SameSite=Lax` session cookie. A **forward** ticket
  carries one webhook delivery, bound to its method and path.
- **The secret.** `tunnels.ticket_secret` is written by the owner and read only by the service role: an owner's grants
  skip that column. It's cleared on close.
- **Touch ID for every open**, a thread's included (`POST /tunnels/approve`). Nothing reopens a tunnel after a restart.
- **Never Weft's own port.** `cleanGateTarget` refuses it because that port is the board's API, and only an http
  localhost target is allowed. `x-weft-token` and the gate's own cookie and header never reach the dev server.
- **It closes itself.** The default is 4 hours and the cap is 24. Close is the kill switch: the row forgets the URL and secret.
- **cloudflared is pinned.** `lib/tunnel-cloudflared.ts` fetches one release into `~/.weft/bin` and checks GitHub's
  sha256 digest. To upgrade, change `VERSION` and the digests together.
- **What it isn't:** end to end. TLS ends at Cloudflare, which can see the traffic.

Host and Origin are rewritten to the target's, so a dev server's host check passes on a hostname it has never seen.
A redirect to the target's own origin becomes relative, or it would send the visitor to their own localhost.

## Webhooks

While a tunnel is open, `linkRelays` sets `tunnel_id` and `tunnel_path` on the relays of that server. The relay
(`lib/webhook-relay.ts`) checks the provider's signature as ever, then sends the delivery straight to the route, and
the provider gets its real answer, which closes the challenge gap in docs/architecture/webhooks.md. A 401, 502, 503, 504
or 530, a network failure or a closed tunnel means the route wasn't reached, so the delivery is stored as before. A
route slower than 8 s can see a delivery twice. The relay's 1 MB limit still applies.

## What the spike found (2026-10-30, cloudflared 2026.10.6)

| Test | Result |
| --- | --- |
| WebSocket echo | Worked, 303 to 645 ms |
| 2 MB POST | Arrived whole |
| Streaming, 128 KB chunks | Arrived in steps, from 2.9 s |
| Streaming, small chunks | Held back, one block at 6.7 s |
| SSE | Held back, one block at 14 s; Cloudflare documents it as unsupported |
| New hostname reachable | 2 runs of 3 within 60 s |

## Gaps

- **AI streaming:** tiny chunks are held back, so a streaming reply appears late and all at once.
- **Quick tunnels** are for testing and development, with no uptime guarantee and 200 requests in flight. A restart can
  take a minute or more to answer on its new URL.
- **Workers** don't open tunnels yet: `lib/tunnels.ts` needs the desktop shell for approval and the account session.
  The move to one's own edge would keep the stable address and the gate.
- **Not exercised live:** the Next dev server's cross-origin check for hot reload through the gate.
- **A hard kill:** cloudflared stops when the server exits, but a `kill -9` can orphan it. Its gate is gone by then, so
  it reaches nothing, and the row keeps its URL until it expires.
