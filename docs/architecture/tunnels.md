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

The webhook relay is store and forward: a provider gets 200 before your route runs. A Cloudflare quick tunnel gives the
live connection for free, with no account or domain, but its URL changes on
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

## On a worker

Built 2026-11-02 with `supabase/migrations/20261102190000_worker_tunnels.sql` (not applied). Unit-tested; not yet run
against a live worker and Mac.

A worker has no session and no Touch ID, so its owner's Mac approves and writes the row, and the worker only publishes
a URL on a row the Mac stamped for it. The gate and cloudflared are the same code on both; only the host differs
(`lib/tunnel-host.ts`: `lib/tunnel-mac.ts` on the Mac, `lib/tunnel-worker.ts` on a worker, picked by `WEFT_WORKER`).

```
worker thread ─ mcp__webhooks__tunnel ─▶ worker_mac_ask(tunnel_open) ─▶ device_calls ─▶ owner's freshest desktop
Mac inbox ─▶ lib/device-call-approvals.ts ─▶ Touch ID (POST /tunnels/approve) ─▶ tunnels row as the owner:
           worker_id, approved_target, approved_until ─▶ answer { approved, until }
worker ─▶ gate + cloudflared ─▶ worker_tunnel_open(key, id, quick URL, secret) ─▶ /t/<id> works, owner only
```

- **Approval** (`lib/worker-mac-ask.ts`): a `tunnel_open` device call through `worker_mac_ask`, which only takes a card
  the worker owns, one ask per card and tool at a time (a trigger, `device_calls_approval_origin`, refuses an approval
  tool queued any other way, such as through `worker_device_call`), and goes to the owner's most recently seen desktop. No Mac in
  the last minute, or none that claims it within 45 s (its Realtime ping, else its 30 s check), is a plain error ("open Weft there"); an answer waits up to 5
  minutes. A thread on the worker can ask, but only the person at the Mac can say yes.
- **The Mac's half** (`lib/device-call-approvals.ts`, run by `lib/device-calls.ts` beside the inbox's other calls, not
  behind them): every arg is re-read. The target must be an http localhost origin, the id a UUID, the hours 0.25 to 24,
  and the folder and worker name are cleaned before they reach the prompt. A row that's already the Mac's own, or another
  worker's, is refused. The Mac makes the row as the owner (so `/t/<id>` is owner-only as ever) and stamps
  `approved_target` and `approved_until`.
- **Writes** (`worker_tunnel_open`, `worker_tunnel_close`, key-checked): open puts a URL and secret on a row only while
  `worker_id` is this worker's and `approved_until` hasn't passed, and only a `https://*.trycloudflare.com` URL and a
  64-hex secret, so a stolen worker key can't approve itself or point the address at a site of its choosing. It can,
  while an approval is live, swap in another quick tunnel's URL (one it runs): the owner would land on that host and a
  worker relay's deliveries would follow it. That's the approval window's cost; revoking the worker ends it. Its expiry
  is the approval's. Close clears the URL, the secret and the approval, so reopening asks again. The owner's grants on
  `tunnels` gain `approved_target`/`approved_until` (update) and `worker_id` (insert, checked by `private.owns_worker`,
  which also refuses a revoked worker).
- **Opens don't stack**: `openTunnel` shares one in-flight open per folder and target, so the drawer's Open beside a
  thread's call, both waiting minutes on the Mac, can't start two gates and orphan one.
- **cloudflared on the box**: `install/worker.sh` fetches the same pinned release into
  `~/.weft-worker/data/bin/cloudflared-<version>`, checked by hash (`lib/tunnel-cloudflared-install.test.ts` keeps the
  script and `ASSETS` equal); without it, Weft fetches it on the first tunnel as on the Mac. Verified on m1mini
  (darwin-arm64): download, hash, `--version`.
- **The gate's lifetime** (`lib/worker-reach.ts`, from `scripts/weft-worker.ts`): the daemon process owns the gate and
  cloudflared. On start it closes on the row whatever a dead process left published (`closeLeftovers`); on SIGTERM it
  closes what it opened. `cleanGateTarget` refuses a non-localhost target the same way.
- **The pane**: `openOnWorker` (`lib/worker-pane.ts`) trades a localhost URL for its open tunnel's `/t/<id>` address plus
  the path, and the board shows it as a site with Open ↗. With no tunnel open it says to open one.

Relays to a worker's server follow its tunnel (webhooks.md#on-a-worker); its dev servers reach the Services drawer through
it (dev-servers.md#on-a-worker).

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
- **Workers** open tunnels through their owner's Mac ([On a worker](#on-a-worker)); the Mac has to be awake, signed in
  and syncing to approve one. A worker key holder could still run cloudflared on the box within an approval's window:
  the approval names the worker, not the process.
- **Weft's own edge**: the move would keep the stable address and the gate. Vercel Functions now hold WebSockets
  (`experimental_upgradeWebSocket` in `@vercel/functions`), so that edge could live on the existing deployment instead
  of Cloudflare. Untested, including whether it carries streaming any better.
- **Not exercised live:** the Next dev server's cross-origin check for hot reload through the gate.
- **A hard kill:** cloudflared stops when the server exits, but a `kill -9` can orphan it. Its gate is gone by then, so
  it reaches nothing, and the row keeps its URL until it expires.
