# Hosted mini apps

A mini app today is a page on the Mac (mini-apps.md): a file or a folder under `~/.weft/apps/<slug>/`,
shared as one uploaded page at `weft.zip/a/<id>` or under its owner at
`weft.zip/@username/apps/<slug>` or `weft.zip/<org-slug>/apps/<slug>`, with data reads that run only in
Weft on the Mac that granted them. **React apps** is the next step, and it is built: a folder with
`App.tsx` and no `package.json`, bundled by Weft with its own React into static files and served from
weft.zip under its owner, with secrets that never reach a viewer. **Full Next.js apps on Workers** is the
later shape, for an app that needs server code.

Status (2026-10-20): the React-apps shape is built (see "React apps: no server code, $0" below for the
current state, file names and the service-role-only tables it added). The Workers shape is still design.

## Why not inside weft.zip

- **Next builds routes at deploy time.** weft.zip is one Next.js build on Vercel. A `route.ts` is compiled
  when Weft deploys; there's no supported way to load new server code from a blob at runtime, and every
  app edit would mean redeploying Weft for everyone.
- **It would hold weft.zip's keys.** Code in weft.zip's process sees weft.zip's env: `SUPABASE_SECRET_KEY`
  behind `serviceClient()` (`lib/web-session.ts`), `SHARE_GATE_SECRET`, billing keys. One app's `route.ts`
  could read every account's cards. On weft.zip's origin its JavaScript would also ride the viewer's
  weft.zip session.

So "ships with Weft" fits only Weft's own reviewed apps. Everyone else's runs in its own sandbox, on its
own origin.

## React apps: no server code, $0

### What's built

```
~/.weft/apps/<slug>/
  App.tsx           # a React app, or skip and hand-write index.html
  charts.tsx
  styles.css
  weft-app.json     # the policy: secrets, public names, reads
```

- **Build, on the Mac.** `lib/app-build.ts` bundles `App.tsx` with esbuild (already in Weft's
  `node_modules`) against Weft's own React 19 into static files in the same folder: `index.html`,
  `app.js`, `app.css`, and an `assets/` directory for imported images and fonts. A generated `index.html`
  carries `<!-- weft:generated -->`; a hand-written one is left alone and the build reports `skipped`, not
  `ok`. The wrapper HTML is in `lib/app-build-html.ts`; the folder walk, hashing and entry/hand-written
  detection are in `lib/app-build-inputs.ts`. Allowed bare imports are `react`, `react-dom`,
  `react-dom/client`, `react/jsx-runtime` and `react/jsx-dev-runtime` only; anything else fails the build
  with a message naming the package, so a thread adding a dep learns the rules instead of bundling a
  missing module. A broken build keeps the previous `app.js` so the pane still loads, with an error banner.
- **Watch and reload.** `lib/app-build-watch.ts` watches `~/.weft/apps` recursively and rebuilds any app
  folder whose sources change, debouncing 150 ms after the last save. The watcher is started lazily from
  `lib/copilot.ts` `prewarm()`, one watcher per server boot, saved on `globalThis` so dev reloads don't
  end up with two. Build output (`index.html`, `app.js`, `app.css`, `assets/`, `.weft-build.json`, `.build/`)
  is ignored so a build never triggers itself. On every server start, anything without a build record (or
  whose inputs changed) is rebuilt up front, falling back from `fs.watch`'s `recursive: true` (macOS,
  Windows) to the next start on Linux for deep subfolders. `electron/app-reload.cjs` reloads the pane
  after a build.

### Where it lives: under its owner

A link sits under the entity that owns it:

- **User.** `weft.zip/@<username>/apps/<slug>` — the link's creator's username (the `profiles.username`
  of `created_by`). A user-owner private link is creator-only.
- **Org.** `weft.zip/<org-slug>/apps/<slug>` — a workspace the creator is a member of.

URLs parse as `/@<user>/apps/<slug>` and `/<org>/apps/<slug>`. `proxy.ts` rewrites them through
`lib/app-routes.ts` `appLinkTarget()` to the route folders that serve them:
`app/u/[username]/apps/[slug]/page.tsx` and `app/w/[org]/apps/[slug]/page.tsx`. The reserved first-segment
set in `lib/app-routes.ts` lets `proxy.ts` reject matches on `_next`, `api`, `app`, `s`, `w`, `u` and
other top-level folders at the edge with no session work. The render body is shared:
`app/u/[username]/apps/[slug]/shared-app-body.tsx` is also imported by the org route, so both views are
the same flow. Both pages wrap the body in `<Suspense>` (cacheComponents): params are request data and are
awaited inside it, while the shell prerenders. A local Weft that's not deployed renders a card pointing
to the Share dialog instead — shared apps live on weft.zip.

`lib/app-share-types.ts` declares `AppOwner = "user" | "org"`, `APP_SLUG_RE`, `appPublicUrl(owner, ownerSlug, slug)`,
`appSlugFrom(name)` (from "📈 Growth" to `growth`) and `paneAddress(app, url)` (the pane's address bar shows
an app's name and link instead of a `file:///Users/...` path).

Every link gets an address, not only one whose slug field was edited (`lib/app-share-slug.ts`): a share with no
slug writes the app's default (`defaultAppSlug`: its `~/.weft/apps/<slug>/` folder name, else `appSlugFrom(name)`),
moving on to `<slug>-2` … `<slug>-9` past a taken one and only then going up without a slug. Opening Share… on a
link from before this (`slug` null) backfills it the same way (`backfillSlug` in `getAppShare`), so Copy link gives
`weft.zip/@<user>/apps/<slug>` instead of the bare `/a/<id>`.

`MIGRATION 20261019095618_app_hosting.sql`:

- `cloud_app_shares` gains `owner`, `slug`, `files (jsonb path→sha256)`, `manifest (jsonb policy)`; `kind`
  can now be `'folder'` and `page` is the entry path (`index.html`). `manifest` carries the share's
  secrets + public names + reads + supabaseUrl (a reduced `weft-app.json`: `folder` and `env` are local
  pointers that never leave the Mac). `supabaseUrl` is where a Supabase read sends the author's
  `SUPABASE_SECRET_KEY`, so it must be an `https` Supabase project URL (`<ref>.supabase.co` /
  `.supabase.in`, no credentials, no port): `safeSupabaseUrl` in `lib/app-folder.ts` enforces it when
  the manifest is reduced and `app/api/a/[id]/read/route.ts` enforces it again per read, so neither a
  hand-edited manifest nor a row written before the rule can aim the key at another host (pentest
  2026-10-20, F-11). Custom domains and self-hosted Postgres are not usable as a read host.
- `cloud_app_secrets (share_id, name, viewer_id null=author, ciphertext)` — AES-256-GCM under
  `WEFT_MINIAPP_KEY` (a server-only key in weft.zip's Vercel env), with AAD = `shareId|name|viewerId ?? ""`
  so a row copied to another app/name/viewer fails to open. RLS on, no policies, no grants — only
  weft.zip's routes reach it through the service client.
- `cloud_app_fetches (share_id, viewer_id, method, host, path, status, at)` — the call log; the route
  reads the last minute's rows for its rate limit, and the app's owner can see where its keys went
  (host, path, status; never the value).

`MIGRATION 20261019120202_app_share_move_owner.sql` adds `update (org_id)` to the column grants so a
user-owned link can move to a workspace (and back) — the update policy already enforces membership; the
grant was missing.

### Hosting

Every file the Mac uploads is one blob in `weft-blobs/<org>/<sha>`, with the path list in `files`
(`lib/blob-store.ts`, `lib/blob-paths.ts` — home only, never the vault or a secret). The folder app's
folder lives at `~/.weft/apps/<slug>/` and is walked by `lib/app-folder.ts`, which refuses `.ts`/`.tsx`/`.jsx`
sources, hidden entries, `weft-app.json` and `node_modules`, and caps the app at 2,000 files, 25 MB per
file and 50 MB total.

A single-file page anywhere else (an agent's `~/.weft/show/<topic>/index.html`) that links to files beside
it (`<img src="us.webp">`, a stylesheet, `srcset`, CSS `url()`) is shared as a folder too, of just the page and
the files it names: `lib/page-assets.ts` scans the HTML for relative references inside the page's folder
(no `..`, no symlinks out, names the folder route serves, the blob-path rules, the same size caps). A page
that names none stays a single blob and keeps its `#hash`. Anything else under `/api/a/<id>/` is a plain
404 (`app/api/a/[id]/[...rest]`), not the HTML not-found page.

Files are served from `app/api/a/[id]/f/[...path]/route.ts`, which is gated by `appShareAccess` and served
through `lib/share-page-serve.ts` (the same sandboxed page serve as a card's link) with a CSP `sandbox`
without `allow-same-origin`, so the app runs in an opaque origin and can't read weft.zip's cookies.
`injectBridgeScript` in `lib/app-bridge-inject.ts` inserts the inline `<script>` right after `<head>` (or
the doctype, or the `<html>` tag); that script defines `window.weft` for the app. `parentOriginFromRequest`
gives the script the request URL's origin so the postMessage handler accepts only the parent that served
the page; an opaque or empty origin (`""`, `"null"`) makes the script a no-op that defines a `window.weft`
whose four methods always reject — fail closed at the boundary, the page still loads, the bridge just
doesn't work.

### The bridge: same API on both sides

The app's `window.weft` is the same on the Mac (Electron preload, `electron/pane-preload.cjs`) and on
weft.zip (injected inline script). `lib/app-bridge.ts` is the contract: `BRIDGE_TAG`, `BridgeRequest`,
`BridgeResponse`, `AppFetchRequest`, `AppFetchResult`, `parseBridgeRequest`. The four ops are:

- `weft.fetch(url, { method, headers, body })` — placeholders like `{{secret:STRIPE_KEY}}` may sit in the
  URL, a header value, or the body; Weft swaps them for values outside the browser, only where the policy
  allows, runs the call and returns `{ status, ok, headers, body, bodyEncoding: "utf8" | "base64" }`.
- `weft.read(name, args?)` — a named read from the manifest (a Supabase function or a GA4 report), the
  same shape data apps called on the Mac before this shipped.
- `weft.env()` — the manifest's `public` values, as is.
- `weft.requestSecret(name) → { set: boolean }` — asks Weft (never the app) to collect this viewer's own
  value for a `from: "viewer"` secret.

`components/share-view/use-app-bridge.ts` is the parent side. The frame's contentWindow is checked against
`event.source`, the data is parsed through `parseBridgeRequest`, and each op calls one of Weft's
`/api/a/<id>/{fetch,read,env,secret}` routes and posts a BridgeResponse back. `requestSecret` resolves
through the parent's form renderer (`components/share-view/AppSecretForm.tsx`), shown as a portal over
the frame so the app can never read the field or fake the answer; `set` is the only thing the app ever
learns.

The Mac side answers every op through `electron/app-data-fetch.cjs` (the same pane-frame gate as the data
mini-app reads, plus the `parsePolicy` policy layer and a DNS check before the call). The weft.zip side
answers `fetch`, `read` and `env` through the same `electron/app-fetch-run.cjs` `runFetch` and
`electron/app-fetch-policy.cjs` `parsePolicy` — the route lazy-imports them with `await import()`
(`app/api/a/[id]/fetch/route.ts`) so Next's startup never pulls esbuild or the cjs files. `requestSecret`
is answered by `app/api/a/[id]/secret/route.ts`, which gates through `appShareAccess`, requires the
secret to be declared `from: "viewer"` and caps the PUT body at 4 KB. All four ops are rate-limited per
share + per viewer by `lib/app-fetch-limit.ts` and logged to `cloud_app_fetches` (host, path, status;
never the value).

### The policy

The manifest is the policy:

```json
{
  "secrets": {
    "STRIPE_KEY": { "hosts": ["api.stripe.com"], "methods": ["GET"], "paths": ["/v1/charges"] },
    "OPENAI_API_KEY": { "from": "viewer", "hosts": ["api.openai.com"], "methods": ["POST"], "paths": ["/v1/responses"] },
    "GROWTH_READ_KEY": { "hosts": ["lqjyravglujyizyqypxq.supabase.co"], "methods": ["POST"], "paths": ["/rest/v1/rpc/growth_"] }
  },
  "public": ["SUPABASE_PUBLISHABLE_KEY"],
  "reads": { "signups": { "supabase": "growth_signups_by_day", "args": { "days": 30 } } }
}
```

Enforced by `electron/app-fetch-policy.cjs` and `app-fetch-run.cjs` (shared by `/api/a/<id>/fetch` and the
Mac):

- A secret goes only to its hosts (exact or `*.example.com`), over https, with no redirect followed to
  another host and no private or metadata address (no SSRF; a DNS lookup refuses loopback, RFC 1918,
  link-local and `*.local`).
- Methods and path prefixes are matched; a method outside `methods` or a path outside `paths` is refused.
- A placeholder anywhere else (the URL, a header, a body sent to an unlisted host) refuses the request.
- A `from: "author"` secret's value comes from `cloud_app_secrets` (the author's row, `viewer_id IS NULL`),
  decrypted for the request only. A `from: "viewer"` secret's value comes from the same table keyed by
  the current viewer; if missing, the call rejects with a clear status.
- The response body is scanned for the secret value and masked as `‹NAME›` if it echoed.

Prefer restricted keys (Stripe's read-only, a Postgres role that may only run `growth_*`): the policy
limits where a key goes, the key limits what it can do there.

### Whose secret, and where it lives

- **`"from": "author"` (default).** The app's owner sets it once in 🔐 (secrets.md); everyone who passes
  the gate uses it, within the policy. Growth's read key works this way. The Mac uploads the value with
  one Touch ID through `electron/app-secrets-push.cjs` (wired in `electron/app-setup.cjs`): reads the
  manifest from the dialog's state, reads the named values from the vault, prompts Touch ID naming the
  app, the secrets, the hosts, and `weft.zip`, and PUTs them through `app/api/apps/secrets` (a service
  role route that seals each value with `lib/app-secrets.ts` `seal()`).
- **`"from": "viewer"`.** Each viewer brings their own key, so a shared app can call Stripe or OpenAI as
  them. On the Mac it comes from the viewer's own 🔐 vault with their own Touch ID; on weft.zip, the
  parent page draws Weft's own form (`components/share-view/AppSecretForm.tsx`, host list from the
  manifest, value sealed into `cloud_app_secrets` keyed by share + name + viewer). The app only learns
  `{ set: true }` or `{ set: false }`, never the value.

`cloud_app_secrets` carries one row per `(share_id, name, viewer_id)`; `viewer_id IS NULL` is the author,
else the viewer. Each ciphertext is bound to its app, name and owner by AAD (`shareId|name|viewer`), so
a row copied to another app or name won't decrypt.

### Public values

`public` lists keys meant for browsers (a Supabase publishable key, a Stripe publishable key, a GA
measurement id). They arrive as `weft.env().NAME`. A value the secret scan (`lib/secret-detect.ts`) reads
as a secret key is refused there.

### Not end-to-end, unlike the 🔐 vault

The vault's Supabase rows are ciphertext Weft's servers can never read (secrets.md). A cloud app secret has
to be usable by weft.zip, since weft.zip makes the call, so weft.zip can decrypt it: a database dump
alone reveals nothing, but someone with both the database and the Vercel key could. That's why it only
happens on purpose: an app used only in Weft on the Mac never uploads a value, and the Touch ID sheet
says "weft.zip will be able to use this key with api.stripe.com" before one goes up.

### Access, plans and limits

`access` is the link's gate. Any mode is allowed, public included, even for an app that uses the author's
secrets (decided 2026-10-19): a value never reaches a visitor, but whoever passes the gate can make the
calls the policy allows with it, so a public link lets anyone read what the key reads or spend what it
spends. Growth lives at `weft.zip/aimhuge/apps/growth`, open to the AimHuge workspace only.

The fetch route rate-limits per app (`lib/app-fetch-limit.ts`), caps body size and time, and logs each
call (host, path, status; never the value). Super-admins can switch an app's secrets off.

**Views are unlimited on every plan, and so is the number of links** (decided 2026-10-24). What a plan
caps is the bytes a workspace's open links serve together: Free 25 MB, Pro, Open Source and Education
1 GB, Team 5 GB (`APP_SHARE_BYTES` in `lib/billing/plans.ts`). A private link doesn't count, so making one
private frees its room; a site link stores nothing. The database is the gate:
`supabase/migrations/20261024124411_app_share_quota.sql` adds `cloud_app_shares.bytes`, and a trigger
weighs every insert or update from the blobs its `page` and `files` name in `storage.objects` (never a
size the client sends), reads the workspace's plan the way `workspacePlan` does (`private.org_plan`) and
raises `app_share_quota: <total> of <cap> bytes on the <plan> plan` past the cap. The Mac
(`lib/app-share-quota.ts`) asks `app_share_quota(org, except_share)` first, so Share refuses with a 402
and the dialog's wording before anything uploads, turns the trigger's refusal into the same wording, and
leaves a link on its last version (with the reason in the dialog) when edits made on open wouldn't fit.
The Share dialog shows the room in use (`components/ShareAppQuota.tsx`), and the billing page's plan
cards say each plan's room (`appShareLabel`). A workspace that drops to a smaller plan keeps serving what
it has; the next write that changes an open link's page, workspace or mode is checked. `lib/app-share-quota.test.ts`
keeps the SQL's numbers in step with `APP_SHARE_BYTES`.

**Page views are cached, and capped for bots.** The viewer frames a versioned URL
(`lib/app-share-frame.ts`): `/api/a/<id>/page/<sha>` for a single page, `/api/a/<id>/v/<ver>/<entry>` for a
folder, where `<ver>` is 32 hex of sha256 over the sorted files map and every sibling resolves under the
same `/v/<ver>/` by relative URL. `lib/app-share-serve.ts` serves all four page routes (the two versioned
ones and the old `/page` and `/f/`): it refuses a sha or version the row no longer names, so a cache entry
can only be what the row named, and for a **public** link on a versioned URL it answers
`Cache-Control: public, max-age=31536000, immutable` with `Vercel-CDN-Cache-Control: max-age=3600`
(`APP_CDN_SECONDS`). Vercel's CDN then answers the crowd: one function call and one storage download per
file per CDN region per hour, however many views. The CDN key is the whole URL with its host, and the only
per-request part of the body is the bridge's parent origin, which is that host, so a cached page can't
carry one origin's bridge to another. Private, email and password links, and the unversioned URLs, stay
`private, max-age=300` and run the gate every time. A link switched from public to private stops being
linked at once (the viewer page runs the gate) and a saved frame URL stops answering within the hour,
when the CDN's copy ends; purging by tag from the deployed side would close that window, and is open.
The uncached path is capped by `lib/app-page-limit.ts`: 1,200 requests a minute per address (hashed with
`WEFT_MINIAPP_KEY`) and 6,000 per share, in fixed one-minute windows held in memory per server instance,
not a database row per view (which would cost more than the view), and swept past 20,000 keys. A real
crowd never meets it: behind the CDN only misses, and private links, reach a function.

Every one of these routes answers through `lib/app-share-reply.ts`: `NO_STORE` (they're never cached),
`reject(status, error)` for a refusal and `rateLimited(retryAfter)` for a 429 with `Retry-After`. A page
reads the status out of the body, so the same shape across read, fetch, env, secret and the push route
means one error path on the page.

### What it can't do

Its own server code: a `route.ts`, server rendering, a webhook endpoint, a call that needs signing logic
Weft doesn't do. When an app needs that, it moves to the Workers shape below; the manifest stays the same.

### Cost

Nothing new: files sit in `weft-blobs` on Supabase and the fetch route runs on Vercel, both already paid. A
public link's page views are served by Vercel's CDN (above), so a viral link costs CDN bandwidth, not a
function call and a storage download per file per view; the plan's byte cap bounds what can be shared.

### Where data app reads still run

`weft.read(name, args?)` answers the data-app reads (Supabase functions, GA4 reports) on the Mac and, for a
shared app, on weft.zip (`app/api/a/[id]/read`) with the author's keys. Those keys are named by the reads, not by
a `secrets` block: `lib/app-read-needs.ts` `readNeeds` (the Mac's `deriveNeeds` in `electron/app-data-grants.cjs`)
gives `SUPABASE_SECRET_KEY` and the GA4 pair, and the Share dialog's Upload secrets button, the push and
`app/api/apps/secrets` all count them. A page written for the Mac's pane also calls `weft.access()`,
`requestAccess()` and `revoke()`; on weft.zip they answer from `app/api/a/[id]/access` with the Mac's shape
(`granted` always true, `missing` = the read keys not uploaded yet). Growth runs unchanged in both places.
Earlier, reads were Mac only. The weft.zip / API route sides call into the same `electron/app-data-fetch.cjs` and
`electron/app-data.cjs` flows as the data app did; the `from: "viewer"` and `from: "author"` split for
secrets is new, the read declaration in `weft-app.json` is the same shape it already was.

---

## Workers for Platforms, briefly (future)

Cloudflare's product for running customers' code on a platform's account
([how it works](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/how-workers-for-platforms-works/)):

- **Dispatch namespace**: one bucket of user Workers (`weft-apps`, plus `weft-apps-staging`). Cloudflare
  advises one namespace for all customers, not one each.
- **User Worker**: one per app, uploaded by API. In a namespace it runs in *untrusted mode*: it never
  shares a cache with another tenant and can't read `request.cf`.
- **Dynamic dispatch Worker**: Weft's own Worker on the apps domain. It looks the app up by hostname and
  calls `env.DISPATCHER.get(name, {}, { limits, outbound })`, passing per-app CPU and subrequest limits.
- **Outbound Worker** (optional): sees every `fetch()` a user Worker makes, and gets per-app parameters
  (an allowlist) from the dispatcher. With one set, user Workers can't open raw TCP sockets (`connect()`),
  so databases are reached over HTTP (Supabase's REST and RPC; Hyperdrive later).
- **Custom limits**: CPU ms and subrequests per invocation; a user Worker over either throws at once.
- **Price** ([pricing](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/platform/pricing/)):
  $25/month with 20M requests, 60M CPU ms and 1,000 scripts; then $0.30 per million requests, $0.02 per
  million CPU ms, $0.02 per script. A request through dispatcher, user Worker and outbound Worker
  counts once.

This is Weft's Cloudflare account, not yours: the rail's Cloudflare drawer (cloudflare.md) stays your own
projects.

**Dynamic Workers** ([docs](https://developers.cloudflare.com/dynamic-workers/)) are a newer alternative:
a parent Worker composes a sandboxed Worker from code at runtime, with chosen bindings, egress
interception and limits. Their API and pricing aren't documented well enough yet to design on; the spike
checks them against a namespace.

## The Workers app on disk (future)

```
~/.weft/apps/growth/
  app/page.tsx
  app/api/stats/route.ts
  weft-app.json
```

No `package.json`, `node_modules` or lockfile: Weft supplies them. `weft-app.json` gains:

```json
{
  "name": "📈 Growth",
  "runtime": "next",
  "deps": { "recharts": "^3" },
  "env": ["GROWTH_READ_KEY", "GA4_SERVICE_ACCOUNT_JSON"],
  "egress": ["lqjyravglujyizyqypxq.supabase.co", "analyticsdata.googleapis.com", "oauth2.googleapis.com"],
  "limits": { "cpuMs": 50, "subrequests": 50 },
  "access": "workspace"
}
```

An app without `"runtime": "next"` stays a page on the Mac, as today.

## Build, on the Mac (future)

Weft builds the folder with **vinext**, Cloudflare's Vite-based reimplementation of the Next.js API and
its recommended way to run Next.js on Workers ([vinext 1.0](https://blog.cloudflare.com/vinext-nextjs-on-vite/);
still labeled beta), with OpenNext's Cloudflare adapter as the fallback. The dependency set (react,
react-dom, vinext) is pinned per Weft release; the manifest's `deps` install into
`~/.weft/app-builds/<id>/` with the bundled pnpm, never into the folder. The output is one Worker module
plus static assets.

The Mac builds because it already has the toolchain (`scripts/bundle-toolchain.mjs`) and the CPU; there
is no build service to run. A cloud build for edits made on weft.zip is later.

## Deploy, through weft.zip (future)

The Mac never holds Weft's Cloudflare token. A deploy:

1. **Scan.** Every file in the folder and the build output goes through the secret scan
   (`lib/secret-detect.ts`, the pre-commit hook's key shapes). A key-shaped value refuses the deploy and
   names the file.
2. **Review.** One Touch ID sheet names the app and what changed since the last deploy: new `env` names,
   new `egress` hosts, raised `limits`, a wider `access`. First deploys list everything.
3. **Upload.** The bundle goes to `weft-blobs` by content hash (`lib/blob-store.ts`, already built), then
   the Mac calls `POST weft.zip/api/apps/deploy` with the hashes.
4. **Place.** weft.zip checks the account's plan and quota, checks the manifest against the policy rules
   below, and uploads the script to the namespace with its own token (`CF_PLATFORM_TOKEN`, Workers Scripts
   edit on that account), tagged `account:<id>` and `org:<id>` so an account's apps can be listed and
   removed by tag.
5. **Record.** A `cloud_hosted_apps` row: app id, script name, host, the manifest's policy and its hash,
   last deploy, status. The tile and the pane switch from `file://` to the app's https address.

## Secrets (future Workers shape)

- **Names in the manifest, values in 🔐.** The app's values live in the vault (secrets.md), in a vault
  keyed `app:<id>`. They never go in the folder, the blobs or `cloud_mini_apps`, which carry names only.
- **Sent once, at deploy.** After the Touch ID in step 2, Electron main sends the values for the declared
  names to the deploy route over TLS. weft.zip sets each as a Worker secret
  (`PUT …/dispatch/namespaces/weft-apps/scripts/<name>/secrets`) and keeps nothing: no log line, no row,
  no blob. Cloudflare stores them encrypted and hands them only to the running Worker as `env.NAME`; the
  API never returns them.
- **Only what's declared.** A secret on the script that isn't in `env` is deleted at deploy. A key-shaped
  value under a plain variable or a `NEXT_PUBLIC_` name is refused, so it can't end up in the browser
  bundle.
- **Rotate.** Change the value in the vault, then **Push secrets** on the app's menu (Touch ID, no
  rebuild).
- **Scoped keys, not master keys.** The policy check warns on a name that looks like a provider's master
  key (`SUPABASE_SECRET_KEY`, a service role). Growth gets `GROWTH_READ_KEY`, a JWT for a Postgres role
  that may only execute the `growth_*` functions.

The one trust step: values pass through weft.zip's memory on their way to Cloudflare. Cloudflare's API
tokens can't be scoped to one script, so the alternative (the Mac calling Cloudflare itself) would mean a
token that reaches every app.

## The policy, and what enforces it (future)

| Rule | Enforced by |
| --- | --- |
| `env`: the only secrets it gets | weft.zip at deploy: sets these, deletes the rest |
| `egress`: the only hosts its server may call | the outbound Worker, from per-app parameters: anything else gets a 403 and a log line the app's page shows; no raw TCP |
| `limits`: CPU ms and subrequests per request | the dispatcher's custom limits; the plan sets the ceiling |
| `access`: who may open it (private, workspace, email, password, public) | weft.zip's gate (`lib/app-share-access.ts`) and the signed pass below |
| Origin: never weft.zip's | apps live on their own subdomain of a separate apps domain, listed on the Public Suffix List so apps can't set each other's cookies |
| Review: what widened | the Touch ID sheet at deploy |
| Kill switch | super-admins disable an app (the dispatcher refuses it) or remove an account's apps by tag |

**The signed pass.** The dispatcher refuses a request without a pass for that app, except for public
apps. weft.zip's gate issues it after the viewer gets through: short-lived, signed with a key only
weft.zip and the dispatcher share, for one app id, carrying the viewer (account and email, or
anonymous). The dispatcher sets it as a cookie on the app's own host and forwards the viewer to the app
as a signed `x-weft-viewer` header. So the deployment can't be reached around the gate, and the app knows
who's looking.

## The link and the pane (future)

`cloud_app_shares` gains a `hosted` kind: `weft.zip/a/<id>` runs the gate as today, then frames the app's
host with the pass. The pane on the Mac shows the app's https address and a Share button
(`components/ShareAppDialog.tsx` from the toolbar). Locally, **Run** on the tile starts the app's dev
server through Weft (`mcp__devservers__*`, dev-servers.md), with the vault's development values in its env
(`electron/secret-env.cjs`), and the pane shows it.

## Costs and plans (future)

The $25 base covers 1,000 apps, 20M requests and 60M CPU ms a month. Past that, an app is $0.02 a month
and a million page views about $0.70 ($0.30 in requests, $0.40 in CPU at an assumed 20 ms each; the spike
measures the real figure).

| Stage | Apps | Requests/mo | Total/mo |
| --- | --- | --- | --- |
| Today: the Weft team | 10 | 100k | $25 |
| 500 accounts | 1,000 | 3M | $25 |
| 2,000 accounts | 4,000 | 10M | ~$88 |
| 10,000 accounts | 20,000 | 50M | ~$433, of which $380 is the per-app fee |
| One public app goes viral | +0 | +100M | about +$70 |

**A cheaper start.** The weft.zip Cloudflare account has no paid plan yet (2026-10-19). Workers for
Platforms is $25 from the first month. Workers Paid ($5/month) with Dynamic Workers runs the same
sandboxed build: one Weft Worker loads each app's code with the Worker Loader, blocks or filters its
outbound calls, and sets its limits. It includes 10M requests, 30M CPU ms and 1,000 app-days a month,
then $0.002 per app per day it runs ([pricing](https://developers.cloudflare.com/dynamic-workers/pricing)).
That passes $25 at around 350 apps used every day, which is when to move to a namespace. The difference
that matters: with Dynamic Workers, Weft keeps each app's secrets (encrypted, the key in the loader's
own secret) and passes them in as `env`; in a namespace Cloudflare keeps them per script. Building and
running apps on the Mac, and step 1, cost nothing.

So the app count drives the bill, not traffic. Free accounts get a small number of hosted apps (say 2)
with low limits; pages without server code are served from `weft-blobs` instead of becoming Workers; Pro
($20/month) raises the quota, metered like Puku tokens (billing.md). A Pro user with 10 apps and 100k
views costs about $0.27 a month. The dispatcher can rate-limit an app per minute. Other costs: the apps
domain (~$10–15 a year), bundles in `weft-blobs` (inside Supabase Pro's 100 GB for thousands of apps),
the deploy route on Vercel (one call per deploy).

## Unknowns the spike settles (future)

- No documented example of vinext or OpenNext output deployed into a dispatch namespace. Untrusted mode
  (no shared cache, no `request.cf`) may break parts of either; ISR needs a per-app KV binding, so the
  first version has no ISR.
- Worker size: 10 MiB compressed on a paid plan. Check it at build and say so.
- vinext is beta; the Weft release pins a version that passed the spike.
- Dynamic Workers versus a namespace: deploy speed, price, limits.

## Build order (future Workers)

0. **Spike.** A two-route Next folder (a page and a `route.ts` that reads a secret) built with vinext on
   the Mac, uploaded to `weft-apps-staging` by API, reached through a dispatcher with an outbound
   allowlist. Measures size, build time and what breaks.
1. **Pane.** A Share button in the toolbar for a saved app, and the app's name instead of `file://`.
   *Built; see React-apps half above and `components/AppShareButton.tsx`.*
2. **Platform.** The namespace, dispatcher, outbound Worker, the apps domain and `cloud_hosted_apps`.
3. **Deploy from the Mac.** Build, scan, review, upload, place; secrets with Touch ID.
4. **Gate pass** and the `x-weft-viewer` header.
5. **Growth** as the first hosted app, with `GROWTH_READ_KEY`.
6. **Plans.** Quotas and limits per plan, the admin kill switch, the app's logs (a Tail Worker) on its
   page.

## Decisions still open

- The apps domain's name (it needs registering and a Public Suffix List entry).
- Who may deploy: every signed-in account with a small quota, or Pro only.
- Public apps at all, at first: hosting anyone's public pages brings abuse reports and takedowns.
