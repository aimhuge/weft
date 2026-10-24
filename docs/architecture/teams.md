# Teams

Status: phase 1 (workspaces, members, roles, email invites on weft.zip) built 2026-10-13. Phase 2, the shared 🔐
vault, is designed in [teams-vault.md](teams-vault.md).

A Weft account has a **workspace** from its first sign-in (solo is a team of one). Owners and admins invite people by
email; an invite link joins whichever account opens it. Billing (`/[orgSlug]/billing`) and the shared vault hang off
the same workspace id.

Having people is the one thing a plan unlocks, and it is a real gate in code, not a marketing promise:

- **Free** workspaces stay a team of one. `runInvite` (`lib/team-ops.ts`) refuses with `TEAM_GATE_MESSAGE`
  ("Teams are part of Pro. Upgrade this workspace to invite members — or to Team, at $9 a seat.") after its own
  cheap input checks and before the profile lookup or the mailer, so a locked workspace never sends a
  half-accepted invite.
- **Pro** ($20/workspace) and **Team** ($9/seat) may invite, set roles and manage members. The rule is one list,
  `TEAM_PLANS` in `lib/billing/plan-gate.ts`, read from `org_subscriptions` — see
  [billing.md](billing.md#the-team-gate) for the fail-closed behaviour.
- Removal, self-leave and role changes are **not** gated: a workspace is always escapable, and you can always leave.

An unreadable, missing or non-paying subscription reads as Free rather than letting people in, so a Supabase hiccup
locks the invite form instead of 500-ing it. One consequence worth knowing: the gate says a workspace *may* have
members; nothing yet keeps a Team subscription's seat count in step with the roster (no billing page yet), so a Team
workspace that adds a person is under-charged until that lands.

## Where it runs

Team management lives on the deployed Weft (weft.zip), not in the desktop app:

- The org tables are service-role only (RLS on, no policies), and the service key never ships in the desktop.
- The desktop's account menu has **Your team**, which opens `https://weft.zip/team` in the browser pane. The pane
  keeps its own cookie session, so the first visit asks for GitHub once.

```
desktop ── pane ──▶ weft.zip /team ─▶ /<slug>/team ──(service role)──▶ Supabase orgs · org_memberships · invitations
                         ▲ cookie session (proxy.ts refreshes it)
```

## The package, and what Weft doesn't use

`@aimhuge/teams` (from `aimhuge/components`, `packages/teams`) is installed as a packed tarball,
`vendor/aimhuge-teams-0.1.0.tgz`, packed from the commit `4e36dc9` on components' `main`. It isn't tagged yet; once
it is, pnpm can install it straight from git (`github:aimhuge/components#vX&path:/packages/teams`).

Weft uses its pure helpers: `listUserOrgs`, `listOrgMembers`, `setCurrentOrg`, the role helpers (`roleCan`,
`assignableRoles`, `roleLabel`, …), the invite flow (`createInvite`, `lookupInviteByToken`, `acceptInvite`,
`listPendingInvites`, `revokeInvite`) and the email helpers.

It **doesn't** use the package's `requireOrg`, `sessionClaims`, its server actions or the client components that call
them. 0.1.0 passes a `SupabaseClient` into a `"use cache"` function, and Next 16 hands a cached function a
non-serializable argument as a temporary reference that throws when touched ("Cannot access from on the server. You
cannot dot into a temporary client reference"; reproduced 2026-10-13 on Next 16.4.0). The fix is a Backlog card in
`~/dev/components`. Until then Weft has its own gate and actions, below.

## Files

`lib/web-session.ts` `webClient()` awaits `connection()` before `cookies()`: building a Supabase client reads `Date.now()`,
which cacheComponents refuses during prerender on a cold lambda, and only `connection()` gets a render past that. Every gate
(`requireTeam`, `currentWorkspaceSlug`, `readSessionIdentity`) goes through it; pages that reach `serviceClient()` without
a gate (/s, /a, /u) call `connection()` themselves (`lib/prerender-check.ts` flags the miss).

- `supabase/migrations/20261013155754_teams.sql`: `orgs`, `org_memberships`, `invitations` (the package's 0001/0002
  schema), profile columns the package reads (`current_org_id`, `display_name` generated from `name`,
  `last_login_at`, `login_count`), and `private.create_personal_org` with the `on_auth_user_created_workspace`
  trigger and a backfill. Weft keeps its own copy because the package's 0001 replaces `on_auth_user_created`, which
  would drop the name and avatar Weft's trigger fills in. Slugs come from the GitHub login (`private.org_slug_for`),
  skipping the package's reserved words and Weft's root routes.
- `lib/supabase-project.ts`: the project URL and publishable key, with no Node imports so `proxy.ts` can use them.
- `lib/web-session.ts`: the weft.zip visitor's cookie session (`webClient`, `webUser` from the JWT claims) and the
  service-role client (`serviceClient`, from `SUPABASE_SECRET_KEY`, set on the deployment only).
- `proxy.ts`: refreshes the session cookie before the team pages render (Server Components can't write cookies).
  Deployed only; matches `/login`, `/app`, `/team`, `/invite/*`, `/<slug>/team/*` and `/<slug>/billing/*`.
- `lib/web-auth.ts` + `app/auth/{sign-in,callback,sign-out}`: GitHub (or Google) sign-in on weft.zip with PKCE in a
  cookie. The callback stamps `last_login_at` and `login_count`. `/login` uses it when deployed.
- `lib/teams.ts`: the gate. `teamAccess(slug)` answers ok / signed-out / denied / unconfigured (a missing workspace and
  a non-member get the same "denied", so membership can't be probed); `requireTeam(slug)` redirects to `/login` or
  404s. `currentWorkspaceSlug()` reads `profiles.current_org_id` and heals a stale pointer. `inviteMailer()` sends
  invites through Resend (`RESEND_API_KEY`, from `Weft <team@weft.zip>`), the package's plain text plus an HTML version in the Salt Flats scene (`lib/invite-email.ts` reads the facts back out of that text; its car banner and mark are `public/brand/email/`, loaded from the claim link's origin, so they show only once deployed). No `"use cache"`: plain queries per request.
- `lib/team-actions.ts`: the server actions: invite (or add straight in when the address already has an account),
  change role, remove or leave, revoke an invite. Each re-checks the role on the server, and none leaves a workspace
  without an owner.
- `app/team` (redirect to the current workspace), `app/[orgSlug]/layout.tsx` (the workspace shell: a sidebar with the
  Weft mark, the workspace switcher, Board / Team / Billing with the current page lit from the URL, and your account
  and Sign out at the foot; a top bar under 860px), `app/[orgSlug]/team`, `app/invite/[token]` (a Join button, so
  link-preview bots can't accept an invite), `components/team/*`.
- `components/team/team.css`: the whole dashboard's look (Team, Billing, the web board's frame, the `/team`, `/app` and
  invite cards), self-contained under `.wz-app` with its own tokens: surfaces raised in steps (`--bg` < `--side` <
  `--panel` < `--panel-2`) over the home page's indigo, cream and clay. It doesn't lean on `home.css` (a direct hit on
  `/team` never loaded it). Preview without signing in by rendering the components to static HTML with esbuild and the
  stylesheet beside it; the admin pages use the board's Tailwind tokens instead.

## In the desktop's Settings

Settings → Teams (`components/TeamSettings.tsx`) opens on **Your teams** (`components/team/TeamList.tsx`), every
workspace you're in with your role, and below it the one you picked (`components/team/TeamPanel.tsx`): the same
projects, roster, invite form and pending invites as weft.zip. `lib/use-managed-team.ts` remembers the pick and keeps
the team you switched from while the next one loads, so the list never blinks; hovering a row prefetches it. A team you own has a pencil that
renames it in place: `{ action: "rename" }` through `runTeamOp` to `runRenameTeam` (`lib/team-create.ts`), owners only,
1 to 60 characters, name only (the slug is in every link and synced board, so it stays). Its trash deletes it:
`{ action: "delete", confirm: <name> }` to `runDeleteTeam` (`lib/team-delete.ts`), which needs an owner who is in
another team too (nobody is left with none), the name typed exactly, and no paid plan still billing (cancel it in
Billing first; deleting the row wouldn't stop Stripe). Every table under `orgs` cascades: memberships, invites,
projects, synced cards and commands, mini apps, share links, billing rows. The desktop's forwarder then calls
`forgetSyncOrg()` (`lib/cloud-sync.ts`), since the deleted team may be the one this Mac's cards sync to. The
invite form's role descriptions are `ROLE_DESCRIPTIONS` in `lib/team-types.ts`, not the package's (BlastCP's).
The desktop has neither weft.zip's cookie nor the service key, so it goes through weft.zip's JSON API:

```
board ── useTeam() ──▶ /api/account/team (local, guarded) ──Bearer <desktop JWT>──▶ weft.zip /api/teams ──▶ Supabase
```

- `app/api/teams` (weft.zip, no localhost guard; the bearer token is the check, `bearerUser` in `lib/web-session.ts`):
  GET a `TeamSnapshot`, POST a `TeamOp`. 401 signed out, 404 not a member, 503 not configured.
- `lib/team-ops.ts`: one core for that API and the server actions, so both enforce the same rules. `runInvite`
  consults the plan gate (`workspaceCanHaveMembers`) and exports `TEAM_GATE_MESSAGE`; `checkInvite` holds the free
  input checks so the op stays small.
- `app/api/account/team` + `lib/team-remote.ts`: the desktop's forwarder (`WEFT_TEAMS_URL`, default weft.zip).
- `lib/use-team.ts`: the board hook; `lib/team-types.ts`: the shapes the board may import. A refresh keeps showing
  the loaded team until the new answer lands (only a workspace switch reads "loading"), so a burst of refreshes
  can't keep a slow load from finishing. It keeps the last answer per workspace in a module cache, and
  `useTeamPrefetch` (called by the top bar's `AccountButton`) fills it as soon as you're signed in and clears it on
  sign-out, so the page opens already loaded and refreshes quietly behind it.
- `components/team/team-board.css`: the shared components' `wz-*` classes in the board's tokens, scoped under
  `.wz-board` (weft.zip's `team.css` never loads on the board), so the page follows Light, Dark and every scene.
- `vercel.json` pins weft.zip's functions to `sin1`, next to the Supabase project (ap-southeast-1). From Vercel's
  default `iad1` each of a team load's ~10 sequential queries crossed the Pacific, and a load took 5 to 7 seconds.
- `components/team/*` take their actions as a prop (`TeamClientActions`): server actions on weft.zip
  (`components/team/WebTeam.tsx`), the forwarder in the desktop.

## Row-level security

`20261013171000_teams_rls.sql`: members read their workspaces and memberships, owners and admins read pending invites
(never the token column), everyone reads the profiles of people they share a workspace with. Writes stay with the
service role. The checks are security-definer helpers in `private` (`is_org_member`, `org_role`, `shares_org`).

## Roles

| role | can |
|---|---|
| owner | everything, including other owners and the workspace itself |
| admin | invite, remove and re-role members and admins; manage billing |
| member | see the roster; leave |

## Setup on the deployment

- Apply `20261013155754_teams.sql` (the Supabase drawer's Migrate, or `supabase db push`).
- Supabase Auth → URL configuration: add `https://weft.zip/auth/callback` to the redirect URLs.
  For a local server (`WEFT_WEB=1`) add `http://127.0.0.1:1024/**` as well — Supabase matches the
  `redirect_to` against this list, and the whole local round trip is pinned to that origin
  (`webLocalOrigin` in `lib/web-auth.ts`; a visitor who arrives as `localhost` is moved to
  `127.0.0.1` first), so one wildcard entry covers the whole dev port.
- Vercel env: `SUPABASE_SECRET_KEY` and `RESEND_API_KEY` (both already used by other routes);
  `NEXT_PUBLIC_SITE_URL` is optional (`next.config.ts` defaults it to `https://weft.zip`).
