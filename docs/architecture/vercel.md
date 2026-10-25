# Vercel

Status: linking built 2026-10-12 (pick an existing project or create one); env push from the 🔐 vault built
2026-10-12; env pull into the vault, by hand or live by webhook, built 2026-10-13. GitHub connect on a linked project,
deploys and logs are next.

▲ on the left rail (under 🔐, in `components/LibraryRail.tsx`) opens a drawer that links each board project to a
Vercel project. It's the base for the rest of the Vercel work: everything after linking needs the token and the
project id this sets up.

## The token

- You paste a token from vercel.com/account/tokens into the drawer. Main checks it (`GET /v2/user`) before keeping it.
- Main seals it with Electron's `safeStorage` (Keychain) in `~/.weft/vercel-token.json` (mode 0600). Without
  safeStorage it refuses rather than writing it in the clear, like the vault's device key.
- The token never leaves main: every Vercel call is made there, and the board gets back only names, ids, URLs and
  states. `lib/secret-guard.ts` denies threads `vercel-token.json`.
- Weft doesn't reuse the Vercel CLI's own login file: reading another tool's credentials is the kind of thing the
  guard is there to stop.

## The link

A link is `.vercel/project.json` (`{ projectId, orgId, projectName }`), the file `vercel link` writes, plus `.vercel`
in `.gitignore`. No Weft-side state: the Vercel CLI in a thread (`vercel deploy`, `vercel logs`, `vercel env ls`)
works on the right project with no prompt, and a folder linked by the CLI shows up linked in the drawer.

- **Link…** lists projects from your account and every team (`/v2/teams`, `/v10/projects` per scope; a scope that
  fails is skipped unless all do). `pickerList` in `lib/vercel-view.ts` sorts best fits first: the project deploys
  from the folder's GitHub repo (3), has the repo's or folder's name (2), or a name containing it (1); then newest.
- **+ New project** (`components/VercelCreate.tsx`): a name (the repo's name, else the folder's, made Vercel-safe by
  `projectNameFor`), a team (from `scopes()`: your teams, plus Personal only on an older account with no default
  team; your default team first), and "Deploy from GitHub owner/name". Main `POST /v11/projects` with the framework
  from `package.json` (`frameworkOf`), writes the link, then `POST /v9/projects/:id/link` for the repo. If connecting
  GitHub fails (usually the Vercel GitHub app can't see the repo) the project stays made and linked, and the toast
  says why.
- **Unlink** removes `.vercel/project.json` only; the Vercel project is untouched.

## What the drawer shows

For a linked folder: project and team, the production URL (first alias), the latest deployment (state, production
or preview, age; click to open it in the board's browser pane), whether it deploys from this folder's repo (warns
when it doesn't, or deploys from another repo), and a row of vercel.com links (`vercelActions` in `lib/vercel-view.ts`):
the latest deploy's page (its `inspectorUrl`), runtime logs, env vars, domains and the dashboard. The dashboard is
`vercel.com/<team slug or your username>/<project>`; only with neither does it fall back to `vercel.com/dashboard`,
and then the logs, env and domains links are left out. A link Vercel can't read keeps its ids and
shows the error, so you can still unlink it. Status loads only while the drawer is open (`lib/use-vercel.ts`), on
open, on folder change and on window focus, since each load is a few API calls per project. It opens on the last status it had (memory, then localStorage `weft:drawer-status:<name>`), refreshes it behind, and a focus asks again only after 30s (`lib/use-linked-status.ts`, shared by the three drawers).

## Env push: 🔐 vault → Vercel

A linked folder's card in the drawer has a 🔐 line ("1 to push · 4 on Vercel") that opens the vault's names against
the project's variables, one row per name and environment: **Push** (in the vault, not on Vercel), **on Vercel · push
again** (replaces Vercel's value with the vault's), **Vercel only**, or **no value** (a name the vault has without a
value). It opens by itself when something is left to push. **Push all** beside the 🔐 line sends every value the vault
holds, in every environment, behind one Touch ID.

- **Names only to the board.** `envList` reads `/v10/projects/<id>/env` without `decrypt`, so no value comes back from
  Vercel either; the comparison is by name and environment (`electron/vercel-env.cjs` `status`).
- **A push is one Touch ID, every time.** `vault.sendValue` asks with the secret, the vault, the environment and the
  project ("push SUPABASE_SECRET_KEY (aimhuge/weft, production) to Vercel project weft"), even while the drawer is
  unlocked, since it writes somewhere else. The value goes from the vault straight into `envSet`'s request inside main.
  Push all (`pushAll`, through `vault.valuesFor` and `vault.confirm`) asks once with the count ("push 22 secrets (aimhuge/weft) to Vercel project
  weft"), then sends each in turn; one Vercel refusal doesn't stop the rest, and the toast names what failed.
- **Sensitive by default.** Production and Preview values go in as `sensitive` (Vercel never shows them again);
  Development can't be sensitive, so it's `encrypted`. `upsert=true` replaces the value for that name and environment.
  A variable takes effect on the next deploy.
- **Threads can push too**, through `mcp__secrets__push_to_vercel(name, environment)` (`lib/secret-tools.ts`) and the
  control server's `POST /vercel/env-push` (`envRoutes`): the same Touch ID, and the thread gets back only what
  happened. Its prompt says to use it instead of the dashboard or `vercel env add` for a vault value.
- A Weft whose main started before env push shows "Restart Weft to push 🔐 secrets to Vercel" (no `envStatus` on the bridge).

## Env pull: Vercel → 🔐 vault

The other way round, for a variable someone added on Vercel (the dashboard, `vercel env add`) that the vault doesn't
hold yet. The vault stays the source of truth: a pull only fills a name the vault has **no value** for (absent, or a
blank waiting for one) and never replaces a value.

- **What can come down.** Vercel decrypts only `plain` and `encrypted` variables (`GET /v1/projects/<id>/env/<envId>`,
  `vercel.envValue`). `sensitive` (and the old `secret`) never decrypt, so they stay **Vercel only** and the pull's
  toast lists them to add by hand; `system` ones are Vercel's own. `status()` marks the rows that can come down
  `pullable`, and those show **Vercel only · pull**, which pulls every pullable row of that project.
- **No Touch ID.** Unlike a push, a pull writes into your own vault and sends nothing anywhere: `vault.setValue` saves
  each with source "Vercel", rewrites a managed `.env.local` and tells the board (`vault:changed`). The value
  goes from Vercel's answer into the vault inside main; the board and threads get names back.
- **Live pull** (the drawer's "Live pull from Vercel" switch, for a project in a team: account webhooks belong to a
  team and need Pro or Enterprise). Vercel can't reach a Weft on localhost, so it goes through the deployed Weft, like
  the GitHub issue webhooks:

  ```
  Vercel env added ─▶ weft-topaz.vercel.app/api/vercel/webhook?hook=<id>   (lib/vercel-relay.ts: x-vercel-signature,
                                                                            HMAC-SHA1 of the body with the hook's secret)
                    ─▶ vercel_events row on Weft's Supabase (project id only; the payload never holds a value)
                    ─▶ Realtime ─▶ this Weft's server (lib/vercel-hooks.ts, after a 1.5s settle)
                    ─▶ control server POST /vercel/env-pull for each board folder linked to that project ─▶ main pulls
  ```

  Turning it on (`POST /api/vercel/hooks`) picks the hook's id, has main create the team webhook
  (`POST /v1/webhooks`, events `project.env-variable.created` and `.updated`, all the team's projects, since project
  events need that scope), and inserts the `vercel_hooks` row with Vercel's secret (insert-only; only the relay reads it
  back with the secret key). Then it pulls the folder once. On each server start and sign-in the listener pulls every
  board folder on a hooked team once, to catch what changed while Weft wasn't listening. Off deletes the webhook and
  the row. Migration: `supabase/migrations/20261013155658_vercel_webhooks.sql`. The relay needs `SUPABASE_SECRET_KEY`
  on the deployment (the GitHub relay already uses it); `WEFT_VERCEL_RELAY_URL` points hooks at another deployment.

## Drift

Each linked project's 🔐 vault and Vercel env are lined up by name, per environment, without anyone opening a drawer:
which names Vercel has that the vault holds no value for, and which vault values Vercel lacks. Names only, like status.

- **When.** A project landing on the board (`lib/project-open.ts`, never inline on the start-a-card path) asks main once
  (`lib/vercel-drift-open.ts`, started from `prewarm()`); the rail asks again on focus and when the vault changes.
- **Cache.** `electron/vercel-env-cache.cjs` keeps each linked folder's Vercel list for 10 minutes. `drift()` answers
  from it at once; a missing or stale list is fetched behind, and `onDrift` (`window.weft.vercel.onDrift`) tells the
  board when it lands. Every real listing (status, push, pull) refreshes it. An unlinked folder costs a file read.
- **Shown, no new rows.** 🔐 on the rail gets its dot and a hover line ("▲ web: 4 on Vercel not in vault, 2 missing on
  preview"), ▲ a count (`lib/vercel-drift.ts` `driftBadge`, `lib/use-vercel-drift.ts`). The ▲ drawer's 🔐 line and
  the 🔐 drawer's ▲ line say it as questions ("4 on Vercel not in vault: pull? · 2 missing on preview: push?") with
  **Pull** and **Push N** beside them (`components/VercelDriftActions.tsx`): Pull is `pull()`, Push N is `pushAll`
  with only the missing pairs, behind one Touch ID.
- **Copilot.** `lib/copilot-setup.ts` lists a drifted project as a setup gap (`/vercel/env-drift` on the control
  server, `driftGaps`), with a few names and the fix.

## Files

- `electron/vercel.cjs`: `createVercel` (status, token, projects, scopes, link, create, unlink) and `registerVercel`,
  whose IPC handlers answer the board window only.
- `electron/vercel-project.cjs`: request building, reading Vercel's answers (`deploymentOf`, `gitOf`,
  `productionUrl`), and the folder's side (`readLink`, `writeLink`, `ignoreVercel`, `frameworkOf`, `repoOf`).
- `electron/vercel-env.cjs`: `createVercelEnv` (status, push, pull, webhook create/delete) over `vercel.envList` /
  `vercel.envSet` / `vercel.envValue`, `vault.sendValue` and `vault.setValue`, `drift`, and `envRoutes` for threads and the server.
  `electron/vercel-env-cache.cjs`: the per-folder list cache behind `drift` (see Drift).
- `lib/vercel-drift.ts` (the drift's sums, lines, badge and copilot gaps), `lib/use-vercel-drift.ts` (the rail's hook),
  `lib/vercel-drift-open.ts` (the project-open handler), `components/VercelDriftActions.tsx` (Pull and Push N).
- `lib/vercel-relay.ts` + `app/api/vercel/webhook/route.ts`: the relay on the deployed Weft. `lib/vercel-hooks.ts` +
  `app/api/vercel/hooks/route.ts`: the switch and the Realtime listener (started from `prewarm()`).
- `electron/preload.cjs`: `window.weft.vercel`. The token's own read/persist lives in `electron/provider-token.cjs`, which Vercel, Supabase, Cloudflare and BlastCP all share.
- `lib/vercel-view.ts`: types, the bridge, matching, labels, name rules. `lib/use-vercel.ts`: loading, over `lib/use-linked-status.ts` (the cache).
- `components/VercelDrawer.tsx` (linked folders, on the shared `components/FolderRow.tsx`; its token form is the shared `components/TokenForm.tsx`), `components/VercelEnv.tsx` (the 🔐 env rows), `components/VercelPicker.tsx` (Link…, on the shared `components/DbSelect.tsx` with `lib/db-picker.ts` `rankItems`),
  `components/VercelCreate.tsx` (+ New project).

## Next

1. **Connect GitHub** on a project that's linked but doesn't deploy from its repo (same `/link` call as create).
2. **Deploy**: list recent deployments, redeploy, promote; open a preview in the card's pane after a push.
3. **Env compare**: values can't be compared without decrypting Vercel's (sensitive ones never decrypt), so
   "changed" isn't shown yet. Pull (built) fills only names the vault has no value for.
4. **Logs**: build logs of a failed deploy, runtime logs, in the drawer or the pane.
5. **Agent tools**: `mcp__vercel__*` for status and logs, with the token kept in main.
