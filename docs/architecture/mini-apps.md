# Mini apps

A mini app is a page from the browser pane, saved so it is one click away on the left rail. A thread's HTML page in
`~/.weft/show`, a dashboard, a dev server, any site: if the pane can show it, it can be an app.

## Where it shows

- **Rail tiles.** `components/AppsRail.tsx` draws one tile per app under the 🖥 Services icon in `components/LibraryRail.tsx`,
  behind its own divider. With no apps it renders nothing, not even the divider. `Board.tsx` passes the pane's current URL
  down as `paneUrl` (unset outside the desktop app, which also hides the tiles); the tile for the page on screen gets a ring.
- **Save button.** `components/SaveAppButton.tsx` is the grid button in the pane's toolbar (`components/BrowserPane.tsx`).
  It saves the page under its title (`appNameFrom`: title, else host, else the file's name). On a page that already is an
  app it is lit and removes it. It is disabled for anything `cleanAppUrl` refuses (about:, data:, weft:).
- **Tile.** The name's first grapheme on a steady hue (`tagHue`), or the emoji the name starts with (`appGlyph`).
- **Right-click** (`appMenu`, popped through `window.weft.popupMenu`): Open, Rename… (in place, Enter keeps it,
  Escape drops it), Share…, Move up, Move down, Copy address, Remove app.
- **My mini apps.** `components/LoomApps.tsx` is a section on the Loom dialog's You tab (`components/LoomDialog.tsx`), under
  your wefter card: one row per app (its tile, name, and where it lives, or how it's shared), a click opens it in the board's
  pane (`showPage`) and closes the dialog, and its share button opens the Share dialog. With no apps it says how to save one.

## Data flow

1. `lib/mini-apps.ts`: pure model. `MiniApp {id, name, url, addedAt}`, `cleanAppUrl` (http, https, file), `cleanAppName`
   (40 characters), `appFor` (the app a page is: same address ignoring `#hash`, else the closest saved app it sits inside),
   `upsertApp` (saving a saved page renames it), `moveApp`, `appMenu`.
2. `lib/mini-app-store.ts`: the list and its order in `~/.weft/apps.json`, read when used (not at import).
   `saveApp`, `updateApp` (`name` and/or `to`), `removeApp`; a saved page saved again without a name is returned unchanged.
3. `app/api/apps/route.ts`: GET (no write header), POST `{url, name?}`, PATCH `{id, name?, to?}`, DELETE `{id}`;
   `lib/guard.ts` host check, errors as 400.
4. `lib/use-mini-apps.ts`: one list in module memory behind `useSyncExternalStore`, shared by the tiles and the save
   button so a save shows on the rail at once. Every change goes to the server and then reloads the list from it.
   The list also reloads when the window gets focus, so an app saved elsewhere (a thread calling the route) shows up.

## Sharing an app

A mini app link lives under its owner: `weft.zip/@<username>/apps/<slug>` (you, the sharer's username) or
`weft.zip/<org-slug>/apps/<slug>` (a workspace you're a member of). `weft.zip/a/<id>` keeps working for any
pre-slug link.

**Share…** (the tile's right-click menu, or the share button in My mini apps) opens
`components/ShareAppDialog.tsx`: the same `@aimhuge/share` dialog and modes as a card's link (sharing.md),
minus editing, for one link with an owner picker (yourself, or any workspace you're a member of) and a
slug. Its sign-in and no-workspace parts are `components/ShareParts.tsx`, shared with
`components/ShareCardDialog.tsx`. The Share button in the pane's toolbar is a second entry point:
`components/AppShareButton.tsx`, only for a saved app
(`paneAddress(app, url)` in `lib/app-share-types.ts` — the address bar shows the app's name and link
instead of a `file:///Users/...` path, focused or not).

A mini app lives on the Mac, not in cloud sync, so the share row carries its own copy of what to show
(`lib/app-share.ts`):

- **A local page** (`file://`, usually a `~/.weft/show` page) is uploaded to `weft-blobs/<org>/<sha>` by the
  blob store, under the same path rules as cloud sync (`lib/blob-paths.ts`: home only, never the vault or
  a secret). The row's `page` is `blob:sha256:<hex>#hash`. Each time the dialog opens, a changed file is
  uploaded again and the row moved to it, as is a renamed app, so the link shows the page as of the last
  time you opened Share….
- **A folder** (`~/.weft/apps/<slug>/`) is uploaded wholesale by path: every file in the folder becomes one
  blob, the folder's relative paths are the row's `files` map, and `page` is the entry file's path
  (typically `index.html`). `lib/app-folder.ts` walks the folder (realpath'd, no symlinks or `..`), refuses
  hidden entries, `weft-app.json`, `node_modules` and `.ts`/`.tsx`/`.jsx` sources (a half-built React app's
  TypeScript should not end up in a hosted bundle), scans each text file with `lib/secret-detect.ts` and
  caps the share at 2,000 files, 25 MB per file and 50 MB total. A React app is a folder whose `index.html`
  Weft generated (carries `<!-- weft:generated -->`), built by `lib/app-build.ts` from `App.tsx` with
  esbuild and Weft's React 19 — see `mini-app-hosting.md` for the build, the watcher
  (`lib/app-build-watch.ts`, started from `lib/copilot.ts` `prewarm()`), and the bridge.
- **A public https site** is stored by address and framed as is, with an Open link for sites that refuse
  framing.
- **Anything only this Mac reaches** (localhost and `.local` hosts, LAN addresses, plain http, a file Weft
  won't upload) answers `unshareable` with the reason, and the dialog says it instead of the fields.

The dialog draws at once from `app.share`, the last answer kept on the app in `apps.json`
(`rememberAppShare`), which also lets My mini apps mark the shared ones. Removing an app deletes its share
row (`dropAppShare`, best effort).

On weft.zip, the public URL the dialog holds goes through `proxy.ts`. `lib/app-routes.ts` `appLinkTarget()`
rewrites `/@<user>/apps/<slug>` to `/u/<user>/apps/<slug>` (handled by `app/u/[username]/apps/[slug]/page.tsx`)
and `/<org>/apps/<slug>` to `/w/<org>/apps/[slug]` (handled by `app/w/[org]/apps/[slug]/page.tsx`). Both
pages wrap a shared body in `<Suspense>` for cacheComponents and import the render logic from
`app/u/[username]/apps/[slug]/shared-app-body.tsx`. The reserved first-segment set in `lib/app-routes.ts`
lets the proxy reject matches on top-level folders (`_next`, `api`, `app`, `s`, `w`, `u`, etc.) at the edge
with no session work. `SharedApp` (the client viewer) owns the secret form as its own state: a server page can't hand it a function
prop, which crashed every shared app on 2026-10-23. Loading, failure and 404 states are in [web-states.md](web-states.md).

The body runs the gate (`lib/app-share-access.ts`'s `appShareAccessBySlug`, the same `gateVerdict` as a
card's link in `lib/share-access.ts`, plus a user-private rule: a user-owned private link is creator-only,
not just workspace-only) and draws `components/share-view/SharedApp.tsx`: a thin header and the page
full-window. **A blob** is framed from `app/api/a/[id]/page`, which serves only the blob the row names.
**A folder** is framed from `app/api/a/[id]/f/[...path]` (the entry file, with sibling paths for scripts,
styles and images), sandboxed through `lib/share-page-serve.ts` with a CSP `sandbox` without
`allow-same-origin` (the app's frame has an opaque origin) and with key-shaped text masked. The bridge
script — `lib/app-bridge-inject.ts` `injectBridgeScript()` — is appended to every served HTML so the app's
`window.weft` answers `fetch`, `read`, `env`, and `requestSecret` through the parent page. The email and
password gates post to `app/api/a/[id]/unlock` (`lib/share-unlock.ts`, the same rate limit, pass cookie
and off-Vercel refusal a card's unlock route uses). `weft.zip/a/<id>` keeps working as a fallback for any
pre-slug share; the same `SharedApp.tsx` body draws it without an owner.

### Link previews

A public app link unfurls as itself in Slack, X or iMessage, not as Weft's generic card. The row's `preview`
jsonb (`supabase/migrations/20261023150831_app_share_preview.sql`, at most 4 KB) holds a title, a description,
a picture and what they were made from (`lib/app-preview.ts`). For each field, the first source that exists wins:

| Field | 1. You | 2. The app | 3. The page | 4. Weft |
| --- | --- | --- | --- | --- |
| Title | — | `weft-app.json` `title` | `og:title`, `twitter:title`, `<title>` | the app's name |
| Description | the Share dialog | `weft-app.json` `description` | `og:description`, `twitter:description`, `description` | one Haiku sentence from the page's text |
| Picture | — | `weft-app.json` `image` (https, or a path in the folder) | `og:image`, `twitter:image` | the branded card with a capture of the app |

- **Made on the Mac, in the background** (`lib/app-preview-capture.ts`). `getAppShare` and `setAppShare` call
  `refreshAppPreview` after their row write, and it runs only when the page changed since the last preview
  (`of`: the page's blob ref, the site's address, or the folder entry's sha). The capture is
  `POST /page/snapshot` on the control server (`electron/page-snapshot.cjs`): the app in a hidden, sandboxed
  1200×630 window, on its own in-memory session (none of the pane's sign-ins), no popups or cross-site
  navigation, muted, one at a time. The PNG is saved to `~/.weft/app-previews/<app id>.png` and uploaded to
  weft-blobs like any page. No capture is taken when the app or page names its own picture.
- **Read on weft.zip, for public links only** (`lib/app-share-meta.ts`). The three share routes'
  `generateMetadata` is `"use cache"` on params alone (it never reads the gate's cookie, so the shell still
  prerenders; `lib/prerender-check.ts`) and returns the title, description, Open Graph and Twitter tags. A
  private, email or password link gets the generic "Shared app · Weft" and the root card, so its name, words
  and screenshot never reach a stranger's chat. Links stay `noindex`; unfurlers ignore it.
- **The branded card** is `GET /api/a/[id]/og` (`lib/app-card-image.tsx`, Satori): the app's glyph, its
  name, its description, its owner (`@username` or the workspace's name) and the capture tilted in on the
  right, on the home page's palette and Fraunces. It serves a folder app's own picture when the preview names
  one by blob, and 404s for anything but a public link. The metadata adds `?v=` with a hash of the preview,
  so a new preview is a new address and the route can cache for a day.
- **The Share dialog** shows the same card (`components/ShareAppPreview.tsx`, drawn locally from this Mac's
  capture by `lib/app-share-preview-actions.ts` through `app/api/apps/share/preview`): **Refresh preview**
  makes it again, and the description is editable. Yours is kept over every refresh (`by.description: "you"`),
  and clearing it hands the description back to the page and Haiku. While the Mac is working, the state says
  `previewing` and the dialog asks again every 4 s.

Schema: `supabase/migrations/20261018131912_app_shares.sql`, then `20261019095618_app_hosting.sql` and
`20261019120202_app_share_move_owner.sql`. `cloud_app_shares` is one row per (workspace, sharer, app) and
now carries `owner`, `slug`, `files`, `manifest`; `kind` adds `'folder'`; one slug is unique per sharer
(user) or per workspace (org). Members read it without `password_hash`; only the sharer writes; the
database fills `created_by`. `cloud_app_share_visits` holds who got through an email gate, readable by
the sharer only. The service-role-only tables `cloud_app_secrets` (AES-256-GCM under
`WEFT_MINIAPP_KEY`, `lib/app-secrets.ts`) and `cloud_app_fetches` (host, path, status; never the value)
back the host's `weft.fetch` and `weft.requestSecret` calls — see `mini-app-hosting.md`.

## Data apps: a folder, an env, reads

A data app holds a folder: `~/.weft/apps/<slug>/` with its page (`index.html`) and a manifest (`weft-app.json`), saved as a
mini app like any page. The manifest names the project folder it reads (whose 🔐 vault and Supabase link it uses), the
one vault environment it asks for, and its reads by name:

```json
{ "name": "📈 Growth", "folder": "/Users/you/dev/weft", "env": "production",
  "supabaseUrl": "https://<ref>.supabase.co",
  "reads": { "signups": { "supabase": "growth_signups_by_day", "args": { "days": 30 } },
             "pageviews": { "ga4": { "dateRanges": [{ "startDate": "30daysAgo", "endDate": "today" }], "metrics": [{ "name": "screenPageViews" }] } } } }
```

- **It requests permission to an env.** The pane's preload (`electron/pane-preload.cjs`, on `file:` pages only) gives the
  page `window.weft`: `access()`, `requestAccess()`, `revoke()`, `read(name, args?)` and `fetch(url, init)` (the
  `fetch` half is the same one a hosted app uses; see `mini-app-hosting.md`). `requestAccess()` is a Touch ID
  naming the app, the project and the env and the vault names its reads need (`SUPABASE_SECRET_KEY` for a
  `supabase` read; `GA4_PROPERTY_ID` and `GA4_SERVICE_ACCOUNT_JSON` for a `ga4` one). The grant is kept in
  `~/.weft/app-grants.json`, keyed by the app's folder, with a hash of its manifest: change the env, the folder
  or a read and the app asks again. Call it `window.weft` or give it another name (`const bridge = window.weft`),
  never a top-level `const weft`: the contextBridge makes `window.weft` a non-configurable global, so that
  binding is a redeclaration and the browser refuses the whole script, leaving a page with no grant bar and no
  data (jsdom doesn't, so a test there won't catch it).
- **Main runs the reads** (`electron/app-data.cjs`; which frame may ask in `electron/app-data-frame.cjs`, grants
  in `electron/app-data-grants.cjs`, the two read kinds in `electron/app-read-core.cjs` through main's front door
  `electron/app-data-reads.cjs`, the `fetch`/`env`/
  `requestSecret` half in `electron/app-data-fetch.cjs` sharing the pane-frame gate). It answers only the main
  frame of a pane page (`event.sender.mainFrame`) that is a file directly in one app's folder,
  `~/.weft/apps/<slug>/` (real path, so no symlink or `..` out, and not nested deeper), saved as an app, beside
  a `weft-app.json`. The page sends a read's name and only the args its manifest declares, of the same type; it
  never sends SQL, a URL or a function name. A `supabase` read calls that Postgres function through PostgREST
  with the env's `SUPABASE_SECRET_KEY`, as a GET: PostgREST runs it in a read-only transaction and only calls
  a `stable` function that way, so a manifest naming a function that writes gets an error, not a write. The
  manifest's args are the defaults the page may override; a `ga4` read signs a service-account JWT, gets a
  token (cached) and runs the manifest's `runReport`. A read needs only its own names, so a blank GA4 key
  doesn't stop the Supabase reads, and a missing one says which (`GA4_PROPERTY_ID has no value in
  aimhuge/weft · production yet.`). Supabase's and Google's errors come back as their message. Rows come
  back capped at 5,000 rows and 2 MB, with a 15 s timeout; values stay in main. `fetch` runs through
  `electron/app-fetch-policy.cjs` and `electron/app-fetch-run.cjs` (the same policy + run the weft.zip fetch
  route uses, loaded through `await import()` so the Mac's startup path doesn't pull them): per-secret
  hosts/methods/paths, no redirect to another host, no SSRF (DNS refuses loopback, RFC 1918, link-local,
  `*.local`), value masked in the response if it echoed.
- **A `supabase` read's host is checked twice, on both paths.** The manifest's `supabaseUrl` is the host the
  env's `SUPABASE_SECRET_KEY` gets sent to, and a `weft-app.json` is untrusted input — anyone can save an app.
  So a `supabaseUrl` that isn't an https Supabase project URL (`https://<ref>.supabase.co` or `.in`, bare
  host, no credentials, no port) is refused at manifest load *and* again at read time, before the secret is
  read: `safeSupabaseUrl()` in `lib/app-folder.ts`, with a CJS twin in `electron/app-read-core.cjs` that main
  can reach (`electron/app-data-frame.cjs` refuses the same values when it loads `weft-app.json`). The request
  is then built on the validated *origin*, not the raw string. Two gates because a manifest, or a share row,
  written before the rule must not be able to point the key at a host of its choosing.
  `electron/app-data-reads.test.ts` asserts the CJS twin and the `.ts` original answer identically on every
  case: they're one rule in two files, and that test is what keeps them one rule.
- **One read implementation for both paths.** The local read (main) and the hosted read
  (`app/api/a/[id]/read/route.ts`) used to be two copies of the same code, which is how the host check above
  landed on one and not the other. Both now run `electron/app-read-core.cjs`: `runSupabase`, `runGa4`,
  `cleanArgs`, `flattenGa4`, the service-account JWT and token exchange, the caps and the timeout, each taking
  `fetch` as a parameter. It lives in `electron/` because main can't import `.ts` and only `electron/**` ships in
  the packaged app; the route loads it through `lib/app-read.ts` with `await import()`, as the fetch route loads
  `app-fetch-run.cjs`. A refusal throws an Error tagged `err.kind` (`bad-request`, `manifest`, `missing`,
  `bad-args`, `upstream`, `too-large`, `timeout`, `network`; an upstream answer adds `err.status`): main hands
  the kind to the page, and `lib/app-read.ts` `readStatus` maps it to the route's HTTP status (400, 413, 504,
  502, or the upstream's own). The one place the two still differ is on purpose and named: the hosted read passes
  `defaults: false`, so it sends only the page's args, while main also sends the manifest's declared defaults.
- **Reads are functions, reviewed in a migration.** The project's `supabase/migrations/` defines what an app
  may read: `security definer`, `set search_path = ''`, executable by `service_role` only, so the anon and
  signed-in keys can't call them. Weft's own are `growth_*` (`supabase/migrations/20261018054110_growth_reads.sql`).
- **On weft.zip**, a shared data app gets the same `window.weft` from the bridge script
  (`components/share-view/use-app-bridge.ts` answering through `app/api/a/[id]/{fetch,read,env,secret}` — the
  `read` half behind `app/api/a/[id]/read`, the `fetch` half in `app/api/a/[id]/fetch/route.ts`, both with
  the gate and the rate limit and the log). The `requestSecret` form is drawn by the parent page
  (`components/share-view/AppSecretForm.tsx`) over the frame, never inside it. The author's secrets were
  uploaded from the Mac with Touch ID via `electron/app-secrets-push.cjs` and the manifest's
  `"from": "author"` values; a `"from": "viewer"` secret is stored per-viewer in `cloud_app_secrets` (see
  `mini-app-hosting.md`).
- **Outside Weft** (a normal browser, a weft.zip share link with no bridge) `window.weft` isn't there and the
  page says to open it in Weft on a Mac: the data never leaves the Mac it was granted on. A granted page sees
  its rows and can do with them what any page can, so grant only apps you trust.

📈 **Growth** is the first one (`~/.weft/apps/growth/`): accounts, signups and active accounts per day, weekly
retention cohorts and the activation funnel from Weft's own Supabase (production), and page views, top pages and
sources from GA4 once its two vault names have values.

## Persisted on prod

Every mini app is also a row in Weft's production Supabase, `cloud_mini_apps` (`lib/app-cloud.ts`,
`supabase/migrations/20261018061014_cloud_mini_apps.sql`), under the signed-in account's workspace: its name, address,
place on the rail and kind (`site`, `file` or `folder`). A file's or folder's page goes up to `weft-blobs` by content hash
(only when it changed), and a folder app's manifest goes with it. `app/api/apps` pushes after each save, rename, move
and remove (a remove leaves a tombstone, so it never comes back), after the response. A list syncs at most every 5
minutes, in the background: an app this Mac lacks is written to `~/.weft/apps/<id>/` and added to the rail, and an app
prod has no row for (saved before this, or signed out) goes up. A failed push is a warning in the server log; the local
save stands. Rows are the
owner's only (a manifest names a local folder), and signed out nothing goes up. A grant never goes up: each Mac asks
for its own Touch ID.

## Open and later

- A tile opens its page through the board's `showPage` (`lib/board-helpers.ts`): the board's own pane, `"board"` key.
  With no card open that pane sits left of the columns, between the rail and the board, and a second click on the lit
  tile closes it (`components/AppsRail.tsx` `activate`). `components/StandaloneBrowserPane.tsx` slides it in and out: a
  flex row, so the pane stretches to full height (as a block it shrank to its toolbar and the page measured 0 px tall,
  which the shell hides), and while it slides in BrowserPane is `obscured`, because CSS can't clip the native page.
  Its resize divider is its right edge.
- Next, as a design for review: React folder apps bundled by Weft and served from weft.zip, with declared reads and
  cloud secrets; full Next.js apps on Weft-hosted Workers when one needs server code (mini-app-hosting.md).
- Not built: `mcp__browser__save_app` so a thread can offer its page as an app, drag to reorder (Move up/down for now),
  favicons, apps per project. Data apps: revoking from the tile's menu (the page's Revoke for now), a data app's own
  files beyond `index.html` going up to prod, a move pushing every app's new place (only the moved one's for now),
  and reads that run on weft.zip rather than on a Mac. A shared page's own pictures and scripts by relative path don't load remotely (only the one
  file goes up), the link doesn't follow edits until the dialog opens again, and the visits list isn't shown in the app.
- Tests: data apps `electron/app-data.test.ts`, `electron/app-data-reads.test.ts`, `electron/app-read-core.test.ts`,
  `lib/app-read.test.ts`, `app/api/a/[id]/read/routes.test.ts`, `electron/app-data-rules.test.ts`
  (fixtures in `electron/app-data-test-helpers.ts`), prod `lib/app-cloud.test.ts` (fakes in `lib/app-cloud.harness.ts`);
  `lib/mini-apps.test.ts`, `lib/mini-app-store.test.ts`, `lib/use-mini-apps.test.ts`, `app/api/apps-route.test.ts`,
  `components/AppsRail.test.tsx` (covers `SaveAppButton` too); sharing: `lib/app-share*.test.ts`,
  `lib/share-unlock.test.ts`, `lib/share-page-serve.test.ts`, `app/api/apps-share-route.test.ts`,
  `app/api/a/[id]/*/routes.test.ts`, `components/ShareAppDialog.test.tsx`, `components/LoomApps.test.tsx`;
  hosted apps (mini-app-hosting.md): build `lib/app-build.test.ts`, `lib/app-build-watch.test.ts`,
  `app/api/apps-build-route.test.ts`; secrets/crypto `lib/app-secrets.test.ts`, `lib/app-secret-store.test.ts`,
  `electron/app-secrets-push.test.ts`; bridge `lib/app-bridge.test.ts`, `lib/app-bridge-inject.test.ts`,
  `components/share-view/use-app-bridge.test.tsx`, `components/share-view/AppSecretForm.test.tsx`; routes
  `app/api/apps-share-route.test.ts`, `app/api/a/[id]/fetch/routes.test.ts`,
  `app/api/a/[id]/f/[...path]/routes.test.ts`, `lib/app-share-access-by-slug.test.ts`,
  `lib/share-page-serve.test.ts`, `electron/app-fetch-run.test.ts`, `electron/app-fetch-policy.test.ts`,
  `electron/app-fetch-run-integration.test.ts`, `electron/app-data-fetch.test.ts`; pane fix
  `components/StandaloneBrowserPane.test.tsx`, share button `components/AppShareButton.test.tsx`.
