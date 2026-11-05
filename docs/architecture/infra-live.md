# The live infrastructure read

The weekly repo-analysis report is a file in `~/.weft/show`. It is written once, so every number in it
is a number from the day it was written. This is the part of Weft that makes the report's numbers
true at the moment you read it: a route that reads the real systems, and a bridge that lets a
`file:` page ask the route without ever holding Weft's launch token.

## What it reads

Two sources, and they need two different credentials — they are not the same thing.

| Source | Credential | What it gives |
| --- | --- | --- |
| `public.infra_live()` over PostgREST | `SUPABASE_SECRET_KEY` (the project's secret key) | database size, file storage size and object count, auth users, table counts, card and thread counts |
| The Analytics log stream | `SUPABASE_ACCESS_TOKEN` (a Management API personal access token) | **egress** — the only record of it |

The egress read is the interesting one, and it is easy to get wrong. There is no "bytes out" metric
anywhere in Supabase's API. The only evidence of egress is the log stream, and the number lives in
the response's `content_length` header, split by the cache status:

- `response.headers.cf_cache_status = "HIT"` — served from the CDN. Billed at the cheap rate.
- `response.headers.cf_cache_status = "MISS"` or `"DYNAMIC"`, or none at all — uncached. Billed at the full rate.

The storage service spells the same header `res.headers.content_length` instead. `EGRESS_SQL` reads
both. If you change this, the split is the whole point: an egress number that doesn't separate cached
from uncached doesn't tell you whether the CDN is doing its job.

**Sum on Supabase's side.** `readEgress` sends `EGRESS_SQL` (ClickHouse SQL over the single `logs` table)
to `GET /v1/projects/{ref}/analytics/endpoints/logs` with `iso_timestamp_start`/`iso_timestamp_end`. That
endpoint answers at most 1,000 rows, and a day is ~86k log lines, so pulling rows and summing them on
the Mac counts a sliver. The query groups by source and cache status, and `parseEgress` adds those few
rows up. A bad query still answers 200, with `{ error }`; `readEgress` throws on it. The old
`logs.all` endpoint is gone (410).

**When the number is big, ask which path.** The first live read (2026-10-29) showed 1.6 GB in a day, 99% of
it one 400 KB thumbnail fetched 3,980 times: the share page's 4 s poll re-signed it every time, and a new
signed URL is a new `<img src>`. `mergeBlobUrls` in `lib/share-view.ts` now keeps a held URL until it's
near expiry. Group `edge_logs` by `request.url` (before the `?`) and cache status to find the next one.

## The route

`app/api/infra/live/route.ts` is an ordinary route behind `lib/guard.ts` — it needs the launch token
and a localhost host, like every other route. It answers one JSON snapshot:

```jsonc
{
  "at": "2026-10-26T19:51:38.430Z",
  "live": { "database_bytes": 181376691, "storage_bytes": 240229844, ... },
  "egress": { "uncached_bytes": 49452, "cached_bytes": 19554, "requests": 12677, ... },
  "providers": [{ "name": "Supabase", "state": "live" }],
  "quotas": [{ "resource": "Database size", "now": "173 MB", "free": "500 MB", "fill": 0.34 }],
  "notes": ["SUPABASE_ACCESS_TOKEN isn't set, so the egress is unread."]
}
```

**One source failing never fails the route.** A missing key leaves `live` null and a note saying why;
the report shows the other source's numbers and says the other is unread. That is more useful than an
error page, and it is why the page can say "everything else here is live" honestly.

`lib/infra-live.ts` holds the reads, the parsers and the quota rows. It has no Next dependency, so it
can be tested and probed on its own.

## The bridge

A report page is a `file://` URL. It has no token, and it must never have one. So:

- `electron/pane-preload.cjs` exposes `window.weft.liveData(path)` on `file:` pages only. The page
  names a **path**, never a URL.
- `electron/live-data.cjs` answers `live-data:read`. It checks the sender is the pane's own main frame
  (`senderOk` in `electron/app-data-frame.cjs`), refuses any path that isn't on its allowlist
  (`/api/infra/live`), and does the GET itself with the launch token.
- `electron/server-info.cjs` is the one accessor for the server's url and token, read fresh — the
  server may not be up when main wires this.
- `electron/app-setup.cjs` wires it; `electron/mini-apps-setup.cjs` is main's call into it.

The result: the page asks for a path, main answers with JSON, and the token stays in main.

## Where the numbers come from

`public.infra_live()` is a `security definer` SQL function
(`supabase/migrations/*_infra_live.sql`). It sets `search_path = ''`, is revoked from `public`, `anon`
and `authenticated`, and is granted to `service_role` only — so it is reachable with the secret key and
not with anything a browser could hold.

## Making it live

1. Put `SUPABASE_SECRET_KEY` in the 🔐 vault (development).
2. Put `SUPABASE_ACCESS_TOKEN` in the vault too — a personal access token from
   `supabase.com/dashboard/account/tokens`. This is the egress half; without it the report says the
   egress is unread instead of showing a stale number.
3. Let the vault write `.env.local` (the drawer's **Write .env.local** action), and restart Weft so the
   server picks the new value up.

`pnpm infra:probe` calls the route the way the report page does and prints the snapshot — the fastest
way to see which half is live.

## Files

- `lib/infra-live.ts` — the reads, the parsers, the quota rows
- `app/api/infra/live/route.ts` — the route
- `electron/live-data.cjs` — the bridge
- `electron/server-info.cjs` — the server's url and token, read fresh
- `electron/app-setup.cjs` — where the bridge is wired
- `electron/mini-apps-setup.cjs` — main's call into the mini-app wiring
- `supabase/migrations/*_infra_live.sql` — the SQL function
- `scripts/probe-infra-live.ts` — `pnpm infra:probe`

## R2

The route also reads `public.blob_mirror_stats()` (`readR2Live`): the objects and bytes copied to Cloudflare R2 and
what's still only in Supabase. Cloudflare R2's provider row is live once one object is copied, and the quotas gain an
**R2 storage** row against R2's 10 GB free tier. A failed read leaves `r2` null with a note. docs/architecture/r2.md.
